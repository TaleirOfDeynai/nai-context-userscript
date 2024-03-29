import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import $NaiInternals from "../../../NaiInternals";
import $Common from "../../_common";
import $Shared from "./_shared";

import type { ContextStatus } from "@nai/ContextBuilder";
import type { Assembler } from "../../40-assembly";

export default usModule((require, exports) => {
  const { ContextStatus } = $NaiInternals(require);
  const { selection } = $Common(require);
  const { checkThis, getSubContextPart } = $Shared(require);

  /** Converts sources that were discarded during assembly into {@link ContextStatus}. */
  function forUnbudgeted(results: rx.Observable<Assembler.Rejected>) {
    return results.pipe(
      rxop.mergeMap(async (rejected): Promise<ContextStatus> => {
        const { source, result } = rejected;

        const stats = await selection.getBudgetStats(source);

        return Object.assign(
          new ContextStatus(source.entry.field),
          checkThis({
            identifier: source.identifier,
            unqiueId: source.uniqueId,
            type: source.type,
            included: false,
            // We don't necessarily need to use a standard `reason` here.
            reason: result.reason as any,
            calculatedTokens: 0,
            actualReservedTokens: stats.actualReservedTokens
          }),
          getSubContextPart(rejected)
        );
      })
    );
  }

  return Object.assign(exports, { forUnbudgeted });
});