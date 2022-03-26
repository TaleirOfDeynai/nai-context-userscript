import { dew } from "../utils/dew";
import { usModule } from "../utils/usModule";
import { assert } from "../utils/assert";
import { iterReverse, journey, first, last } from "../utils/iterables";
import TextSplitterService from "./TextSplitterService";
import type { ContextConfig } from "../naiModules/Lorebook";
import type { TokenCodec } from "./TokenizerService";
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
  /**
   * A function that iteratively yields more and more of `text` according
   * to some strategy.
   */
  sequence(
    /** The text to sequence. */
    text: TextOrFragment,
    /** Whether to preserve non-content fragments from the start of source string. */
    preserveInitial: boolean
  ): Iterable<TextFragment[]>;
  /** The trim direction this sequencer is intended for. */
  trimDirection: "trimTop" | "trimBottom";
}

type TrimExecResult = [content: TextFragment, tokenCount: number];

export default usModule((require, exports) => {
  const splitterService = TextSplitterService(require);

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
    /** A buffer finalizer function; must produce a copy of the buffer. */
    bufferFn: (buffer: readonly TextFragment[]) => TextFragment[],
    /** The direction this sequencer is for. */
    trimDirection: "trimTop" | "trimBottom"
  ): TextSequencer => {
    function* sequence(text: TextOrFragment, preserveInitial: boolean) {
      const buffer: TextFragment[] = [];

      // We need to be careful when preserving the initial fragments.
      // Our `splitterFn` may be splitting up a massive string in an
      // unusual way that is only efficient if we only take what we need
      // from the iterator, so we can't materialize the entire iterable
      // into an array.
      const iterable = dew(() => {
        const splitFrags = splitterFn(text);
        if (!preserveInitial) return splitFrags;

        return dew(function*() {
          // Dump straight into the buffer until we're out of the initial
          // non-content fragments.
          let outOfInitial = false;
          for (const frag of splitFrags) {
            outOfInitial = outOfInitial || splitterService.hasWords(frag);
            if (outOfInitial) yield frag;
            else buffer.push(frag);
          }
        });
      });

      for (const frag of journey(iterable, splitterService.hasWords)) {
        buffer.push(frag);
        // Yield after pushing a contentful fragment.
        if (splitterService.hasWords(frag)) yield bufferFn(buffer);
      }
    }

    return { sequence, trimDirection };
  }

  const seqTrimBottom = Object.freeze([
    /** For `trimBottom` and `newline`. */
    makeSequencer(
      splitterService.byLine,
      (b) => [...b],
      "trimBottom"
    ),
    /** For `trimBottom` and `sentence`. */
    makeSequencer(
      splitterService.bySentence,
      (b) => [...b],
      "trimBottom"
    ),
    /** For `trimBottom` and `token`. */
    makeSequencer(
      splitterService.byWord,
      (b) => [...b],
      "trimBottom"
    )
  ] as const);

  const seqTrimTop = Object.freeze([
    /** For `trimTop` and `newline`. */
    makeSequencer(
      splitterService.byLineFromEnd,
      (b) => [...b].reverse(),
      "trimTop"
    ),
    /** For `trimTop` and `sentence`. */
    makeSequencer(
      (text) => iterReverse(splitterService.bySentence(text)),
      (b) => [...b].reverse(),
      "trimTop"
    ),
    /** For `trimTop` and `token`. */
    makeSequencer(
      (text) => iterReverse(splitterService.byWord(text)),
      (b) => [...b].reverse(),
      "trimTop"
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

  /** Gonna be using this one a bit. */
  const getContent = (frag: TextFragment): string => frag.content;

  /**
   * Given a sequence of text fragments and a token codec, calculates the token
   * count and builds a complete text fragment.
   */
  const resultFromCodec = async (
    prefix: string,
    fragParts: TextFragment[],
    suffix: string,
    codec: TokenCodec
  ): Promise<TrimExecResult> => {
    assert("Expected at least one text fragment.", fragParts.length > 0);
    const content = fragParts.map(getContent).join("");
    const tokenCount = (await codec.encode([prefix, content, suffix].join(""))).length;
    const [{ offset }] = fragParts;
    return [{ content, offset }, tokenCount];
  };

  /**
   * Given a sequence of text fragments and a token count, builds a complete
   * text fragment.
   */
  const resultFrom = (
    fragParts: TextFragment[],
    tokenCount: number
  ): TrimExecResult => {
    assert("Expected at least one text fragment.", fragParts.length > 0);
    const content = fragParts.map(getContent).join("");
    const [{ offset }] = fragParts;
    return [{ content, offset }, tokenCount];
  };

  /** A special execution function just for `noTrim`. */
  async function execNoTrim(
    prefix: string, content: TextFragment, suffix: string,
    tokenBudget: number, preserveInitial: boolean, codec: TokenCodec
  ): Promise<TrimExecResult | undefined> {
    const contentText = preserveInitial ? content.content : content.content.trim();
    const fullText = [prefix, contentText, suffix].join("");
    const tokenCount = (await codec.encode(fullText)).length;
    if (tokenCount > tokenBudget) return undefined;
    return [content, tokenCount];
  };

  async function execTrim(
    sequencers: TextSequencer[],
    prefix: string, content: TextFragment, suffix: string,
    tokenBudget: number, preserveInitial: boolean, codec: TokenCodec
  ): Promise<TrimExecResult | undefined> {
    // If we have no sequencers left, end recursion.
    if (!sequencers.length) return undefined;
    // Split the current sequencer from the rest.
    const [sequencer, ...restSequencers] = sequencers;

    // If we end up going through all parts of the string without busting
    // the budget, this will contain the last item of the loop.
    let lastResult: TrimExecResult | undefined = undefined;
    for (const fragParts of sequencer.sequence(content, preserveInitial)) {
      const curResult = await resultFromCodec(prefix, fragParts, suffix, codec);
      const [, tokenCount] = curResult;
      if (tokenCount < tokenBudget) {
        lastResult = curResult;
        continue;
      }

      // We bust the budget.  Try and trim down this last part.
      // If we get `undefined` back, then we've hit our trimming wall.

      // Because of `journey` and how the text splitters work, we know that 
      // the first and last fragments will always contain meaningful content.
      // We'll exploit this to extract the part that is fed into the next
      // sequencer for trimming.

      // We have two ways we can recurse, depending on how we're trimming.
      // We're going to tack the current WIP content onto either `prefix`
      // or `suffix` so that it's included in the token count.
      switch (sequencer.trimDirection) {
        case "trimBottom": {
          // All but the last fragment was budgeted.
          const budgetedFragments = fragParts.slice(0, -1);
          const nextPrefix = [prefix, ...budgetedFragments.map(getContent)].join("");
          const result = await execTrim(
            restSequencers,
            nextPrefix,
            last(fragParts) as any,
            suffix,
            tokenBudget,
            preserveInitial,
            codec
          );
          if (!result) return lastResult;
          return resultFrom([...budgetedFragments, result[0]], result[1]);
        }
        case "trimTop": {
          // All but the first fragment was budgeted.
          const budgetedFragments = fragParts.slice(1);
          const nextSuffix = [...budgetedFragments.map(getContent), suffix].join("");
          const result = await execTrim(
            restSequencers,
            prefix,
            first(fragParts) as any,
            nextSuffix,
            tokenBudget,
            preserveInitial,
            codec
          );
          if (!result) return lastResult;
          return resultFrom([result[0], ...budgetedFragments], result[1]);
        }
      }
    }
    return lastResult;
  }

  async function trim(
    content: TextOrFragment,
    tokenBudget: number,
    codec: TokenCodec,
    options?: Partial<TrimOptions>
  ): Promise<TrimResult | undefined> {
    const { prefix, suffix, preserveEnds, trimDirection, maximumTrimType }
      = { ...defaultOptions, ...options };
    const fragment = splitterService.asFragment(content);

    // First, we're going to do a check without trimming.
    const quickResult = await execNoTrim(
      prefix,
      fragment,
      suffix,
      tokenBudget,
      preserveEnds,
      codec
    );

    // No need to go any further if we have a result.
    if (quickResult) return {
      prefix,
      fragment: quickResult[0],
      suffix: suffix,
      tokenCount: quickResult[1]
    };

    // We're also done if we can't trim.
    if (trimDirection === "doNotTrim") return undefined;

    // Now we get complicated!
    const sequencers = getSequencersFor(trimDirection, maximumTrimType);
    const complexResult = await execTrim(
      sequencers,
      prefix, fragment, suffix, 
      tokenBudget, preserveEnds, codec
    );

    if (complexResult) return {
      prefix,
      fragment: complexResult[0],
      suffix: suffix,
      tokenCount: complexResult[1]
    };

    return undefined;
  }

  return Object.assign(exports, {
    trim
  });
});