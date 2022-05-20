import { dew } from "@utils/dew";
import { isFunction } from "@utils/is";
import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import { chain, journey, buffer } from "@utils/iterables";
import { toReplay, ReplaySource } from "@utils/asyncIterables";
import $TextSplitterService from "./TextSplitterService";
import $TrimmingProviders from "./TrimmingProviders";

import type { UndefOr } from "@utils/utility-types";
import type { ReplayWrapper } from "@utils/asyncIterables";
import type { ContextConfig } from "@nai/Lorebook";
import type { EncodeResult } from "./TokenizerService";
import type { TextFragment, TextOrFragment } from "./TextSplitterService";
import type { TrimDirection, TrimType } from "./TrimmingProviders";
import type { TrimProvider, TextSequencer } from "./TrimmingProviders";
import type { ContextParams } from "./ParamsService";

export interface TrimOptions {
  /**
   * An explicit {@link TrimProvider} to use or a {@link TrimDirection}
   * indicating the common provider to use.
   */
  provider: TrimDirection | TrimProvider;
  /**
   * The maximum {@link TrimType} allowed.  Ignored if
   * {@link TrimOptions.provider provider} is set to `doNotTrim`.
   */
  maximumTrimType: TrimType;
  /**
   * This trimmer uses a technique that will drop "non-content" characters
   * from the start and end of the string.  This should just be whitespace.
   * Setting this to `true` will ensure these fragments are not lost.
   */
  preserveEnds: boolean;

  prefix: ContextConfig["prefix"];
  suffix: ContextConfig["suffix"];
}

export interface TrimmedContent {
  /** The prefix used during the trim. */
  readonly prefix: ContextConfig["prefix"];
  /** The inner fragment of the trimmed text. */
  readonly fragments: readonly TextFragment[];
  /** The suffix used during the trim. */
  readonly suffix: ContextConfig["suffix"];
}

export interface TokenizedContent extends TrimmedContent {
  /**
   * The array of tokens for the full content, built from the concatenation
   * of `prefix`, `content`, and `suffix`.
   */
  readonly tokens: readonly number[];
}

export interface TrimResult extends EncodeResult {
  split(): AsyncIterable<TrimResult>;
}

export interface Trimmer extends AsyncIterable<TrimResult> {
  prefix: string;
  fragments: TextFragment[];
  suffix: string;
};

export interface ReplayTrimResult extends EncodeResult {
  split(): ReplayWrapper<ReplayTrimResult>;
}

export interface ReplayTrimmer extends ReplayWrapper<ReplayTrimResult> {
  prefix: string;
  fragment: TextFragment;
  suffix: string;
};

/**
 * Basically a compatibility identity function for {@link toReplay}.
 * If a zero-arity async generator function is given, it calls it and
 * returns the async iterable.
 */
const noReplay = <T>(source: ReplaySource<T>): AsyncIterable<T> =>
  isFunction(source) ? source() : source;

const EMPTY = async function*() {};

