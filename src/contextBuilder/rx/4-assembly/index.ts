/**
 * The Assembly Phase takes all the entries that have activated and
 * been selected and actually constructs the context.
 * 
 * It ultimately is constrained by the current token budget and so
 * does what it can to trim entries down to fit the budget.  It
 * will produce the staged report for the Last Model Input feature
 * with each entry that comes down the pipe.
 */

import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { createLogger } from "@utils/logging";
import $ContextAssembler from "./ContextAssembler";

import type { ContextParams } from "../../ParamsService";
import type { SelectionPhaseResult } from "../3-selection";

const logger = createLogger("Assembly Phase");

export default usModule((require, exports) => {
  const { contextAssembler } = $ContextAssembler(require);

  /**
   * This will be used at the end to provide `actualReservedTokens` to the
   * user in the report, but it isn't really used for insertion or trimming.
   */
  function assemblyPhase(
    contextParams: ContextParams,
    selectionResults: SelectionPhaseResult
  ) {
    const assembler = rx.defer(() => selectionResults.totalReservedTokens).pipe(
      rxop.map((reservedTokens) => contextAssembler(contextParams, reservedTokens)),
      rxop.mergeMap((processFn) => processFn(selectionResults.inFlight)),
      logger.measureStream("In-flight Assembly"),
      rxop.shareReplay()
    );

    return {
      get whenComplete() {
        return rx.firstValueFrom(assembler.pipe(rxop.whenCompleted()));
      }
    };
  };

  return Object.assign(exports, { phaseRunner: assemblyPhase });
});