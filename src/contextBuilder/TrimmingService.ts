import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import { chain, journey, buffer, flatten, flatMap } from "@utils/iterables";
import TextSplitterService from "./TextSplitterService";
import TrimmingProviders from "./TrimmingProviders";

import type { UndefOr } from "@utils/utility-types";
import type { ContextConfig } from "@nai/Lorebook";
import type { TokenCodec, EncodeResult } from "./TokenizerService";
import type { TextFragment, TextOrFragment } from "./TextSplitterService";
import type { TrimDirection, TrimType } from "./TrimmingProviders";
import type { TrimProvider, TextSequencer } from "./TrimmingProviders";

export interface CommonTrimOptions {
  /**
   * An explicit {@link TrimProvider} to use or a {@link TrimDirection}
   * indicating the common provider to use.
   */
  provider: TrimDirection | TrimProvider;
  /**
   * The maximum {@link TrimType} allowed.  Ignored if
   * {@link CommonTrimOptions.provider provider} is set to `doNotTrim`.
   */
  maximumTrimType: TrimType;
  /**
   * This trimmer uses a technique that will drop "non-content" characters
   * from the start and end of the string.  This should just be whitespace.
   * Setting this to `true` will ensure these fragments are not lost.
   */
  preserveEnds: boolean;
}

export interface TokenTrimOptions extends CommonTrimOptions {
  prefix: ContextConfig["prefix"];
  suffix: ContextConfig["suffix"];
}

export interface TrimResult {
  /** The prefix used during the trim. */
  prefix: ContextConfig["prefix"];
  /** The content of the trimmed text. */
  fragment: TextFragment;
  /** The suffix used during the trim. */
  suffix: ContextConfig["suffix"];
  /** 
   * Count of tokens that make up the string resulting from concatenating
   * `prefix`, `content`, and `suffix`.
   */
  tokenCount: number;
}

type TrimExecResult = [content: TextFragment, tokenCount: number];

