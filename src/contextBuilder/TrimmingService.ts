import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import { reduceIter, journey, buffer, flatMap, flatten } from "@utils/iterables";
import { toReplay, lastValueFrom } from "@utils/asyncIterables";
import $TextSplitterService from "./TextSplitterService";
import $TokenizerService from "./TokenizerService";
import $TrimmingProviders from "./TrimmingProviders";
import $FragmentAssembly from "./assemblies/Fragment";
import $TokenizedAssembly from "./assemblies/Tokenized";

import type { UndefOr } from "@utils/utility-types";
import type { ReplayWrapper } from "@utils/asyncIterables";
import type { AugmentedTokenCodec, EncodeResult } from "./TokenizerService";
import type { TextFragment } from "./TextSplitterService";
import type { TrimDirection, TrimType } from "./TrimmingProviders";
import type { TrimProvider, TextSequencer } from "./TrimmingProviders";
import type { ContextParams } from "./ParamsService";
import type { Assembly } from "./assemblies";

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
}

export interface TrimResult {
  readonly assembly: Assembly.Tokenized;
  readonly split: () => AsyncIterable<TrimResult>;
}

export interface Trimmer {
  (): AsyncIterable<TrimResult>;
  readonly provider: TrimProvider;
  readonly origin: Assembly.AnyFragment;
};

export interface ReplayTrimResult {
  readonly assembly: Assembly.Tokenized;
  readonly split: ReplayWrapper<ReplayTrimResult>;
}

export interface ReplayTrimmer extends ReplayWrapper<ReplayTrimResult> {
  readonly provider: TrimProvider;
  readonly origin: Assembly.AnyFragment;
};

const EMPTY = async function*() {};

