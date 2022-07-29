import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { isNumber } from "@utils/is";
import EventModule from "@nai/EventModule";
import ContextModule from "@nai/ContextModule";
import UUID from "@nai/UUID";
import $TrimmingProviders from "./TrimmingProviders";
import $TrimmingService from "./TrimmingService";
import $FragmentAssembly from "./assemblies/Fragment";
import $CursorOps from "./assemblies/cursorOps";
import $QueryOps from "./assemblies/queryOps";

import type { UndefOr } from "@utils/utility-types";
import type { IContextField } from "@nai/ContextModule";
import type { ContextConfig, LoreEntryConfig } from "@nai/Lorebook";
import type { Trimmer, ReplayTrimmer } from "./TrimmingService";
import type { ContextParams } from "./ParamsService";
import type { Cursor } from "./cursors";
import type { Assembly } from "./assemblies";

/**
 * TODO:
 * - There's still some unused fields.  I believe they were to aid
 *   context assembly later on.
 */

type InFlightTrimming = Promise<UndefOr<Assembly.Tokenized>>;

export interface StoryContent extends IContextField {
  allowInnerInsertion: boolean;
  allowInsertionInside: boolean;
}

export interface NormalizedBudgetStats {
  /** The configured token reservation; always an integer. */
  readonly reservedTokens: number;
  /** The configured token budget; always an integer. */
  readonly tokenBudget: number;
  /**
   * The minimum number of tokens needed to fully satisfy the reservation.
   * 
   * This is actually a checked value when `reservedTokens` is greater than 0,
   * trimming with a budget that is the minimum of `reservedTokens` and
   * `tokenBudget` and using the token count from the trim.
   * 
   * The actual tokens included in the context may be larger or lower, but
   * entries with reservations block entries without until the reservations
   * have been fully satisfied.
   */
  readonly actualReservedTokens: number;
}

const reComment = /^##/m;

