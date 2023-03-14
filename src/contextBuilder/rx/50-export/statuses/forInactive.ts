import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import NaiContextBuilder from "@nai/ContextBuilder";
import $NaiInternals from "../../../NaiInternals";
import $Shared from "./_shared";

import type { ContextStatus } from "@nai/ContextBuilder";
import type { RejectedSource } from "../../_common/activation";

export default usModule((require, exports) => {
  const { REASONS } = require(NaiContextBuilder);
  const { ContextStatus } = $NaiInternals(require);
  const { checkThis } = $Shared(require);

  const toReason = (source: RejectedSource) => {
    switch (source.type) {
      case "ephemeral": return REASONS.EphemeralInactive;
      default: return REASONS.NoKeyTriggered;
    }
  };

  /** Converts sources that failed activation into {@link ContextStatus}. */
  function forInactive(sources: rx.Observable<RejectedSource>) {
    return sources.pipe(
      rxop.map((source): ContextStatus => Object.assign(
        new ContextStatus(source.entry.field),
        checkThis({
          identifier: source.identifier,
          unqiueId: source.uniqueId,
          type: source.type,
          included: false,
          reason: toReason(source)
        })
      ))
    );
  }

  return Object.assign(exports, { forInactive });
});