export default usModule((require, exports) => {
  const splitterService = TextSplitterService(require);
  const providers = TrimmingProviders(require);

  const { hasWords, asContent, asFragment, mergeFragments } = splitterService;

  const commonDefaults: CommonTrimOptions = {
    provider: "doNotTrim",
    maximumTrimType: "token",
    preserveEnds: true
  };

  const tokenDefaults: TokenTrimOptions = {
    ...commonDefaults,
    prefix: "",
    suffix: ""
  };

  // I'm not going to beat around the bush.  This will be quite ugly and
  // am just going to do this in the most straight forward way possible.
  // PS: it was straight-forward and now it is not.

  /**
   * Given a sequence of text fragments and a token count, builds a complete
   * text fragment.
   */
  const tokenResultFrom = (
    fragParts: readonly TextFragment[],
    tokenCount: number
  ): TrimExecResult => {
    assert("Expected at least one text fragment.", fragParts.length > 0);
    const content = fragParts.map(asContent).join("");
    const [{ offset }] = fragParts;
    return [{ content, offset }, tokenCount];
  };

  /**
   * For absolute consistency in how trimming behaves, this will split
   * `content` by the maximum trim allowed (except `token`) and discard
   * non-content fragments if `preserveEnds` is `false`.
   * 
   * Use this whenever you're not using sequenced trimming.
   */
  const makeConsistent = (
    content: TextFragment,
    provider: TrimProvider,
    maximumTrim: TrimType,
    preserveEnds: boolean
  ) => {
    const newlineOnly = maximumTrim === "newline";
    const fragments = chain(provider.newline(content))
      .thru((frags) => newlineOnly ? frags : flatMap(frags, provider.sentence))
      .thru((frags) => preserveEnds ? frags : journey(frags, hasWords))
      .toArray();
    
    if (provider.reversed) fragments.reverse();
    return fragments;
  };

  /** A special execution function just for `noTrim`. */
  async function execNoTrimTokens(
    prefix: string, fragments: TextFragment[], suffix: string,
    tokenBudget: number, codec: TokenCodec
  ): Promise<UndefOr<TrimExecResult>> {
    const fullText = [prefix, ...fragments.map(asContent), suffix].join("");
    const tokenCount = (await codec.encode(fullText)).length;
    if (tokenCount > tokenBudget) return undefined;
    return tokenResultFrom(fragments, tokenCount);
  };

  async function execTrimTokens(
    sequencers: TextSequencer[],
    prefix: string, content: TextFragment, suffix: string,
    tokenBudget: number,
    preserveMode: "initial" | "ends" | "none",
    codec: TokenCodec,
    seedResult?: Readonly<EncodeResult>
  ): Promise<UndefOr<TrimExecResult>> {
    // If we have no sequencers left, end recursion.
    if (!sequencers.length) return undefined;
    // Split the current sequencer from the rest.
    const [sequencer, ...restSequencers] = sequencers;

    const fragments = dew(() => {
      const splitFrags = sequencer.splitUp(content);
      switch (preserveMode) {
        case "ends": return splitFrags;
        case "initial": return flatten(buffer(splitFrags, hasWords, false));
        default: return journey(splitFrags, hasWords);
      }
    });
    
    const encoding = sequencer.encode(codec, fragments, {
      prefix, suffix, seedResult
    });
    
    let lastResult = seedResult;
    for await (const curResult of encoding) {
      if (curResult.tokens.length <= tokenBudget) {
        lastResult = curResult;
        continue;
      }
      // We've busted the budget.  The problematic fragment can be gleaned
      // from the difference in the `fragments` of our last and current
      // results.  However, we do need to account for trim direction.
      const nextChunk = sequencer.prepareInnerChunk(curResult, lastResult);
      const innerResult = await execTrimTokens(
        restSequencers,
        prefix, nextChunk, suffix,
        tokenBudget,
        // Use "initial" mode for recursive calls instead of "none".
        preserveMode === "ends" ? "ends" : "initial",
        codec,
        lastResult
      );

      // Use this result if we got one...
      if (innerResult) return innerResult;
      // ...and the current `lastResult` otherwise.
      break;
    }

    if (!lastResult) return undefined;
    return tokenResultFrom(lastResult.fragments, lastResult.tokens.length);
  }

  /**
   * Trims the given `content` so it fits within a certain `tokenBudget`.
   * Provide options to tailor the trimming to your needs.
   * 
   * Returns `undefined` if the content could not be trimmed to fit the
   * desired budget with the given constraints.
   */
  async function trimByTokens(
    /** The content to trim. */
    content: TextOrFragment,
    /** The token budget. */
    tokenBudget: number,
    /** The {@link TokenCodec} to use for token counting. */
    codec: TokenCodec,
    /** Trimming options. */
    options?: Partial<TokenTrimOptions>
  ): Promise<UndefOr<TrimResult>> {
    const { prefix, suffix, preserveEnds, provider: srcProvider, maximumTrimType }
      = { ...tokenDefaults, ...options };

    const provider = providers.asProvider(srcProvider);
    const fragment = provider.preProcess(content);
    tokenBudget = Math.max(0, tokenBudget);

    // It's pretty common to hear "one token is around 4 characters" tossed
    // around.  We'll use a conservative value of `3.5` to guesstimate how
    // likely we are to bust the budget.  If we're below this threshold, 
    // we'll hail-mary on doing a single, bulk encode as a sanity check.
    // Otherwise, we'll immediately take the longer and more thorough route.
    if (provider.noSequencing || fragment.content.length <= (tokenBudget * 3.5)) {
      const fragments = [...makeConsistent(
        fragment, provider, maximumTrimType, preserveEnds
      )];

      // The provider may do its own fragment filtering.
      if (!fragments.length) return undefined;

      const noTrimResult = await execNoTrimTokens(
        prefix, fragments, suffix,
        tokenBudget, codec
      );

      // No need to go any further if we have a result.
      if (noTrimResult) return {
        prefix,
        fragment: noTrimResult[0],
        suffix,
        tokenCount: noTrimResult[1]
      };

      // We're also done if we can't do sequencer trimming.
      if (provider.noSequencing) return undefined;
    }

    // Now we get complicated!
    const sequencers = providers.getSequencersFrom(provider, maximumTrimType);
    const complexResult = await execTrimTokens(
      sequencers,
      prefix, fragment, suffix, 
      tokenBudget,
      preserveEnds ? "ends" : "none",
      codec
    );

    if (complexResult) return {
      prefix,
      fragment: complexResult[0],
      suffix,
      tokenCount: complexResult[1]
    };

    return undefined;
  }

  function* execTrimLength(
    sequencers: TextSequencer[],
    content: TextFragment,
    maximumLength: number,
    preserveMode: "initial" | "ends" | "none",
    currentLength: number = 0
  ): Iterable<TextFragment> {
    // If we have no sequencers left, end recursion.
    if (!sequencers.length) return;
    // Split the current sequencer from the rest.
    const [sequencer, ...restSequencers] = sequencers;

    const fragments = dew(() => {
      const splitFrags = sequencer.splitUp(content);
      switch (preserveMode) {
        case "ends": return splitFrags;
        case "initial": return flatten(buffer(splitFrags, hasWords, false));
        default: return journey(splitFrags, hasWords);
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
          mergeFragments(buffered),
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
   * Unlike {@link trimByTokens}, this function does not support the
   * {@link TokenTrimOptions.prefix prefix} or {@link TokenTrimOptions.suffix suffix}
   * options.  Just subtract the lengths of your prefix and suffix from
   * the `maximumLength` instead.
   */
  function trimByLength(
    content: TextOrFragment,
    maximumLength: number,
    options?: Partial<CommonTrimOptions>
  ): UndefOr<TextFragment> {
    const { preserveEnds, provider: srcProvider, maximumTrimType }
      = { ...commonDefaults, ...options };

    const provider = providers.asProvider(srcProvider);
    const fragment = provider.preProcess(content);
    maximumLength = Math.max(0, maximumLength);

    // Do the easy things.
    if (fragment.content.length <= maximumLength) {
      const fragments = [...makeConsistent(
        fragment, provider, maximumTrimType, preserveEnds
      )];

      // The provider may do its own fragment filtering.
      if (!fragments.length) return undefined;
      return mergeFragments(fragments);
    }

    if (provider.noSequencing) return undefined;

    // Now we can trim.
    const sequencers = providers.getSequencersFrom(provider, maximumTrimType);
    const trimmedFrags = [...execTrimLength(
      sequencers, fragment, maximumLength,
      preserveEnds ? "ends" : "none"
    )];
    if (trimmedFrags.length === 0) return undefined;
    // Un-reverse if the provider runs in reverse.
    if (provider.reversed) trimmedFrags.reverse();
    return mergeFragments(trimmedFrags);
  }

  return Object.assign(exports, {
    trimByTokens,
    trimByLength
  });
});