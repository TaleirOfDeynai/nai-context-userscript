/**
 * This module provides abstractions to support the trimming process.
 * 
 * The `TrimProvider` provides functions on how to fragment the text
 * for each trim-type.  It's its own abstraction so the process can
 * potentially be customized, like with comment removal.
 * 
 * It is important to note that the providers are setup so the output
 * of the previous trim-level is fed to the next as its input.
 * 
 * IE: the `token` level will receive the fragments yielded from
 * the `sentence` level which receives the fragments yielded from
 * the `newline` level which receives the fragments yielded by
 * the `preProcess` function.
 * 
 * The `TextSequencer` is mostly just lubricant for the trimming
 * service, representing a single trim-type and hiding the provider
 * behind a standardized interface.  The `getSequencersFrom` function
 * figures out which providers to apply for the configured maximum
 * trim-type for an entry.
 */

import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { isString } from "@utils/is";
import { assertExists } from "@utils/assert";
import { flow } from "@utils/functions";
import { protoExtend } from "@utils/object";
import * as IterOps from "@utils/iterables";
import $TextSplitterService from "./TextSplitterService";
import $TokenizerService from "./TokenizerService";

import type { UndefOr } from "@utils/utility-types";
import type { ContextConfig } from "@nai/Lorebook";
import type { TextFragment, TextOrFragment } from "./TextSplitterService";
import type { StreamEncodeFn, EncodeResult } from "./TokenizerService";
import type { Assembly } from "./assemblies";

export type TrimType = ContextConfig["maximumTrimType"];
export type TrimDirection = ContextConfig["trimDirection"];
export type SplitterFn = (text: TextFragment) => Iterable<TextFragment>;

// TODO: Replace the `removeComments` sequencer with a function
// that augments another provider with comment removal abilities.
// This way, we can do composition, which is more powerful.

// TODO: While you're doing that, replace that nightmarish comment
// removal method.  What were you thinking?  I have an idea for
// a simpler method, but it'll add a touch more overhead to the
// parsing; probably not enough to be a concern, though.

/**
 * Managing fragments is a little tricky, so this interface provides
 * methods to perform the different kinds of trimming.  Create your
 * own to have tighter control over trimming.
 * 
 * All the methods named for {@link TrimType trim types} should yield
 * all newline `\n` characters as separate fragments, as this may be
 * assumed to be the case in other code paths, as this is the behavior
 * of the {@link TextSplitterService text splitters}.
 */
export interface TrimProvider extends Record<TrimType, SplitterFn> {
  /**
   * Typically performs the conversion of a {@link Assembly.IFragment}
   * into an iterable of {@link TextFragment} to be trimmed, as needed,
   * but can also handle other pre-trimming processing on those fragments.
   */
  preProcess: (assembly: Assembly.IFragment) => Iterable<TextFragment>;
  /**
   * Whether this provider iterates fragments in reverse, from the end of
   * the input string towards the beginning.
   * 
   * This is typically `true` for `trimTop`.
   */
  reversed: boolean;
  /**
   * Whether this provider cannot perform sequencing.  This will cause
   * all fragments to be encoded in one go.
   * 
   * This is typically `true` for `doNotTrim`.
   */
  noSequencing: boolean;
}

type CommonProviders = Record<TrimDirection, TrimProvider>;

export interface TextSequencer {
  /** Function used to break text into fragments. */
  splitUp: (text: TextOrFragment) => Iterable<TextFragment>;
  /** Encoder to use with this sequencer. */
  encode: StreamEncodeFn;
  /** Gets the text fragment to use with the next sequencer. */
  prepareInnerChunk: (current: EncodeResult, last?: EncodeResult) => readonly TextFragment[];
  /** The iteration direction of {@link TextSequencer.splitUp splitUp}. */
  reversed: boolean;
}

/** The natural order for sequencers. */
const TRIM_ORDER = Object.freeze(["newline", "sentence", "token"] as const);
/** Sequencer token encoder buffer size configurations. */
const BUFFER_SIZE = Object.freeze([10, 5, 5] as const);

/**
 * This module provides common {@link TrimProvider trim providers} used
 * in trimming.  They can be tweaked to mess with the input text for
 * those odd special cases.
 */
