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
import { lazyObject } from "@utils/object";
import $ContextAssembler from "./ContextAssembler";

import type { Assembly } from "../../assemblies";
import type { ContextParams } from "../../ParamsService";
import type { InsertableObservable } from "../_common/selection";
import type { SelectionPhaseResult } from "../30-selection";
import type { ContextGroupPhaseResult } from "../35-contextGroups";
import type { Assembler } from "./ContextAssembler";

// Re-export these for convenience.
export { Assembler, InsertableObservable };
export { InsertableSource } from "../_common/selection";

export interface AssemblyPhaseResult {
  readonly insertions: rx.Observable<Assembler.Inserted>;
  readonly rejections: rx.Observable<Assembler.Rejected>;
  readonly assembly: rx.Observable<Assembly.Compound>;
}

export default usModule((require, exports) => {
  const { contextAssembler } = $ContextAssembler(require);

  /**
   * This will be used at the end to provide `actualReservedTokens` to the
   * user in the report, but it isn't really used for insertion or trimming.
   */
  function assemblyPhase(
    /** The context builder parameters. */
    contextParams: ContextParams,
    /** The total reserved tokens, from the selection phase. */
    totalReservedTokens: SelectionPhaseResult["totalReservedTokens"],
    /** The currently in-flight insertable and selected entries. */
    inFlightSelections: InsertableObservable,
    /** The context groups, if any, from the context groups phase. */
    contextGroups: ContextGroupPhaseResult["contextGroups"]
  ): AssemblyPhaseResult {
    const assembler = rx.forkJoin([contextGroups, totalReservedTokens]).pipe(
      rxop.map((args) => contextAssembler(contextParams, ...args)),
      rxop.map((processFn) => processFn(inFlightSelections)),
      rxop.single(),
      rxop.shareReplay(1)
    );

    // A little weird pulling these out.
    return lazyObject({
      insertions: () => assembler.pipe(
        rxop.mergeMap((assembler) => assembler.insertions)
      ),
      rejections: () => assembler.pipe(
        rxop.mergeMap((assembler) => assembler.rejections)
      ),
      assembly: () => assembler.pipe(
        rxop.mergeMap((assembler) => assembler.finalAssembly)
      )
    });
  };

  return Object.assign(exports, { phaseRunner: assemblyPhase });
});