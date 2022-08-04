import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { first } from "@utils/iterables";
import NaiContextBuilder from "@nai/ContextBuilder";
import $QueryOps from "../../../assemblies/queryOps";
import { selection } from "../../_shared";
import { checkThis, getSubContextPart } from "./_shared";

import type { AnyValueOf, UndefOr } from "@utils/utility-types";
import type { ContextStatus } from "@nai/ContextBuilder";
import type { TrimStates, TrimMethods, ReportReasons } from "@nai/ContextBuilder";
import type { AssemblyResultMap } from "../../../SearchService";
import type { Assembler } from "../../40-assembly";

export default usModule((require, exports) => {
  const CB = require(NaiContextBuilder);
  const queryOps = $QueryOps(require);

  const toReason = (inserted: Assembler.Inserted): AnyValueOf<ReportReasons> => {
    const { activations } = inserted.source;

    // Sub-contexts use the default reason.
    if (!activations) return CB.REASONS.Default;

    // Forced activations provide their own reason.
    const forced = activations.get("forced");
    if (forced) return forced;

    if (activations.has("ephemeral")) return CB.REASONS.EphemeralActive;
    if (activations.has("keyed")) return CB.REASONS.KeyTriggered;
    if (activations.has("cascade")) return CB.REASONS.KeyTriggeredNonStory;

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

  const getMatch = (resultMap: UndefOr<AssemblyResultMap>) => {
    if (!resultMap) return undefined;
    const theResults = first(resultMap.values());
    if (!theResults) return undefined;
    return first(theResults);
  };

  const getKeyPart = (inserted: Assembler.Inserted) => {
    const { location } = inserted.result;
    if (location.isKeyRelative) {
      const triggeringKey = location.matchedKey.source;
      const keyIndex = location.matchedKey.index;
      return checkThis({ keyRelative: true, triggeringKey, keyIndex });
    }

    const match = dew(() => {
      const { activations } = inserted.source;
      if (!activations) return undefined;

      const theKeyedMatch = getMatch(activations.get("keyed"));
      if (theKeyedMatch) return theKeyedMatch;

      const theCascade = activations.get("cascade");
      if (!theCascade) return undefined;
      return getMatch(first(theCascade.matches.values()));
    });

    if (!match) return checkThis({ keyRelative: false });

    const triggeringKey = match.source;
    const keyIndex = match.index;
    return checkThis({ keyRelative: false, triggeringKey, keyIndex });
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

        const stats = await selection.getBudgetStats(source);

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
          getKeyPart(inserted),
          getSubContextPart(inserted)
        );
      })
    );
  }

  return Object.assign(exports, { forInserted });
});