const theModule = usModule((require, exports) => {
  const uuid = require(UUID);
  const eventModule = require(EventModule);
  const { ContextField } = require(ContextModule);
  const providers = $TrimmingProviders(require);
  const cursorOps = $CursorOps(require);
  const queryOps = $QueryOps(require);

  const { createTrimmer, execTrimTokens, trimByLength } = $TrimmingService(require);
  const assembly = $FragmentAssembly(require);

  const getBudget = ({ tokenBudget }: ContextConfig, contextParams: ContextParams) => {
    // Invalid values default to `contextSize`.
    if (!isNumber(tokenBudget)) return contextParams.contextSize;
    if (tokenBudget <= 0) return contextParams.contextSize;
    // 1 or more is converted into an integer, if needed.
    if (tokenBudget >= 1) return tokenBudget | 0;
    // Values less than 1 are scaled by the context size.
    return (tokenBudget * contextParams.contextSize) | 0;
  };

  const getReservation = ({ reservedTokens}: ContextConfig, contextParams: ContextParams) => {
    // Invalid values default to `0`.
    if (!isNumber(reservedTokens)) return 0;
    if (reservedTokens <= 0) return 0;
    // 1 or more is converted into an integer, if needed.
    if (reservedTokens >= 1) return reservedTokens | 0;
    // Values less than 1 are scaled by the context size.
    return (reservedTokens * contextParams.contextSize) | 0;
  };

  /**
   * Gets the provider, given the needs of the provider and the configuration.
   */
  const getProvider = (
    forSearch: boolean,
    trimDirection: ContextConfig["trimDirection"]
  ) => {
    if (forSearch && usConfig.comments.searchComments)
      return providers.basic[trimDirection];
    return providers.removeComments[trimDirection];
  };

  /**
   * Does the nasty business of getting the {@link Assembly.Fragment} that will
   * be used for keyword searching.
   */
  const getSearchAssembly = dew(() => {
    const _forStory = async (
      trimmer: Trimmer,
      contextConfig: ContextConfig,
      contextParams: ContextParams
    ): Promise<Assembly.AnyFragment> => {
      // For the story, we will always need to trim it to size.  What varies
      // is whether we trim by tokens or length.  We also need to sort out
      // whether to remove comments or not.
      if (contextParams.storyLength > 0) {
        const { trimDirection, maximumTrimType } = contextConfig;
        const provider = getProvider(true, trimDirection);
        const trimConfig = { provider, maximumTrimType, preserveEnds: true };
        const result = trimByLength(trimmer.origin, contextParams.storyLength, trimConfig);
        if (result) return result;
        // Fallback to an empty story block.
        return assembly.fromDerived([], trimmer.origin);
      }

      const innerTrimmer = dew(() => {
        const { trimDirection, maximumTrimType } = contextConfig;
        const provider = getProvider(true, trimDirection);
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
      return assembly.fromDerived([], trimmer.origin);
    };

    const _forLore = (
      trimmer: Trimmer,
      contextParams: ContextParams
    ): Assembly.AnyFragment => {
      const origin = trimmer.origin;
      // The trimmer has the unmodified origin assembly.  We only need to
      // change things up if we need to remove comments for search.
      if (!reComment.test(queryOps.getText(origin))) return origin;
      const provider = getProvider(true, "doNotTrim");
      // The do-not-trim provider does all its work in `preProcess`.
      const fragments = provider.preProcess(origin);
      // If we get the `content` reference back, we removed nothing.
      if (fragments === origin.content) return origin;
      return assembly.fromDerived(fragments, origin);
    }

    return async (
      forStory: boolean,
      trimmer: Trimmer,
      contextConfig: ContextConfig,
      contextParams: ContextParams
    ): Promise<Assembly.AnyFragment> => {
      const result
        = forStory ? await _forStory(trimmer, contextConfig, contextParams)
        : _forLore(trimmer, contextParams);
      const keepAffix = !forStory ? true : usConfig.story.standardizeHandling;
      return keepAffix ? result : await result.asOnlyContent();
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
      searchText: Assembly.IFragment,
      trimmer: Trimmer | ReplayTrimmer,
      contextParams: ContextParams
    ) {
      const { text, contextConfig, ...fieldConfig } = origField;
      this.#uniqueId = uuid.v4();
      this.#field = origField;
      this.#fieldConfig = fieldConfig;
      this.#contextConfig = contextConfig;
      this.#searchText = searchText;
      this.#trimmer = trimmer;

      // Ensure the budget-related configs are integers.
      this.#initialBudget = getBudget(contextConfig, contextParams);
      this.#reservedTokens = getReservation(contextConfig, contextParams);
      this.#currentBudget = this.#initialBudget;

      // Initial state for worker promises.
      this.#otherWorkers = new Set();
    }

    static async forField<T extends IContextField>(field: T, contextParams: ContextParams) {
      const { text, contextConfig } = field;
      const { maximumTrimType, trimDirection } = contextConfig;
      const provider = getProvider(false, trimDirection);
      const trimmer = createTrimmer(
        assembly.fromSource(text, contextConfig),
        contextParams,
        { provider, maximumTrimType, preserveEnds: false },
        // Token reservations are most likely to benefit from replay.
        contextConfig.reservedTokens > 0
      );
      const searchText = await getSearchAssembly(false, trimmer, contextConfig, contextParams);

      return new ContextContent(field, searchText, trimmer, contextParams);
    }

    static async forStory(contextParams: ContextParams) {
      const { storyState } = contextParams;
      const contextConfig = storyState.storyContent.storyContextConfig;
      const storyText = storyState.storyContent.story.getText();

      const { trimDirection, maximumTrimType } = contextConfig;
      const sourceText = dew(() => {
        const ev = new eventModule.PreContextEvent(storyText);
        const handled = storyState.handleEvent(ev);
        return assembly.fromSource(handled.event.contextText, contextConfig);
      });
      const provider = getProvider(false, trimDirection);
      const trimmer = createTrimmer(
        sourceText,
        contextParams,
        { provider, maximumTrimType, preserveEnds: false },
        true
      );
      const searchText = await getSearchAssembly(true, trimmer, contextConfig, contextParams);

      const field: StoryContent = Object.assign(
        new ContextField(contextConfig, searchText.text),
        // The story has some implied insertion rules that we're making
        // explicit here.
        { allowInnerInsertion: false, allowInsertionInside: true }
      );

      return new ContextContent(field, searchText, trimmer, contextParams);
    }

    #uniqueId: string;
    #field: Readonly<T>;
    #fieldConfig: Omit<T, "text" | "contextConfig">;
    #contextConfig: ContextConfig;
    #trimmer: Trimmer | ReplayTrimmer;

    #searchText: Assembly.IFragment;

    /** Storage for the maximum token count allowed by the budget. */
    #maxTokenCount: UndefOr<number>;
    /** Storage for the normalized budgeting stats. */
    #budgetStats: UndefOr<NormalizedBudgetStats>;
    /** Configured token budget. */
    readonly #initialBudget: number;
    /** Configured token reservation. */
    readonly #reservedTokens: number;
    /** Current token budget; this is stateful. */
    #currentBudget: number;
    /** Other promises end up here. */
    #otherWorkers: Set<Promise<unknown>>;
    /** Current trim results of the current budget applied. */
    #currentResult: UndefOr<InFlightTrimming>;

    /** The unique ID for this content. */
    get uniqueId(): string {
      return this.#uniqueId;
    }

    /**
     * The original field used as the source.
     * 
     * This is available for convenience, but you should favor `fieldConfig`
     * in most cases.  Under no circumstances should this object be mutated.
     */
    get field(): Readonly<T> {
      return this.#field;
    }

    /** The raw text from the source. */
    get text(): string {
      return this.#field.text;
    }

    /** The fragment assembly used for searching. */
    get searchedText(): Assembly.IFragment {
      return this.#searchText;
    }

    /** The fragment assembly used for trimming/insertion. */
    get insertedText(): Assembly.IFragment {
      return this.#trimmer.origin;
    }

    /**
     * The current token budget.
     * 
     * This value is updated by calling {@link rebudget}.
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
     * Indicates if the given cursor is in the search text but missing
     * from the inserted text.
     */
    isCursorLoose(cursor: Cursor.Fragment): boolean {
      if (cursorOps.isFoundIn(this.insertedText, cursor)) return false;
      return cursorOps.isFoundIn(this.searchedText, cursor);
    }

    /** Gets stats related to this content's budget. */
    async getStats(): Promise<NormalizedBudgetStats> {
      if (this.#budgetStats) return this.#budgetStats;

      const tokenBudget = this.#initialBudget;
      const reservedTokens = this.#reservedTokens;

      checks: {
        // Fast-path: we don't need to trim when not reserving.
        if (reservedTokens === 0) break checks;

        const trimBudget = Math.min(tokenBudget, reservedTokens);
        const result = await this.#doWork(() => execTrimTokens(this.#trimmer, trimBudget));

        // Failed to fit in the budget, so can't even reserve anything.
        if (!result) break checks;

        this.#budgetStats = {
          reservedTokens, tokenBudget,
          actualReservedTokens: result.tokens.length
        };
        return this.#budgetStats;
      }
      
      // Fall-back: we have no reservation.
      this.#budgetStats = {
        reservedTokens, tokenBudget,
        actualReservedTokens: 0
      };
      return this.#budgetStats;
    }

    /**
     * Determines the maximum possible number of tokens that could be
     * inserted if its full token budget were used.
     * 
     * This does a trim to determine the true value the first time it
     * is called.
     */
    async getMaximumTokens(): Promise<number> {
      if (isNumber(this.#maxTokenCount)) return this.#maxTokenCount;

      const maxTokenBudget = this.#initialBudget;
      const result = await dew(() => {
        // Can we just use the current value?  This may still execute
        // the trim, but it is also technically saving time later if we
        // never call `rebudget`.
        if (this.#currentBudget === maxTokenBudget) return this.trimmed;
        // Otherwise, we need to do this one under-the-table.
        return this.#doWork(() => execTrimTokens(this.#trimmer, maxTokenBudget));
      });

      // `undefined` means it couldn't even fit the budget, at all.
      this.#maxTokenCount = result?.tokens.length ?? 0;
      return this.#maxTokenCount;
    }

    /**
     * Invokes the trimmer, calculating a result that fits the `newBudget`.
     * 
     * This method will also update the {@link trimmed} property with a
     * promise that will be the result of the job.
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
      this.#currentResult = this.#doWork(() => execTrimTokens(this.#trimmer, newBudget));

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
      // Promises in `#otherWorkers` get removed from the set as they complete,
      // assuming they were added by `#doWork`, anyways.  We just need to wait
      // for all the promises to be cleared out.
      while (this.#otherWorkers.size > 0) {
        // Grab a local copy of the set, just in case.
        for (const promise of [...this.#otherWorkers]) {
          // We don't care if it fails; just that it is done.
          try { await promise; } catch { continue; }
        }
      }
      // Now we can clear the trimmer's cache, is possible.
      if ("clear" in this.#trimmer) this.#trimmer.clear();
    }

    /**
     * Adds a tracked background worker task to `#otherWorkers`.  This is
     * used by {@link ContextContent.finalize finalize} to determine when
     * it is safe to clear the trimmer's cache.
     */
    #doWork<TResult>(fn: () => Promise<TResult>): Promise<TResult> {
      const theWork = fn();
      this.#otherWorkers.add(theWork);
      return theWork.finally(() => this.#otherWorkers.delete(theWork));
    }
  }

  return Object.assign(exports, {
    ContextContent
  });
});

export default theModule;

// Do some magic with instantiation expressions to extract the class.
declare namespace WitchCraft {
  export const ContextContentCtor: ReturnType<typeof theModule>["ContextContent"];
}
export type ContextContent<T extends IContextField = IContextField>
  = InstanceType<typeof WitchCraft.ContextContentCtor<T>>;