export default usModule((require, exports) => {
  const splitterService = $TextSplitterService(require);
  const providers = $TrimmingProviders(require);

  const { hasWords } = splitterService;

  const optionDefaults: TrimOptions = {
    provider: "doNotTrim",
    maximumTrimType: "token",
    preserveEnds: true,
    prefix: "",
    suffix: ""
  };

  // I'm not going to beat around the bush.  This will be quite ugly and
  // am just going to do this in the most straight forward way possible.
  // PS: it was straight-forward and now it is not.

  /**
   * Creates a trimmer that provides replay caching, which can save work,
   * at the cost of a larger memory footprint, if the content may need to
   * be trimmed multiple times.
   */
  function createTrimmer(
    content: TextOrFragment,
    contextParams: ContextParams,
    options: Partial<TrimOptions>,
    doReplay: true
  ): ReplayTrimmer;
  /**
   * Creates a trimmer that provides no replay caching.  If the content
   * needs to be trimmed multiple times, it will need to re-run the token
   * encoder on fragments it has already encoded before.
   */
  function createTrimmer(
    content: TextOrFragment,
    contextParams: ContextParams,
    options?: Partial<TrimOptions>,
    doReplay?: false
  ): Trimmer;
  /**
   * Creates a trimmer.  It is ambiguous whether or not it does replay caching.
   */
  function createTrimmer(
    content: TextOrFragment,
    contextParams: ContextParams,
    options: Partial<TrimOptions>,
    doReplay: boolean
  ): Trimmer | ReplayTrimmer;
  // Actual implementation.
  function createTrimmer(
    content: TextOrFragment,
    contextParams: ContextParams,
    options?: Partial<TrimOptions>,
    doReplay = false
  ): Trimmer | ReplayTrimmer {
    const { tokenCodec } = contextParams;

    const config = { ...optionDefaults, ...options };
    const provider = providers.asProvider(config.provider);
    const fragments = provider.preProcess(content);
    const sequencers = providers.getSequencersFrom(provider, config.maximumTrimType);
    const { prefix, suffix } = config;
    const wrapperFn = doReplay ? toReplay : noReplay;

    const nextSplit = (
      content: Iterable<TextFragment>,
      sequencers: TextSequencer[],
      preserveMode: "initial" | "ends" | "none",
      seedResult?: Readonly<EncodeResult>
    ) => {
      if (sequencers.length === 0) return EMPTY;

      const [sequencer, ...restSequencers] = sequencers;

      return async function*() {
        const fragments = dew(() => {
          const splitFrags = chain(content)
            .map(sequencer.splitUp)
            .flatten();
          switch (preserveMode) {
            case "ends": return splitFrags.value();
            case "initial": return splitFrags
              .thru((iter) => buffer(iter, hasWords, false))
              .flatten()
              .value();
            default: return splitFrags
              .thru((iter) => journey(iter, hasWords))
              .value();
          }
        });

        const encoding = sequencer.encode(tokenCodec, fragments, {
          prefix, suffix, seedResult
        });

        let lastResult = seedResult;
        for await (const curResult of encoding) {
          // `lastResult` is a mutable variable.  Copy the reference into a
          // block-scoped constant.
          const capturedLastResult = lastResult;
          yield Object.freeze(Object.assign(curResult, {
            split() {
              const nextChunk = sequencer.prepareInnerChunk(curResult, capturedLastResult);

              return wrapperFn(nextSplit(
                [nextChunk],
                restSequencers,
                // Use "initial" mode for recursive calls instead of "none".
                preserveMode === "ends" ? "ends" : "initial",
                capturedLastResult
              ));
            }
          }));
          lastResult = curResult;
        }
      };
    }

    return Object.assign(
      wrapperFn(nextSplit(
        fragments,
        sequencers,
        config.preserveEnds ? "ends" : "none"
      )),
      { prefix, fragments: [...fragments], suffix }
    );
  }

  /**
   * Given a sequence of text fragments and a token count, builds a complete
   * text fragment.
   */
  const tokenResultFrom = (
    prefix: string,
    fragments: readonly TextFragment[],
    suffix: string,
    tokens: readonly number[]
  ): TokenizedContent => {
    assert("Expected at least one text fragment.", fragments.length > 0);
    return { prefix, suffix, tokens, fragments };
  };

  /**
   * Executes the given `trimmer`, searching for a result that is below the
   * given `tokenBudget`.
   */
  async function execTrimTokens(
    trimmer: Trimmer,
    tokenBudget: number
  ): Promise<UndefOr<TokenizedContent>> {
    // Ensue the budget is valid.
    tokenBudget = Math.max(0, tokenBudget);

    /** The current iterator; we'll change this when we split. */
    let iterator: AsyncIterable<TrimResult> = trimmer;
    /** The last in-budget result. */
    let lastResult: UndefOr<TrimResult> = undefined;

    for await (const curResult of iterator) {
      if (curResult.tokens.length <= tokenBudget) lastResult = curResult;
      // We've busted the budget.  We can simply attempt to split into
      // the current result.  If it yields something, this loop may
      // continue.  If not, we'll end it here.
      else iterator = curResult.split();
    }

    return !lastResult ? undefined : tokenResultFrom(
      trimmer.prefix,
      lastResult.fragments,
      trimmer.suffix,
      lastResult.tokens
    );
  }

  /**
   * Trims the given `content` so it fits within a certain `tokenBudget`.
   * Provide options to tailor the trimming to your needs.
   * 
   * Returns `undefined` if the content could not be trimmed to fit the
   * desired budget with the given constraints.
   * 
   * This function creates a new {@link Trimmer} on the fly.  If you have a
   * {@link ReplayTrimmer} for this content already, call {@link execTrimTokens}
   * directly and pass it in to avoid repeat work.
   */
  async function trimByTokens(
    /** The content to trim. */
    content: TextOrFragment,
    /** The token budget. */
    tokenBudget: number,
    /** The context parameters object. */
    contextParams: ContextParams,
    /** Trimming options. */
    options?: Partial<TrimOptions>
  ): Promise<UndefOr<TokenizedContent>> {
    // Create a single-use trimmer and execute.
    const trimmer = createTrimmer(content, contextParams, options);
    return await execTrimTokens(trimmer, tokenBudget);
  }

  function* execTrimLength(
    sequencers: TextSequencer[],
    content: Iterable<TextFragment>,
    maximumLength: number,
    preserveMode: "initial" | "ends" | "none",
    currentLength: number = 0
  ): Iterable<TextFragment> {
    // If we have no sequencers left, end recursion.
    if (!sequencers.length) return;
    // Split the current sequencer from the rest.
    const [sequencer, ...restSequencers] = sequencers;

    const fragments = dew(() => {
      const splitFrags = chain(content)
        .map(sequencer.splitUp)
        .flatten();
      switch (preserveMode) {
        case "ends": return splitFrags.value();
        case "initial": return splitFrags
          .thru((iter) => buffer(iter, hasWords, false))
          .flatten()
          .value();
        default: return splitFrags
          .thru((iter) => journey(iter, hasWords))
          .value();
      }
    });

    for (const buffered of buffer(fragments, hasWords)) {
      const contentLength = buffered.reduce((p, c) => p + c.content.length, 0);
      const nextLength = currentLength + contentLength;

      if (nextLength <= maximumLength) {
        currentLength = nextLength;
        yield* buffered;
      }
      else {
        // Reverse the buffer if the sequencer is reversed.
        if (sequencer.reversed) buffered.reverse();

        yield* execTrimLength(
          restSequencers,
          buffered,
          maximumLength,
          // Use "initial" mode for recursive calls instead of "none".
          preserveMode === "ends" ? "ends" : "initial",
          currentLength
        );
        return;
      }
    }
  }

  /**
   * Trims the given `content` so it is below a certain `maximumLength`.
   * Provide options to tailor the trimming to your needs.
   * 
   * Returns `undefined` if the content could not be trimmed to the desired
   * length with the given constraints.
   * 
   * If the {@link TrimOptions.prefix prefix} or {@link TrimOptions.suffix suffix}
   * options are provided, their length will be subtracted from `maximumLength`
   * prior to performing the trim.
   */
  function trimByLength(
    content: TextOrFragment,
    maximumLength: number,
    options?: Partial<TrimOptions>
  ): UndefOr<TrimmedContent> {
    const { prefix, suffix, preserveEnds, provider: srcProvider, maximumTrimType }
      = { ...optionDefaults, ...options };

    const provider = providers.asProvider(srcProvider);
    const fragments = provider.preProcess(content);
    maximumLength = Math.max(0, maximumLength - (prefix.length + suffix.length));

    // Now we can trim.
    const sequencers = providers.getSequencersFrom(provider, maximumTrimType);
    const trimmedFrags = [...execTrimLength(
      sequencers, fragments, maximumLength,
      preserveEnds ? "ends" : "none"
    )];
    if (trimmedFrags.length === 0) return undefined;
    // Un-reverse if the provider runs in reverse.
    if (provider.reversed) trimmedFrags.reverse();
    
    return {
      prefix,
      fragments: trimmedFrags,
      suffix
    };
  }

  return Object.assign(exports, {
    createTrimmer,
    execTrimTokens,
    trimByTokens,
    trimByLength
  });
});