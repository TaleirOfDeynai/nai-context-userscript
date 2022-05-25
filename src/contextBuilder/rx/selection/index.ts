import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { activation } from "../_shared";
import Vanilla from "./vanilla";

import type { ContextParams } from "../../ParamsService";
import type { ActivationPhaseResult } from "../activation";
import type { BudgetedSource } from "./_shared";

export type SelectionObservable = rx.Observable<BudgetedSource>;

export interface SelectionPhaseResult {
  readonly selected: Promise<Set<BudgetedSource>>;
  readonly totalReservedTokens: rx.Observable<number>;
  readonly inFlight: SelectionObservable;
}

export default usModule((require, exports) => {
  const selectors = {
    vanilla: Vanilla(require).createStream
  };

  /**
   * This will be used at the end to provide `actualReservedTokens` to the
   * user in the report, but it isn't really used for insertion or trimming.
   */
  function selectionPhase(
    contextParams: ContextParams,
    activationResults: ActivationPhaseResult
  ): SelectionPhaseResult {
    const inFlight = activationResults.inFlight.pipe(
      rxop.filter(activation.isActivated),
      selectors.vanilla(contextParams),
      rxop.shareReplay()
    );

    const totalReservedTokens = inFlight.pipe(
      rxop.reduce<BudgetedSource, number>((tokens, { budgetStats }) => tokens + budgetStats.reservedTokens, 0),
      rxop.shareReplay()
    );

    return {
      get totalReservedTokens() {
        return totalReservedTokens;
      },
      get selected() {
        return rx.firstValueFrom(inFlight.pipe(
          rxop.toArray(),
          rxop.map((sources) => new Set(sources))
        ));
      },
      get inFlight() {
        return inFlight;
      }
    };
  };

  return Object.assign(exports, selectors, { phaseRunner: selectionPhase });
});