import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { isNumber } from "@utils/is";
import EventModule from "@nai/EventModule";
import TextSplitterService from "./TextSplitterService";
import TrimmingProviders from "./TrimmingProviders";
import TrimmingService from "./TrimmingService";

import type { UndefOr } from "@utils/utility-types";
import type { ContextField } from "@nai/ContextBuilder";
import type { ContextConfig } from "@nai/Lorebook";
import type { Trimmer, ReplayTrimmer } from "./TrimmingService";
import type { ContextParams } from "./ParamsService";

export default usModule((require, exports) => {
  const eventModule = require(EventModule);
  const providers = TrimmingProviders(require);

  const { asContent } = TextSplitterService(require);
  const { createTrimmer, execTrimTokens, trimByLength } = TrimmingService(require);

  const getBudget = (config: ContextConfig, contextParams: ContextParams) => {
    // Invalid values default to `contextSize`.
    if (!isNumber(config.tokenBudget)) return contextParams.contextSize;
    if (config.tokenBudget <= 0) return contextParams.contextSize;
    // 1 or more is converted into an integer, if needed.
    if (config.tokenBudget >= 1) return config.tokenBudget | 0;
    // Values less than 1 are scaled by the context size.
    return config.tokenBudget * contextParams.contextSize;
  };

  class ContextContent<T extends ContextField = ContextField> {

    constructor(
      origField: T,
      trimmer: Trimmer | ReplayTrimmer,
      contextParams: ContextParams
    ) {
      const { text, contextConfig, ...fieldConfig } = origField;
      this.#field = origField;
      this.#fieldConfig = fieldConfig;
      this.#contextConfig = contextConfig;
      this.#trimmer = trimmer;

      // The starting budget based on the config.
      this.#currentBudget = getBudget(contextConfig, contextParams);
    }

    static forField<T extends ContextField>(field: T, contextParams: ContextParams) {
      const { text, contextConfig } = field;
      const { prefix, suffix, maximumTrimType, trimDirection: provider } = contextConfig;
      const trimmer = createTrimmer(
        text, contextParams,
        { prefix, suffix, provider, maximumTrimType, preserveEnds: false },
        // Token reservations are most likely to benefit from replay.
        contextConfig.reservedTokens > 0
      );

      return new ContextContent(field, trimmer, contextParams);
    }

    static forStory(
      contextParams: ContextParams,
      storyLength?: number,
      removeComments: boolean = true
    ): ContextContent {
      const { storyState, tokenCodec } = contextParams;
      const contextConfig = storyState.storyContent.storyContextConfig;
      const storyText = storyState.storyContent.story.getText();

      const sourceText = dew(() => {
        const ev = new eventModule.PreContextEvent(storyText);
        const handled = storyState.handleEvent(ev);
        return handled.event.contextText;
      });

      const { trimDirection: dir, maximumTrimType } = contextConfig;
      const provider
        = removeComments ? providers.removeComments[dir]
        : providers.basic[dir];

      const trimConfig = { provider, maximumTrimType, preserveEnds: true };

      const innerText = dew(() => {
        if (!storyLength || storyLength < 0) return sourceText;
        const result = trimByLength(sourceText, storyLength, trimConfig);
        return result?.fragment ?? sourceText;
      });

      const { prefix, suffix } = contextConfig;

      const trimmer = createTrimmer(
        innerText, contextParams,
        { ...trimConfig, prefix, suffix },
        true
      );

      return new ContextContent(
        { text: asContent(innerText), contextConfig },
        trimmer,
        contextParams
      );
    }

    #field: T;
    #fieldConfig: Omit<T, "text" | "contextConfig">;
    #contextConfig: ContextConfig;
    #trimmer: Trimmer | ReplayTrimmer;
    #currentBudget: number;
    #currentResult: UndefOr<ReturnType<typeof execTrimTokens>>;

    /** The raw text originally provided to the constructor. */
    get text(): string {
      return this.#field.text;
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
    get trimmed(): ReturnType<typeof execTrimTokens> {
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
    rebudget(newBudget = this.#currentBudget): ReturnType<typeof execTrimTokens> {
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
        let lastJob: UndefOr<ReturnType<typeof execTrimTokens>> = undefined;
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
});