export default usModule((require, exports) => {
  const tokenizer = $TokenizerService(require);
  const ss = $TextSplitterService(require);

  // Generally, we just work off the assembly's content.
  const basicPreProcess = (assembly: Assembly.IFragment) => assembly.content;

  // For `doNotTrim`, we do not trim...  So, yield an empty iterable.
  const noop = (): Iterable<TextFragment> => [];

  const isNewline = (f: TextFragment) => f.content === "\n";

  /** Providers for basic trimming. */
  const basic: CommonProviders = Object.freeze({
    trimBottom: Object.freeze({
      preProcess: basicPreProcess,
      newline: ss.byLine,
      sentence: ss.bySentence,
      token: ss.byWord,
      reversed: false,
      noSequencing: false
    }),
    trimTop: Object.freeze({
      preProcess: flow(basicPreProcess, IterOps.iterReverse),
      newline: ss.byLineFromEnd,
      sentence: flow(ss.bySentence, IterOps.iterReverse),
      token: flow(ss.byWord, IterOps.iterReverse),
      reversed: true,
      noSequencing: false
    }),
    doNotTrim: Object.freeze({
      preProcess: basicPreProcess,
      newline: noop,
      sentence: noop,
      token: noop,
      reversed: false,
      noSequencing: true
    })
  });

  const reCommentFrag = /^##.*$/;

  /** Providers that remove fragments that are comment lines. */
  const removeComments: CommonProviders = Object.freeze({
    trimBottom: protoExtend(basic.trimBottom, {
      newline: (text: TextFragment) => {
        // The goal is to remove comments while keeping the start and end
        // of the string similarly structured.  There's essentially three
        // cases we're looking out for:
        // - The string starts with a comment (with newline).
        //   - Just remove the comment and following newline.
        // - The string has comments in lines in the middle.
        //   - Just remove the comment and following newline.
        // - The string ends with a comment (no new line after).
        //   - We want the last non-comment line to also not end with
        //     a newline.
        let dropLastNewLine = false;
        return IterOps.chain(basic.trimBottom.newline(text))
          // Chunk it up into the fragments for each line, arranged like:
          // `[StartFrag, ...RestFrags, CurLineEnd?]`
          .thru((frags) => IterOps.buffer(frags, isNewline, true))
          // This removes any chunks with a comment in the `StartFrag` position.
          .thru(function*(lineChunks) {
            for (const frags of lineChunks) {
              const theStart = IterOps.first(frags) as TextFragment;
              if (reCommentFrag.test(theStart.content)) {
                // Removing this line by not yielding it.
                // Check to see if the comment ended with a newline.
                // If it did not, and this was the last chunk, then
                // `dropLastNewLine` will instruct the next step to
                // remove the previous newline.
                const theEnd = IterOps.last(frags) as TextFragment;
                dropLastNewLine = !isNewline(theEnd);
              }
              else {
                yield* frags;
                dropLastNewLine = false;
              }
            }
          })
          // This removes the last newline character if needed.
          .thru(function*(frags) {
            // We actually need to run through the iterable, since we
            // are being naughty and have shared mutable state in the
            // form of the `dropLastNewLine` variable.
            let lastFrag: UndefOr<TextFragment> = undefined;
            for (const frag of frags) {
              if (lastFrag) yield lastFrag;
              lastFrag = frag;
            }
            // Now the variable should be set correctly.
            if (!lastFrag) return;
            if (isNewline(lastFrag) && dropLastNewLine) return;
            yield lastFrag;
          })
          .value();
      }
    }),
    trimTop: protoExtend(basic.trimTop, {
      newline: (text: TextFragment) => {
        // Basically the same as above, only the last fragment in a chunk
        // will be the newline.
        let dropLastNewLine = false;
        return IterOps.chain(basic.trimTop.newline(text))
          // Chunk it up into the fragments for each line, arranged like:
          // `[...RestFrags, StartFrag, PrevLineEnd?]`
          .thru((frags) => IterOps.buffer(frags, isNewline, true))
          // This removes any chunks with a comment in the `StartFrag` position.
          .thru(function*(lineChunks) {
            for (const frags of lineChunks) {
              const [theStart, theNewLine] = dew(() => {
                let theLast = frags.at(-1) as TextFragment;
                if (!isNewline(theLast)) return [theLast, undefined];
                return [frags.at(-2), theLast];
              });
              if (theStart && reCommentFrag.test(theStart.content)) {
                dropLastNewLine = !theNewLine;
              }
              else {
                yield* frags;
                dropLastNewLine = false;
              }
            }
          })
          // This removes the last newline character if needed.
          .thru(function*(frags) {
            let lastFrag: UndefOr<TextFragment> = undefined;
            for (const frag of frags) {
              if (lastFrag) yield lastFrag;
              lastFrag = frag;
            }
            if (!lastFrag) return;
            if (isNewline(lastFrag) && dropLastNewLine) return;
            yield lastFrag;
          })
          .value();
      }
    }),
    doNotTrim: protoExtend(basic.doNotTrim, {
      preProcess: (assembly) => IterOps.flatMap(
        basic.doNotTrim.preProcess(assembly),
        removeComments.trimBottom.newline
      )
    })
  });

  /** Ensures `srcProvider` is a {@link TrimProvider}. */
  const asProvider = (srcProvider: TrimDirection | TrimProvider) => assertExists(
    `Expected \`${srcProvider}\` to be mappable to a provider.`,
    isString(srcProvider) ? basic[srcProvider] : srcProvider
  );

  /**
   * A sequencer is an abstraction that yields longer and longer iterables
   * of a string split up using some kind of strategy.  The idea is that
   * we'll keep adding fragments until we either yield the whole string
   * or we bust the token budget.
   * 
   * We'll have sequencers for the different trim settings and when we
   * find we have busted the budget, we'll apply a finer splitter to the
   * fragment that couldn't fit.
   */
  const makeSequencer = (
    /** One of the splitting methods from {@link TrimProvider}. */
    splitUp: (text: TextOrFragment) => Iterable<TextFragment>,
    /** The size of the encoder's unverified tokens buffer. */
    bufferSize: number,
    /** Whether `splitUp` runs in reverse. */
    reversed: boolean
  ): TextSequencer => {
    const encode: TextSequencer["encode"] = dew(() => {
      if (reversed) return (codec, toEncode, options) => {
        options = { bufferSize, ...options };
        return tokenizer.prependEncoder(codec, toEncode, options);
      };

      return (codec, toEncode, options) => {
        options = { bufferSize, ...options };
        return tokenizer.appendEncoder(codec, toEncode, options);
      };
    });

    const prepareInnerChunk: TextSequencer["prepareInnerChunk"] = dew(() => {
      if (reversed) return (current, last) => {
        if (!last) return current.fragments;
        const diff = current.fragments.length - last.fragments.length;
        return current.fragments.slice(0, diff).reverse();
      };
      return (current, last) => {
        if (!last) return current.fragments;
        const diff = current.fragments.length - last.fragments.length;
        return current.fragments.slice(-diff);
      };
    });

    return {
      splitUp,
      encode,
      prepareInnerChunk,
      reversed
    };
  };

  /**
   * Converts a {@link TrimProvider} or {@link TrimDirection} into one
   * or more {@link TextSequencer}, each representing one trim-level,
   * in the order that they should be applied.
   * 
   * The `maximumTrimType` indicates the coarsest trim-level that we can
   * use and will influence how many sequencers are returned.
   */
  const getSequencersFrom = (
    provider: TrimDirection | TrimProvider,
    maximumTrimType: TrimType
  ): TextSequencer[] => {
    const p = asProvider(provider);
    const order = dew(() => {
      switch (maximumTrimType) {
        case "token": return TRIM_ORDER;
        case "sentence": return TRIM_ORDER.slice(0, -1);
        case "newline": return TRIM_ORDER.slice(0, -2);
      }
    });

    return order
      .map((key: TrimType, i: number) => [p[key], BUFFER_SIZE[i]] as const)
      .map(([sFn, bs]) => makeSequencer(sFn, bs, p.reversed));
  };

  return Object.assign(exports, {
    basic,
    removeComments,
    asProvider,
    getSequencersFrom
  });
});