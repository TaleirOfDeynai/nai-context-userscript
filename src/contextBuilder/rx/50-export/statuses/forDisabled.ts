import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import NaiContextBuilder from "@nai/ContextBuilder";
import { checkThis } from "./_shared";

import type { ContextStatus } from "@nai/ContextBuilder";
import type { DisabledSource } from "../../10-source";

export default usModule((require, exports) => {
  const CB = require(NaiContextBuilder);

  /** Converts disabled sources into {@link ContextStatus}. */
  function forDisabled(sources: rx.Observable<DisabledSource>) {
    return sources.pipe(
      rxop.map((source): ContextStatus => Object.assign(
        new CB.ContextStatus(source.entry.field),
        checkThis({
          identifier: source.identifier,
          unqiueId: source.uniqueId,
          type: source.type,
          included: false,
          reason: CB.REASONS.Disabled
        })
      ))
    );
  }

  return Object.assign(exports, { forDisabled });
});