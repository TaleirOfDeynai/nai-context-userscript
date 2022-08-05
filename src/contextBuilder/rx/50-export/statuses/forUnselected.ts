import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import NaiContextBuilder from "@nai/ContextBuilder";
import $Shared from "./_shared";

import type { ContextStatus } from "@nai/ContextBuilder";
import type { BudgetedSource } from "../../30-selection";

export default usModule((require, exports) => {
  const CB = require(NaiContextBuilder);
  const { checkThis, getSubContextPart } = $Shared(require);

  /**
   * Converts sources that were discarded during selection into {@link ContextStatus}.
   * 
   * This is unique to the user-script, and uses a non-standard `reason`.
   */
  function forUnselected(sources: rx.Observable<BudgetedSource>) {
    return sources.pipe(
      rxop.map((source): ContextStatus => Object.assign(
        new CB.ContextStatus(source.entry.field),
        checkThis({
          identifier: source.identifier,
          unqiueId: source.uniqueId,
          type: source.type,
          included: false,
          // We're using a non-standard `reason` here.
          reason: "not selected" as any
        }),
        getSubContextPart(source)
      ))
    );
  }

  return Object.assign(exports, { forUnselected });
});