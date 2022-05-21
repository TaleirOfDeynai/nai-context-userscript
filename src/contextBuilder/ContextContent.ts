import userScriptConfig from "@config";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { isNumber } from "@utils/is";
import EventModule from "@nai/EventModule";
import $TrimmingProviders from "./TrimmingProviders";
import $TrimmingService, { TokenizedAssembly } from "./TrimmingService";
import $TextAssembly, { TextAssembly } from "./TextAssembly";

import type { UndefOr } from "@utils/utility-types";
import type { IContextField } from "@nai/ContextModule";
import type { ContextConfig } from "@nai/Lorebook";
import type { Trimmer, ReplayTrimmer } from "./TrimmingService";
import type { ContextParams } from "./ParamsService";

/**
 * TODO:
 * - There's still some unused fields.  I believe they were to aid
 *   context assembly later on.
 */

type InFlightTrimming = Promise<UndefOr<TokenizedAssembly>>;

// Let's condense our config a bit.
const contentConfig = dew(() => {
  const { standardizeHandling, searchComments } = userScriptConfig.comments;
  const lore = {
    canRemoveComments: standardizeHandling,
    searchComments: standardizeHandling && searchComments,
    keepAffix: true
  } as const;
  const story = {
    canRemoveComments: true,
    searchComments,
    keepAffix: userScriptConfig.story.standardizeHandling
  } as const;
  return { lore, story } as const;
});

const reComment = /^##/m;

