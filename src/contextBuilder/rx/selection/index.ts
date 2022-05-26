import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { createLogger } from "@utils/logging";
import Vanilla from "./vanilla";

import type { ContextParams } from "../../ParamsService";
import type { SourcePhaseResult } from "../source";
import type { ActivationPhaseResult } from "../activation";
import type { BudgetedSource } from "./_shared";

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
    vanilla: Vanilla(require).createStream
  } as const;

  /**
   * This will be used at the end to provide `actualReservedTokens` to the
   * user in the report, but it isn't really used for insertion or trimming.
   */
  function selectionPhase(
    contextParams: ContextParams,
    sourceResults: SourcePhaseResult,
    activationResults: ActivationPhaseResult
  ): SelectionPhaseResult {
    const { storySource } = sourceResults;

    // We need the full activation results now.  Convert this promise
    // of a set of activated entries into a new stream.  Use `defer`
    // so the promise doesn't make the activation phase hot.
    const activatedSources = rx.defer(() => activationResults.activated)
      .pipe(rxop.mergeAll());

    const inFlightSelected = activatedSources.pipe(
      selectors.vanilla(contextParams, storySource),
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
          rxop.reduce<BudgetedSource, number>((tokens, { budgetStats }) => tokens + budgetStats.actualReservedTokens, 0)
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