export default usModule((require, exports) => {
  const providers = $TrimmingProviders(require);
  const { hasWords } = $TextSplitterService(require);
  const { appendEncoder } = $TokenizerService(require);
  const fragAssembly = $FragmentAssembly(require);
  const tokenAssembly = $TokenizedAssembly(require);

  const optionDefaults: TrimOptions = {
    provider: "doNotTrim",
    maximumTrimType: "token",
    preserveEnds: true
  };

  /** Constructs a result, with an assembly, from the given parameters. */
  const makeTrimResult = async (
    origin: Assembly.IFragment,
    encodeResult: EncodeResult,
    split: TrimResult["split"],
    codec: AugmentedTokenCodec
  ): Promise<TrimResult> => {
    const { fragments, tokens } = encodeResult;
    assert("Expected at least one text fragment.", fragments.length > 0);

    const assembly = await tokenAssembly.fromDerived(
      fragments, origin,
      { codec, tokens }
    );

    return Object.freeze({ assembly, split });
  }

  // I'm not going to beat around the bush.  This will be quite ugly and
  // am just going to do this in the most straight forward way possible.
  // PS: it was straight-forward and now it is not.

  /**
   * Creates a trimmer that provides replay caching, which can save work,
   * at the cost of a larger memory footprint, if the content may need to
   * be trimmed multiple times.
   */
  function createTrimmer(
    assembly: Assembly.AnyFragment,
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
    assembly: Assembly.AnyFragment,
    contextParams: ContextParams,
    options?: Partial<TrimOptions>,
    doReplay?: false
  ): Trimmer;
  /**
   * Creates a trimmer.  It is ambiguous whether or not it does replay caching.
   */
  function createTrimmer(
    assembly: Assembly.AnyFragment,
    contextParams: ContextParams,
    options: Partial<TrimOptions>,
    doReplay: boolean
  ): Trimmer | ReplayTrimmer;
  // Actual implementation.
  function createTrimmer(
    assembly: Assembly.AnyFragment,
    contextParams: ContextParams,
    options?: Partial<TrimOptions>,
    doReplay = false
  ): Trimmer | ReplayTrimmer {
    const { tokenCodec } = contextParams;

    const config = { ...optionDefaults, ...options };
    const provider = providers.asProvider(config.provider);

    if (provider.noSequencing) {
      // When we're not sequencing, we'll just run the append encoder
      // directly and immediately encode all the fragments.  We could
      // potentially just use `tokenCodec.encode` instead, but I would
      // prefer to keep things consistent.
      async function *unSequenced(): AsyncIterable<TrimResult> {
        const encoding = appendEncoder(tokenCodec, provider.preProcess(assembly), {
          prefix: assembly.prefix.content,
          suffix: assembly.suffix.content
        });

        yield await makeTrimResult(
          assembly,
          await lastValueFrom(encoding),
          EMPTY,
          tokenCodec
        );
      };

      return Object.assign(
        doReplay ? toReplay(unSequenced) : unSequenced,
        { origin: assembly, provider }
      );
    }

    const sequencers = providers.getSequencersFrom(provider, config.maximumTrimType);

    const nextSplit = (
      content: Iterable<TextFragment>,
      sequencers: TextSequencer[],
      preserveMode: "initial" | "ends" | "none",
      seedResult?: EncodeResult
    ) => {
      if (sequencers.length === 0) return EMPTY;

      const [sequencer, ...restSequencers] = sequencers;

      return async function*(): AsyncIterable<TrimResult> {
        const fragments = dew(() => {
          const splitFrags = flatMap(content, sequencer.splitUp);
          switch (preserveMode) {
            case "ends": return splitFrags;
            case "initial": return flatten(buffer(splitFrags, hasWords, false));
            default: return journey(splitFrags, hasWords);
          }
        });

        const encoding = sequencer.encode(tokenCodec, fragments, {
          prefix: assembly.prefix.content,
          suffix: assembly.suffix.content,
          seedResult
        });

        let lastResult = seedResult;
        for await (const curResult of encoding) {
          const innerSplit = nextSplit(
            sequencer.prepareInnerChunk(curResult, lastResult),
            restSequencers,
            // Use "initial" mode for recursive calls instead of "none".
            preserveMode === "ends" ? "ends" : "initial",
            lastResult
          );
          yield await makeTrimResult(
            assembly,
            curResult,
            doReplay ? toReplay(innerSplit) : innerSplit,
            tokenCodec
          );
          lastResult = curResult;
        }
      };
    }

    const outerSplit = nextSplit(
      provider.preProcess(assembly),
      sequencers,
      config.preserveEnds ? "ends" : "none"
    );

    return Object.assign(
      doReplay ? toReplay(outerSplit) : outerSplit,
      { origin: assembly, provider }
    );
  }

  /**
   * Executes the given `trimmer`, searching for a result that is below the
   * given `tokenBudget`.
   */
  async function execTrimTokens(
    trimmer: Trimmer,
    tokenBudget: number
  ): Promise<UndefOr<Assembly.Tokenized>> {
    // Ensue the budget is valid.
    tokenBudget = Math.max(0, tokenBudget);

    /** The current iterator; we'll change this when we split. */
    let iterable: UndefOr<AsyncIterable<TrimResult>> = trimmer();
    /** The last in-budget result. */
    let lastResult: UndefOr<TrimResult> = undefined;

    trimLoop: while (iterable) {
      for await (const curResult of iterable) {
        if (curResult.assembly.tokens.length <= tokenBudget) {
          lastResult = curResult;
          continue;
        }
        // We've busted the budget.  We can simply attempt to split into
        // the current result.  If it yields something, this loop may
        // continue.  If not, we'll end it here.
        iterable = curResult.split();
        continue trimLoop;
      }
      // If we get here, everything in the iterable fit in the budget.
      iterable = undefined;
    }

    return lastResult?.assembly;
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
    assembly: Assembly.AnyFragment,
    /** The token budget. */
    tokenBudget: number,
    /** The context parameters object. */
    contextParams: ContextParams,
    /** Trimming options. */
    options?: Partial<TrimOptions>
  ): Promise<UndefOr<Assembly.Tokenized>> {
    // Create a single-use trimmer and execute.
    const trimmer = createTrimmer(assembly, contextParams, options);
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
      const splitFrags = flatMap(content, sequencer.splitUp);
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
    assembly: Assembly.IFragment,
    maximumLength: number,
    options?: Partial<TrimOptions>
  ): UndefOr<Assembly.Fragment> {
    const { preserveEnds, provider: srcProvider, maximumTrimType }
      = { ...optionDefaults, ...options };

    const provider = providers.asProvider(srcProvider);
    const fragments = provider.preProcess(assembly);
    const prefixLength = assembly.prefix.content.length;
    const suffixLength = assembly.suffix.content.length;
    maximumLength = Math.max(0, maximumLength - (prefixLength + suffixLength));

    // Now we can trim.
    if (provider.noSequencing) {
      // If we can't use sequencing, we'll just concatenate the all
      // the fragments and check if it's below the `maximumLength`.
      // Start by making a copy of our fragments; we'll need a stable
      // iterable for this.
      const theFrags = [...fragments];
      const totalLength = reduceIter(
        theFrags,
        0 as number,
        (acc, frag) => frag.content.length + acc
      );

      if (totalLength > maximumLength) return undefined;
      // Un-reverse if the provider runs in reverse.
      if (provider.reversed) theFrags.reverse();

      // We should still create a derived assembly, as the pre-processor
      // could have altered the fragments.
      return fragAssembly.fromDerived(theFrags, assembly);
    }

    // Otherwise, we do our thorough trim.
    const sequencers = providers.getSequencersFrom(provider, maximumTrimType);
    const trimmedFrags = [...execTrimLength(
      sequencers, fragments, maximumLength,
      preserveEnds ? "ends" : "none"
    )];

    if (trimmedFrags.length === 0) return undefined;
    // Un-reverse if the provider runs in reverse.
    if (provider.reversed) trimmedFrags.reverse();
    
    return fragAssembly.fromDerived(trimmedFrags, assembly);
  }

  return Object.assign(exports, {
    createTrimmer,
    execTrimTokens,
    trimByTokens,
    trimByLength
  });
});