const theModule = usModule((require, exports) => {
  const eventModule = require(EventModule);
  const providers = $TrimmingProviders(require);

  const { createTrimmer, execTrimTokens, trimByLength } = $TrimmingService(require);
  const { TextAssembly } = $TextAssembly(require);

  const getBudget = (config: ContextConfig, contextParams: ContextParams) => {
    // Invalid values default to `contextSize`.
    if (!isNumber(config.tokenBudget)) return contextParams.contextSize;
    if (config.tokenBudget <= 0) return contextParams.contextSize;
    // 1 or more is converted into an integer, if needed.
    if (config.tokenBudget >= 1) return config.tokenBudget | 0;
    // Values less than 1 are scaled by the context size.
    return config.tokenBudget * contextParams.contextSize;
  };

  /**
   * Gets the provider, given the needs of the provider and the configuration.
   */
  const getProvider = (
    forStory: boolean,
    forSearch: boolean,
    trimDirection: ContextConfig["trimDirection"],
    contextParams: ContextParams
  ) => {
    const entryConfig = forStory ? contentConfig.story : contentConfig.lore;
    switch (true as boolean) {
      case !contextParams.removeComments:
      case !entryConfig.canRemoveComments:
      case forSearch && entryConfig.searchComments:
        return providers.basic[trimDirection];
      default:
        return providers.removeComments[trimDirection];
    }
  };

  /**
   * Does the nasty business of getting the {@link TextAssembly} that will
   * be used for keyword searching.
   */
  const getSearchAssembly = dew(() => {
    const _forStory = async (
      trimmer: Trimmer,
      contextConfig: ContextConfig,
      contextParams: ContextParams
    ): Promise<TextAssembly> => {
      // For the story, we will always need to trim it to size.  What varies
      // is whether we trim by tokens or length.  We also need to sort out
      // whether to remove comments or not.
      if (contextParams.storyLength > 0) {
        const { trimDirection, maximumTrimType } = contextConfig;
        const provider = getProvider(true, true, trimDirection, contextParams);
        const trimConfig = { provider, maximumTrimType, preserveEnds: true };
        const result = trimByLength(trimmer.origin, contextParams.storyLength, trimConfig);
        if (result) return result;
        // Fallback to an empty story block.
        return TextAssembly.fromDerived([], trimmer.origin, true);
      }

      const innerTrimmer = dew(() => {
        const { trimDirection, maximumTrimType } = contextConfig;
        const provider = getProvider(true, true, trimDirection, contextParams);
        // We can re-use the current trimmer.
        if (trimmer.provider === provider) return trimmer;
        // We need a different trimmer.
        return createTrimmer(
          trimmer.origin,
          contextParams,
          { provider, maximumTrimType, preserveEnds: true },
          false
        );
      });
      
      const result = await execTrimTokens(innerTrimmer, contextParams.contextSize);
      if (result) return result;
      // Fallback to an empty story block.
      return TextAssembly.fromDerived([], trimmer.origin, true);
    };

    const _forLore = (
      trimmer: Trimmer,
      contextParams: ContextParams
    ): TextAssembly => {
      // The trimmer has the unmodified origin assembly.  We only need to
      // change things up if we need to remove comments for search.
      if (!contextParams.removeComments) return trimmer.origin;
      if (!reComment.test(trimmer.origin.fullText)) return trimmer.origin;
      const provider = getProvider(false, true, "doNotTrim", contextParams);
      // The do-not-trim provider does all its work in `preProcess`.
      const fragments = provider.preProcess(trimmer.origin);
      // If we get the `content` reference back, we removed nothing.
      if (fragments === trimmer.origin.content) return trimmer.origin;
      return TextAssembly.fromDerived(fragments, trimmer.origin);
    }

    return async (
      forStory: boolean,
      trimmer: Trimmer,
      contextConfig: ContextConfig,
      contextParams: ContextParams
    ): Promise<TextAssembly> => {
      const result
        = forStory ? await _forStory(trimmer, contextConfig, contextParams)
        : _forLore(trimmer, contextParams);
      const entryConfig = forStory ? contentConfig.story : contentConfig.lore;
      return entryConfig.keepAffix ? result : result.asOnlyContent();
    }
  });

  /**
   * This abstraction deals with the internal management of trimming and
   * budgeting for a single entry's content.
   * 
   * It also manages some of the normalization options in the user-script
   * configuration.
   */
  class ContextContent<T extends IContextField = IContextField> {

    constructor(
      origField: T,
      searchText: TextAssembly,
      trimmer: Trimmer | ReplayTrimmer,
      contextParams: ContextParams
    ) {
      const { text, contextConfig, ...fieldConfig } = origField;
      this.#field = origField;
      this.#fieldConfig = fieldConfig;
      this.#contextConfig = contextConfig;
      this.#searchText = searchText;
      this.#trimmer = trimmer;

      // The initial budget based on the config.
      this.#initialBudget = getBudget(contextConfig, contextParams);
      this.#currentBudget = this.#initialBudget;
    }

    static async forField<T extends IContextField>(field: T, contextParams: ContextParams) {
      const { text, contextConfig } = field;
      const { maximumTrimType, trimDirection } = contextConfig;
      const provider = getProvider(false, false, trimDirection, contextParams);
      const trimmer = createTrimmer(
        TextAssembly.fromSource(text, contextConfig),
        contextParams,
        { provider, maximumTrimType, preserveEnds: false },
        // Token reservations are most likely to benefit from replay.
        contextConfig.reservedTokens > 0
      );
      const searchText = await getSearchAssembly(false, trimmer, contextConfig, contextParams);

      return new ContextContent(field, searchText, trimmer, contextParams);
    }

    static async forStory(contextParams: ContextParams): Promise<ContextContent> {
      const { storyState } = contextParams;
      const contextConfig = storyState.storyContent.storyContextConfig;
      const storyText = storyState.storyContent.story.getText();

      const { trimDirection, maximumTrimType } = contextConfig;
      const sourceText = dew(() => {
        const ev = new eventModule.PreContextEvent(storyText);
        const handled = storyState.handleEvent(ev);
        return TextAssembly.fromSource(handled.event.contextText, contextConfig);
      });
      const provider = getProvider(true, false, trimDirection, contextParams);
      const trimmer = createTrimmer(
        sourceText,
        contextParams,
        { provider, maximumTrimType, preserveEnds: false },
        true
      );
      const searchText = await getSearchAssembly(true, trimmer, contextConfig, contextParams);

      return new ContextContent(
        { text: searchText.fullText, contextConfig },
        searchText,
        trimmer,
        contextParams
      );
    }

    #field: T;
    #fieldConfig: Omit<T, "text" | "contextConfig">;
    #contextConfig: ContextConfig;
    #trimmer: Trimmer | ReplayTrimmer;

    #searchText: TextAssembly;

    /** Storage for the maximum token count allowed by the budget. */
    #maxTokenCount: UndefOr<number>;
    /** Configured token reservation count. */
    #initialReserved: number;
    /** Actual token reservation count. */
    #actualReserved: UndefOr<number>;
    /** Configured token budget. */
    #initialBudget: number;
    /** Current token budget; this is stateful. */
    #currentBudget: number;
    /** Current trim results of the current budget applied. */
    #currentResult: UndefOr<InFlightTrimming>;

    /** The raw text from the source. */
    get text(): string {
      return this.#field.text;
    }

    /** The text assembly used for searching. */
    get searchedText(): TextAssembly {
      return this.#searchText;
    }

    /** The text assembly used for trimming/insertion. */
    get insertedText(): TextAssembly {
      return this.#trimmer.origin;
    }

    /**
     * The current token budget.
     * 
     * This value is updated by calling {@link ContextContent.rebudget rebudget}.
     */
    get currentBudget(): number {
      return this.#currentBudget;
    }

    /**
     * The trimmed content, at the current token budget.
     * 
     * If this has not yet been calculated, this will begin that process.
     * If the promise resolves to `undefined`, the budget was too strict
     * and the content could not be trimmed using the configuration used
     * to construct the trimmer.
     */
    get trimmed(): InFlightTrimming {
      return this.#currentResult ?? this.rebudget();
    }

    /** All additional properties that were on the context field. */
    get fieldConfig(): Readonly<Omit<T, "text" | "contextConfig">> {
      return this.#fieldConfig;
    }

    /** The context configuration provided to the constructor. */
    get contextConfig(): Readonly<ContextConfig> {
      return this.#contextConfig;
    }

    /**
     * Invokes the trimmer, calculating a result that fits the `newBudget`.
     * 
     * This method will also update the {@link ContextContent.trimmed trimmed}
     * property with a promise that will be the result of the job.
     * 
     * If `newBudget` is not provided, it will use the current budget, which
     * will generally only kick of a trimming job when needed.
     */
    rebudget(newBudget = this.#currentBudget): InFlightTrimming {
      // If the budget isn't changing and we have an existing promise,
      // don't bother re-running the trimmer.
      if (newBudget === this.#currentBudget && this.#currentResult)
        return this.#currentResult;

      this.#currentBudget = newBudget;
      this.#currentResult = execTrimTokens(this.#trimmer, newBudget);

      return this.#currentResult;
    }

    /**
     * Relieves memory pressure by clearing the trimmer's cache.  This will only
     * be done after any currently calculating result has finished.
     * 
     * This should be called whenever the instance is expected to no longer need
     * any further budget adjustments.
     */
    async finalize(): Promise<void> {
      try {
        let lastJob: UndefOr<InFlightTrimming> = undefined;
        while (lastJob !== this.#currentResult) {
          lastJob = this.#currentResult;
          await lastJob;
        }
      }
      finally {
        if ("clear" in this.#trimmer)
          this.#trimmer.clear();
      }
    }
  }

  return Object.assign(exports, {
    ContextContent
  });
});

export default theModule;
export type ContextContent = InstanceType<ReturnType<typeof theModule>["ContextContent"]>;