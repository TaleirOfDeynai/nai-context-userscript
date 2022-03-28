import { dew } from "../utils/dew";
import { usModule } from "../utils/usModule";
import { assert, assertExists } from "../utils/assert";
import { iterReverse, journey } from "../utils/iterables";
import TextSplitterService from "./TextSplitterService";
import TokenizerService from "./TokenizerService";
import type { ContextConfig } from "../naiModules/Lorebook";
import type { TokenCodec, StreamEncodeFn, EncodeResult } from "./TokenizerService";
import type { TextFragment, TextOrFragment } from "./TextSplitterService";

export interface TrimOptions {
  prefix: ContextConfig["prefix"];
  suffix: ContextConfig["suffix"];
  trimDirection: ContextConfig["trimDirection"];
  maximumTrimType: ContextConfig["maximumTrimType"];
  /**
   * This trimmer uses a technique that will drop "non-content" characters
   * from the start and end of the string.  This should just be whitespace.
   * Setting this to `true` will ensure these fragments are not lost.
   */
  preserveEnds: boolean;
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


interface TextSequencer {
  /** Function used to break text into fragments. */
  splitUp: (text: TextOrFragment) => Iterable<TextFragment>;
  /** Encoder to use with this sequencer. */
  encode: StreamEncodeFn;
  /** Gets the text fragment to use with the next sequencer. */
  prepareInnerChunk: (current: EncodeResult, last?: EncodeResult) => TextFragment;
  /** The trim direction this sequencer is intended for. */
  trimDirection: "trimTop" | "trimBottom";
}

type TrimExecResult = [content: TextFragment, tokenCount: number];

export default usModule((require, exports) => {
  const splitterService = TextSplitterService(require);
  const tokenizerService = TokenizerService(require);

  const { hasWords, asContent, asFragment, mergeFragments } = splitterService;

  const defaultOptions: TrimOptions = {
    prefix: "",
    suffix: "",
    trimDirection: "trimBottom",
    maximumTrimType: "token",
    preserveEnds: false
  };

  // I'm not going to beat around the bush.  This will be quite ugly and
  // am just going to do this in the most straight forward way possible.

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
    /** One of the splitting methods from {@link TextSplitterService} */
    splitterFn: (text: TextOrFragment) => Iterable<TextFragment>,
    /** The size of the encoder's unverified tokens buffer. */
    bufferSize: number,
    /** The direction this sequencer is for. */
    trimDirection: "trimTop" | "trimBottom"
  ): TextSequencer => {
    const encode = assertExists("Expected an affirmative trim direction.", dew(() => {
      switch (trimDirection) {
        case "trimTop": return (codec, toEncode, options) => {
          options = Object.assign({}, { bufferSize }, options);
          return tokenizerService.prependEncoder(codec, toEncode, options);
        };
        case "trimBottom": return (codec, toEncode, options) => {
          options = Object.assign({}, { bufferSize }, options);
          return tokenizerService.appendEncoder(codec, toEncode, options);
        };
        default: return undefined;
      }
    }));

    const prepare = assertExists("Expected an affirmative trim direction.", dew(() => {
      switch (trimDirection) {
        case "trimTop": return (current, last) => {
          if (!last) return mergeFragments(current.fragments);
          const diff = current.fragments.length - last.fragments.length;
          return mergeFragments(current.fragments.slice(0, diff));
        };
        case "trimBottom": return (current, last) => {
          if (!last) return mergeFragments(current.fragments);
          const diff = current.fragments.length - last.fragments.length;
          return mergeFragments(current.fragments.slice(diff));
        };
        default: return undefined;
      }
    }));

    return {
      splitUp: splitterFn,
      encode,
      prepareInnerChunk: prepare,
      trimDirection
    };
  }

  const seqTrimBottom = Object.freeze([
    /** For `trimBottom` and `newline`. */
    makeSequencer(
      splitterService.byLine,
      10, "trimBottom"
    ),
    /** For `trimBottom` and `sentence`. */
    makeSequencer(
      splitterService.bySentence,
      5, "trimBottom"
    ),
    /** For `trimBottom` and `token`. */
    makeSequencer(
      splitterService.byWord,
      5, "trimBottom"
    )
  ] as const);

  const seqTrimTop = Object.freeze([
    /** For `trimTop` and `newline`. */
    makeSequencer(
      splitterService.byLineFromEnd,
      10, "trimTop"
    ),
    /** For `trimTop` and `sentence`. */
    makeSequencer(
      (text) => iterReverse(splitterService.bySentence(text)),
      5, "trimTop"
    ),
    /** For `trimTop` and `token`. */
    makeSequencer(
      (text) => iterReverse(splitterService.byWord(text)),
      5, "trimTop"
    )
  ] as const);

  const getSequencersFor = (
    trimDirection: Exclude<ContextConfig["trimDirection"], "doNotTrim">,
    maximumTrimType: ContextConfig["maximumTrimType"]
  ): TextSequencer[] => {
    const sequencers = trimDirection === "trimBottom" ? seqTrimBottom : seqTrimTop;
    // Do not return these arrays directly.
    switch (maximumTrimType) {
      case "token": return sequencers.slice();
      case "sentence": return sequencers.slice(0, -1);
      case "newline": return sequencers.slice(0, -2);
    }
  };

  /**
   * Given a sequence of text fragments and a token count, builds a complete
   * text fragment.
   */
  const resultFrom = (
    fragParts: readonly TextFragment[],
    tokenCount: number
  ): TrimExecResult => {
    assert("Expected at least one text fragment.", fragParts.length > 0);
    const content = fragParts.map(asContent).join("");
    const [{ offset }] = fragParts;
    return [{ content, offset }, tokenCount];
  };

  /** A special execution function just for `noTrim`. */
  async function execNoTrim(
    prefix: string, content: TextFragment, suffix: string,
    tokenBudget: number, preserveInitial: boolean,
    maximumTrimType: TrimOptions["maximumTrimType"],
    codec: TokenCodec
  ): Promise<TrimExecResult | undefined> {
    const fragments: TextFragment[] = dew(() => {
      if (preserveInitial) return [content];
      // For absolute consistency in how trimming behaves, we're going to
      // split by the maximum trim allowed (except `token`) and journey
      // through the meaningful fragments.
      switch (maximumTrimType) {
        case "newline": return [...journey(splitterService.byLine(content), hasWords)];
        default: return [...journey(splitterService.bySentence(content), hasWords)];
      }
    });
    const fullText = [prefix, ...fragments.map(asContent), suffix].join("");
    const tokenCount = (await codec.encode(fullText)).length;
    if (tokenCount > tokenBudget) return undefined;
    return resultFrom(fragments, tokenCount);
  };

  async function execTrim(
    sequencers: TextSequencer[],
    prefix: string, content: TextFragment, suffix: string,
    tokenBudget: number, preserveInitial: boolean, codec: TokenCodec,
    seedResult?: EncodeResult
  ): Promise<TrimExecResult | undefined> {
    // If we have no sequencers left, end recursion.
    if (!sequencers.length) return undefined;
    // Split the current sequencer from the rest.
    const [sequencer, ...restSequencers] = sequencers;

    const fragments
      = preserveInitial ? sequencer.splitUp(content)
      : journey(sequencer.splitUp(content), hasWords);
    
    const encoding = sequencer.encode(codec, fragments, {
      prefix, suffix, seedResult
    });
    
    let lastResult: EncodeResult | undefined = undefined;
    for await (const curResult of encoding) {
      if (curResult.tokens.length <= tokenBudget) {
        lastResult = curResult;
        continue;
      }
      // We've busted the budget.  The problematic fragment can be gleaned
      // from the difference in the `fragments` of our last and current
      // results.  However, we do need to account for trim direction.
      const nextChunk = sequencer.prepareInnerChunk(curResult, lastResult);
      const innerResult = await execTrim(
        restSequencers,
        prefix, nextChunk, suffix,
        tokenBudget, preserveInitial, codec,
        lastResult
      );

      // Use this result if we got one...
      if (innerResult) return innerResult;
      // ...and the current `lastResult` otherwise.
      break;
    }

    if (!lastResult) return undefined;
    return resultFrom(lastResult.fragments, lastResult.tokens.length);
  }

  async function trim(
    content: TextOrFragment,
    tokenBudget: number,
    codec: TokenCodec,
    options?: Partial<TrimOptions>
  ): Promise<TrimResult | undefined> {
    const { prefix, suffix, preserveEnds, trimDirection, maximumTrimType }
      = { ...defaultOptions, ...options };
    const fragment = asFragment(content);

    // It's pretty common to hear "one token is around 4 characters" tossed
    // around.  We'll use this to guesstimate how likely we are to bust the
    // budget.  If we're below this threshold, we'll hail-mary on doing a
    // single, bulk encode as a sanity check.  Otherwise, we'll go the
    // longer and more thorough route.
    if (trimDirection === "doNotTrim" || fragment.content.length <= (tokenBudget * 4)) {
      const noTrimResult = await execNoTrim(
        prefix, fragment, suffix,
        tokenBudget, preserveEnds, maximumTrimType,
        codec
      );

      // No need to go any further if we have a result.
      if (noTrimResult) return {
        prefix,
        fragment: noTrimResult[0],
        suffix,
        tokenCount: noTrimResult[1]
      };

      // We're also done if we can't trim.
      if (trimDirection === "doNotTrim") return undefined;
    }

    // Now we get complicated!
    const sequencers = getSequencersFor(trimDirection, maximumTrimType);
    const complexResult = await execTrim(
      sequencers,
      prefix, fragment, suffix, 
      tokenBudget, preserveEnds,
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

  return Object.assign(exports, {
    trim
  });
});