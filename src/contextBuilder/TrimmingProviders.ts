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
import * as IterOps from "@utils/iterables";
import $TextSplitterService from "./TextSplitterService";
import $TokenizerService from "./TokenizerService";

import type { ContextConfig } from "@nai/Lorebook";
import type { TextFragment, TextOrFragment } from "./TextSplitterService";
import type { StreamEncodeFn, EncodeResult } from "./TokenizerService";
import type { Assembly } from "./assemblies";

export type TrimType = ContextConfig["maximumTrimType"];
export type TrimDirection = ContextConfig["trimDirection"];
export type SplitterFn = (text: TextFragment) => Iterable<TextFragment>;
export type ProviderAugmentFn = (provider: TrimProvider) => TrimProvider;

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

  /** Adds comment removal to the given {@link TrimProvider}. */
  const removeComments: ProviderAugmentFn = dew(() => {
    const reCommentFrag = /^##/m;
    const hasComment = (frag: TextFragment) => reCommentFrag.test(frag.content);
    const isNewline = (frag: TextFragment) => frag.content === "\n";
    const ofInterest = (frag: TextFragment) => isNewline(frag) || hasComment(frag);
    const batchFn = (cur: TextFragment, prev: TextFragment) => ofInterest(cur) === ofInterest(prev);

    /**
     * Find every pair of consecutive `\n` and yield only the first of that pair.
     * This function will also remove all comments, leaving only `\n` behind.
     */
    const collapseNewlines = (frags: Iterable<TextFragment>) => IterOps.chain(frags)
      // @ts-ignore - A bug with namespace imports and instantiation expressions.
      .thru(IterOps.scan<TextFragment>)
      .collect(([l, r]) => isNewline(l) && isNewline(r) ? l : undefined)
      .value();

    /** Augment the provider through the `newline` method. */
    const thruNewline = (provider: TrimProvider): TrimProvider => {
      const newline = (frag: TextFragment) => {
        const frags = provider.newline(frag);
        // Fast-path: no comment, no need.
        if (!hasComment(frag)) return frags;

        return IterOps.chain(frags)
          .thru((iter) => IterOps.batch(iter, batchFn))
          .flatMap((group) => {
            // If this is just a group of `\n`, no comments need removal.
            if (!group.some(hasComment)) return group;

            return IterOps.chain(group)
              .thru((frags) => IterOps.concat(
                // Initial newlines before the first comment.
                IterOps.takeUntil(frags, hasComment),
                // Starting from the first comment to the last comment, we want
                // to remove one newline in each sequence of newlines between
                // every pair of comments and remove the comments.
                IterOps.chain(frags)
                  .pipe(IterOps.journey, hasComment)
                  .thru(collapseNewlines)
                  .value(),
                // Trailing newlines after the last comment.
                IterOps.takeRightUntil(frags, hasComment)
              ))
              // Now we remove one newline in this final sequence of newlines.
              // There must be at least two newlines remaining for any newline
              // to be output.
              .pipe(IterOps.skipRight, 1)
              .value();
          })
          .value();
      };

      return { ...provider, newline };
    };

    // Cache a copy of trimBottom's comment remover for un-sequenced providers.
    const nlRemove = thruNewline(basic.trimBottom).newline;

    /** Augment the provider through the `preProcess` method. */
    const thruPreProcess = (provider: TrimProvider) => ({
      ...provider,
      preProcess: (assembly: Assembly.IFragment) => {
        const frags = IterOps.toArray(provider.preProcess(assembly));
        if (!frags.some(hasComment)) return frags;
        return ss.defragment(IterOps.flatMap(frags, nlRemove));
      }
    });

    return (provider) => (provider.noSequencing ? thruPreProcess : thruNewline)(provider);
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