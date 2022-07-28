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
import { createLogger } from "@utils/logging";
import $Vanilla from "./vanilla";
import $Configured from "./configured";

import type { ContextParams } from "../../ParamsService";
import type { SourcePhaseResult } from "../1-source";
import type { ActivationPhaseResult } from "../2-activation";
import type { BudgetedSource } from "../_shared";

// Re-export this for convenience.
export { BudgetedSource };

export type SelectionObservable = rx.Observable<BudgetedSource>;

export interface SelectionPhaseResult {
  readonly selected: Promise<Set<BudgetedSource>>;
  readonly unselected: Promise<Set<BudgetedSource>>;
  readonly totalReservedTokens: Promise<number>;
  readonly inFlight: SelectionObservable;
}

const logger = createLogger("Selection Phase");

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
    activatedSet: rx.DeferredOf<ActivationPhaseResult["activated"]>
  ): SelectionPhaseResult {
    // Flatten the set back out.
    const activatedSources = activatedSet.pipe(rxop.mergeAll());

    const inFlightSelected = activatedSources.pipe(
      selectors.configured(contextParams, storySource),
      logger.measureStream("In-flight Selected"),
      rxop.shareReplay()
    );

    const inFlightUnselected = activatedSources.pipe(
      rxop.rejectedBy(inFlightSelected, (source) => source.uniqueId),
      logger.measureStream("In-flight Unselected"),
      rxop.shareReplay()
    );

    return {
      get totalReservedTokens() {
        return rx.firstValueFrom(inFlightSelected.pipe(
          rxop.reduce<BudgetedSource, number>(
            (tokens, { budgetStats }) => tokens + budgetStats.actualReservedTokens,
            0
          )
        ));
      },
      get selected() {
        return rx.firstValueFrom(inFlightSelected.pipe(
          rxop.toArray(),
          rxop.map((sources) => new Set(sources))
        ));
      },
      get unselected() {
        return rx.firstValueFrom(inFlightUnselected.pipe(
          rxop.toArray(),
          rxop.map((sources) => new Set(sources))
        ));
      },
      get inFlight() {
        return inFlightSelected;
      }
    };
  };

  return Object.assign(exports, selectors, { phaseRunner: selectionPhase });
});