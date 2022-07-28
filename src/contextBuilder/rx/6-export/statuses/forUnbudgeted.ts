import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import NaiContextBuilder from "@nai/ContextBuilder";
import { getBudgetStats } from "../../_shared";
import { checkThis } from "./_shared";

import type { ContextStatus } from "@nai/ContextBuilder";
import type { Assembler } from "../../5-assembly";

export default usModule((require, exports) => {
  const CB = require(NaiContextBuilder);

  /** Converts sources that were discarded during assembly into {@link ContextStatus}. */
  function forUnbudgeted(results: rx.Observable<Assembler.Rejected>) {
    return results.pipe(
      rxop.mergeMap(async ({ source, result }): Promise<ContextStatus> => {
        const field = source.entry.field ?? {
          text: source.entry.text,
          contextConfig: source.entry.contextConfig
        };

        const stats = await getBudgetStats(source);

        return Object.assign(
          new CB.ContextStatus(field),
          checkThis({
            identifier: source.identifier,
            unqiueId: source.uniqueId,
            type: source.type,
            included: false,
            // We don't necessarily need to use a standard `reason` here.
            reason: result.reason as any,
            calculatedTokens: stats.tokenBudget,
            actualReservedTokens: stats.actualReservedTokens
          })
        );
      })
    );
  }

  return Object.assign(exports, { forUnbudgeted });
});