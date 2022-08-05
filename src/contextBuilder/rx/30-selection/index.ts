/**
 * The Selection Phase is responsible for determining how to prioritize
 * entries within the budgetary constraints of the context.  It has its
 * fingers in:
 * - Preparing information on budgeting, such as token reservations.
 * - Determining how entries are prioritized versus one another and
 *   which might need to be dropped in order to get those higher
 *   priority entries into the context.
 * - Establishing the coarse order of insertion for those entries
 *   that were selected for insertion.
 */

import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { lazyObject } from "@utils/object";
import { createLogger } from "@utils/logging";
import $Vanilla from "./vanilla";
import $Configured from "./configured";

import type { ContextParams } from "../../ParamsService";
import type { SourcePhaseResult } from "../10-source";
import type { ActivationPhaseResult } from "../20-activation";
import type { BudgetedSource, InsertableSource } from "../_common/selection";

// Re-export this for convenience.
export { BudgetedSource };

export type SelectionObservable = rx.Observable<InsertableSource>;

export interface SelectionPhaseResult {
  readonly selected: rx.Observable<Set<BudgetedSource>>;
  readonly unselected: rx.Observable<Set<BudgetedSource>>;
  readonly totalReservedTokens: rx.Observable<number>;
  readonly inFlight: SelectionObservable;
}

export default usModule((require, exports) => {
  const selectors = {
    vanilla: $Vanilla(require).createStream,
    configured: $Configured(require).createStream
  } as const;

  /**
   * This will be used at the end to provide `actualReservedTokens` to the
   * user in the report, but it isn't really used for insertion or trimming.
   */
  function selectionPhase(
    /** The context builder parameters. */
    contextParams: ContextParams,
    /** The story's source. */
    storySource: SourcePhaseResult["storySource"],
    /** The fully activated set of sources. */
    activatedSet: ActivationPhaseResult["activated"]
  ): SelectionPhaseResult {
    const logger = createLogger(`Selection Phase: ${contextParams.contextName}`);

    // Flatten the set back out.
    const activatedSources = activatedSet.pipe(rxop.mergeAll());

    const inFlightSelected = activatedSources.pipe(
      selectors.configured(contextParams, storySource),
      logger.measureStream("In-flight Selected"),
      rxop.shareReplay()
    );

    return lazyObject({
      totalReservedTokens: () => inFlightSelected.pipe(
        rxop.reduce<BudgetedSource, number>(
          (tokens, { budgetStats }) => tokens + budgetStats.actualReservedTokens,
          0
        ),
        rxop.shareReplay(1)
      ),
      selected: () => inFlightSelected.pipe(
        rxop.toArray(),
        rxop.map((sources) => new Set(sources)),
        rxop.shareReplay(1)
      ),
      unselected: () => activatedSources.pipe(
        rxop.rejectedBy(inFlightSelected, (source) => source.uniqueId),
        logger.measureStream("In-flight Unselected"),
        rxop.toArray(),
        rxop.map((sources) => new Set(sources)),
        rxop.shareReplay(1)
      ),
      inFlight: () => inFlightSelected
    });
  };

  return Object.assign(exports, selectors, { phaseRunner: selectionPhase });
});