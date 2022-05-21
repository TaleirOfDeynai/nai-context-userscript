import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { isString } from "@utils/is";
import { assertExists } from "@utils/assert";
import { chain, iterReverse } from "@utils/iterables";
import $TextSplitterService from "./TextSplitterService";
import $TokenizerService from "./TokenizerService";

import type { UndefOr } from "@utils/utility-types";
import type { ContextConfig } from "@nai/Lorebook";
import type { TextFragment, TextOrFragment } from "./TextSplitterService";
import type { StreamEncodeFn, EncodeResult } from "./TokenizerService";
import type { TextAssembly } from "./TextAssembly";

export type TrimType = ContextConfig["maximumTrimType"];
export type TrimDirection = ContextConfig["trimDirection"];
export type SplitterFn = (text: TextFragment) => Iterable<TextFragment>;

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
   * Typically performs the conversion of a {@link TextAssembly} into an
   * iterable of {@link TextFragment} to be trimmed, as needed, but can
   * also handle other pre-trimming processing on those fragments.
   */
  preProcess: (assembly: TextAssembly) => Iterable<TextFragment>;
  /**
   * Whether this provider iterates fragments in reverse, from the end of
   * the input string towards the beginning.
   * 
   * This is typically `true` for `trimTop`.
   */
  reversed: boolean;
}

type CommonProviders = Record<TrimDirection, TrimProvider>;

export interface TextSequencer {
  /** Function used to break text into fragments. */
  splitUp: (text: TextOrFragment) => Iterable<TextFragment>;
  /** Encoder to use with this sequencer. */
  encode: StreamEncodeFn;
  /** Gets the text fragment to use with the next sequencer. */
  prepareInnerChunk: (current: EncodeResult, last?: Readonly<EncodeResult>) => TextFragment;
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
  const tokenizerService = $TokenizerService(require);
  const splitterService = $TextSplitterService(require);
  const { mergeFragments } = splitterService;

  // Generally, we just work off the assembly's content.
  const basicPreProcess = (assembly: TextAssembly) => assembly.content;

  // For `doNotTrim`, we do not trim...  So, yield an empty iterable.
  const noop = (): Iterable<TextFragment> => [];

  /** Providers for basic trimming. */
  const basic: CommonProviders = Object.freeze({
    trimBottom: Object.freeze({
      preProcess: basicPreProcess,
      newline: splitterService.byLine,
      sentence: splitterService.bySentence,
      token: splitterService.byWord,
      reversed: false
    }),
    trimTop: Object.freeze({
      preProcess: basicPreProcess,
      newline: splitterService.byLineFromEnd,
      sentence: (text) => iterReverse(splitterService.bySentence(text)),
      token: (text) => iterReverse(splitterService.byWord(text)),
      reversed: true
    }),
    doNotTrim: Object.freeze({
      preProcess: basicPreProcess,
      // Do no actual splitting; just return an array with a single element.
      newline: (inputText: TextFragment) => [inputText],
      sentence: noop,
      token: noop,
      reversed: false
    })
  });

  const reCommentFrag = /^##.*$/;

  /** Providers that remove fragments that are comment lines. */
  const removeComments: CommonProviders = Object.freeze({
    trimBottom: Object.freeze({
      ...basic.trimBottom,
      newline: function*(text: TextFragment) {
        // If we encounter a comment, we need to drop the following newline.
        let omitNextNewline = false;
        for (const frag of basic.trimBottom.newline(text)) {
          if (omitNextNewline) {
            omitNextNewline = false;
            if (frag.content === "\n") continue;
          }
          if (reCommentFrag.test(frag.content)) {
            omitNextNewline = true;
            continue;
          }
          yield frag;
        }
      }
    }),
    trimTop: Object.freeze({
      ...basic.trimTop,
      newline: function*(text: TextFragment) {
        // Iterating in reverse, the newline will come before the comment.
        // We'll just hold on to the newline fragment until we know a
        // comment isn't following it.
        let newLineFragment: UndefOr<TextFragment> = undefined;
        for (const frag of basic.trimTop.newline(text)) {
          if (frag.content === "\n") {
            // Emit the previous newline fragment if we have one.
            if (newLineFragment) yield newLineFragment;
            // Store the newline until we check the next fragment.
            newLineFragment = frag;
            continue;
          }
          if (reCommentFrag.test(frag.content)) {
            // Don't emit either if we got a comment.
            newLineFragment = undefined;
            continue;
          }
          if (newLineFragment) {
            // Not a newline or comment, yield the stored newline.
            yield newLineFragment;
            newLineFragment = undefined;
          }
          yield frag;
        }
      }
    }),
    doNotTrim: {
      ...basic.doNotTrim,
      preProcess: (assembly) => chain(basic.doNotTrim.preProcess(assembly))
        .map((frag) => removeComments.trimBottom.newline(frag))
        .flatten()
        .value()
    }
  });

  /** Ensures `srcProvider` is a {@link TrimProvider}. */
  const asProvider = (srcProvider: TrimDirection | TrimProvider) => assertExists(
    `Expected \`${srcProvider}\` to be mappable to a provider.`,
    isString(srcProvider) ? basic[srcProvider] : srcProvider
  );

  /**
   * A sequencer is an abstraction that yields longer and longer arrays
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
        options = Object.assign({}, { bufferSize }, options);
        return tokenizerService.prependEncoder(codec, toEncode, options);
      };

      return (codec, toEncode, options) => {
        options = Object.assign({}, { bufferSize }, options);
        return tokenizerService.appendEncoder(codec, toEncode, options);
      };
    });

    const prepareInnerChunk: TextSequencer["prepareInnerChunk"] = dew(() => {
      if (reversed) return (current, last) => {
        if (!last) return mergeFragments(current.fragments);
        const diff = current.fragments.length - last.fragments.length;
        return mergeFragments(current.fragments.slice(0, diff));
      };
      return (current, last) => {
        if (!last) return mergeFragments(current.fragments);
        const diff = current.fragments.length - last.fragments.length;
        return mergeFragments(current.fragments.slice(-diff));
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
   * Converts a {@link TrimProvider} or {@link TrimDirection} into a
   * {@link TextSequencer} that provides a standard set of methods to aid
   * the trimming process.
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