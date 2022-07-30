import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import NaiContextBuilder from "@nai/ContextBuilder";
import $QueryOps from "../../../assemblies/queryOps";
import { getBudgetStats } from "../../_shared";
import { checkThis } from "./_shared";

import type { AnyValueOf } from "@utils/utility-types";
import type { ContextStatus, TrimStates, TrimMethods } from "@nai/ContextBuilder";
import type { Assembler } from "../../5-assembly";

export default usModule((require, exports) => {
  const CB = require(NaiContextBuilder);
  const queryOps = $QueryOps(require);

  const toReason = (inserted: Assembler.Inserted) => {
    const { source } = inserted;

    // Sub-contexts use the default reason.
    if (!source.activations) return CB.REASONS.Default;

    if (source.activations.has("ephemeral")) return CB.REASONS.EphemeralActive;
    if (source.activations.has("forced")) return CB.REASONS.ActivationForced;
    if (source.activations.has("keyed")) return CB.REASONS.KeyTriggered;
    if (source.activations.has("cascade")) return CB.REASONS.KeyTriggeredNonStory;

    return CB.REASONS.Default;
  };

  const toTrimState = (inserted: Assembler.Inserted): AnyValueOf<TrimStates> => {
    const { assembly } = inserted.result;
    if (assembly.isSource) return "included";

    const sourceText = queryOps.getText(assembly.source);
    if (assembly.text.length === sourceText.length) return "included";

    return "partially included";
  };

  const toTrimMethod = (inserted: Assembler.Inserted): AnyValueOf<TrimMethods> => {
    const { contextConfig } = inserted.source.entry;
    if (contextConfig.trimDirection === "doNotTrim") return "no trim";
    return contextConfig.maximumTrimType;
  };

  const getKeyPart = (inserted: Assembler.Inserted) => {
    const { location } = inserted.result;
    if (!location.isKeyRelative) return checkThis({ keyRelative: false });

    const triggeringKey = location.matchedKey.source;
    const keyIndex = location.matchedKey.index;
    return checkThis({ keyRelative: true, triggeringKey, keyIndex });
  };

  /** Converts sources that were inserted during assembly into {@link ContextStatus}. */
  function forInserted(results: rx.Observable<Assembler.Inserted>) {
    return results.pipe(
      rxop.mergeMap(async (inserted): Promise<ContextStatus> => {
        const { source, result } = inserted;

        const field = source.entry.field ?? {
          text: source.entry.text,
          contextConfig: source.entry.contextConfig
        };

        const stats = await getBudgetStats(source);

        // TODO: handle the `subContext` property.

        return Object.assign(
          new CB.ContextStatus(field),
          checkThis({
            identifier: source.identifier,
            unqiueId: source.uniqueId,
            type: source.type,
            included: true,
            state: toTrimState(inserted),
            reason: toReason(inserted),
            includedText: result.assembly.text,
            calculatedTokens: result.assembly.tokens.length,
            actualReservedTokens: stats.actualReservedTokens,
            trimMethod: toTrimMethod(inserted)
          }),
          getKeyPart(inserted)
        );
      })
    );
  }

  return Object.assign(exports, { forInserted });
});