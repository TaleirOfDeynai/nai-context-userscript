import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { first } from "@utils/iterables";
import NaiContextBuilder from "@nai/ContextBuilder";
import $QueryOps from "../../../assemblies/queryOps";
import $ContextGroup from "../../../assemblies/ContextGroup";
import $Common from "../../_common";
import $Shared from "./_shared";

import type { AnyValueOf, UndefOr } from "@utils/utility-types";
import type { ContextStatus } from "@nai/ContextBuilder";
import type { TrimStates, TrimMethods } from "@nai/ContextBuilder";
import type { AssemblyResultMap } from "../../../SearchService";
import type { Assembler } from "../../40-assembly";

export default usModule((require, exports) => {
  const { ContextStatus, REASONS } = require(NaiContextBuilder);
  const queryOps = $QueryOps(require);
  const { isContextGroup } = $ContextGroup(require);
  const { selection } = $Common(require);
  const { checkThis, getSubContextPart } = $Shared(require);

  const toReason = (inserted: Assembler.Inserted): string => {
    if (isContextGroup(inserted.source))
      return inserted.source.isEmpty ? "empty group" : "filled group";

    const { activations } = inserted.source;

    // Sub-contexts use the default reason.
    if (!activations) return REASONS.Default;

    // Forced activations provide their own reason.
    forcedChecks: {
      const forced = activations.get("forced");
      if (!forced) break forcedChecks;
      return forced;
    }

    ephemeralChecks: {
      if (!activations.has("ephemeral")) break ephemeralChecks;
      return REASONS.EphemeralActive;
    }
    
    keyedChecks: {
      if (!activations.has("keyed")) break keyedChecks;
      return REASONS.KeyTriggered;
    }

    // NovelAI now includes the identifier of the matched entry.
    cascadeChecks: {
      const cascade = activations.get("cascade");
      if (!cascade) break cascadeChecks;
      const firstDegree = first(cascade.matches);
      if (!firstDegree) break cascadeChecks;
      const [source] = firstDegree;
      return `${REASONS.KeyTriggeredNonStory}${source.identifier}`;
    }

    return REASONS.Default;
  };

  const toTrimState = (inserted: Assembler.Inserted): AnyValueOf<TrimStates> => {
    if (isContextGroup(inserted.source))
      return inserted.source.isEmpty ? "not included" : "included";

    const { assembly } = inserted.result;
    if (assembly.isSource) return "included";

    const sourceText = queryOps.getText(assembly.source);
    if (assembly.text.length === sourceText.length) return "included";

    return "partially included";
  };

  const toTrimMethod = (inserted: Assembler.Inserted): AnyValueOf<TrimMethods> => {
    if (isContextGroup(inserted.source)) return "no trim";

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

        const stats = await selection.getBudgetStats(source);

        return Object.assign(
          new ContextStatus(source.entry.field),
          checkThis({
            identifier: source.identifier,
            unqiueId: source.uniqueId,
            type: source.type,
            included: true,
            state: toTrimState(inserted),
            reason: toReason(inserted),
            includedText: result.assembly.text,
            // It's possible that inserting a group could actually reduce the
            // tokens used.  We're just not going to report that.
            calculatedTokens: Math.max(0, inserted.deltaTokens),
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