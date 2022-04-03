import * as rx from "rxjs";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { isArray, isObject } from "@utils/is";
import { chain } from "@utils/iterables";
import { whenActive, whenInactive, hasValidPhrase } from "./_shared";

import type { Observable as Obs } from "rxjs";
import type { ContextField } from "@nai/ContextBuilder";
import type { LoreEntry } from "@nai/Lorebook";
import type { SafeSource, InFlightObservable } from "../activation";
import type { TriggeredBiasGroup } from "./_shared";

interface BiasedField extends ContextField {
  loreBiasGroups: LoreEntry["loreBiasGroups"];
}

type BiasedSource = SafeSource<BiasedField>;

/**
 * Checks each {@link ContextSource} for lore bias group inclusions.
 */
export default usModule((_require, exports) => {
  const isBiased = (source: SafeSource<any>): source is BiasedSource => {
    const { entry } = source;
    if (!isObject(entry)) return false;
    if (!("loreBiasGroups" in entry)) return false;
    if (!isArray(entry.loreBiasGroups)) return false;
    return entry.loreBiasGroups.length > 0;
  };

  const createStream = (
    /** The stream of activation results. */
    activating: InFlightObservable
  ): Obs<TriggeredBiasGroup> => activating.pipe(
    rxop.connect((shared) => rx.merge(
      // Look for "when not inactive" bias groups by searching the activated entries.
      shared.pipe(
        rxop.collect(([state, source]) => {
          if (state !== "activated") return undefined;
          if (!isBiased(source)) return undefined;

          const groups = chain(source.entry.loreBiasGroups)
            .filter(whenActive)
            .filter(hasValidPhrase)
            .toArray();
          if (!groups.length) return undefined;

          return { identifier: source.identifier, groups };
        })
      ),
      // Look for "when inactive" bias groups by searching the rejections.
      // This intentionally does not include disabled sources; those are disabled!
      shared.pipe(
        rxop.collect(([state, source]) => {
          if (state !== "rejected") return undefined;
          if (!isBiased(source)) return undefined;

          const groups = chain(source.entry.loreBiasGroups)
            .filter(whenInactive)
            .filter(hasValidPhrase)
            .toArray();
          if (!groups.length) return undefined;

          return { identifier: source.identifier, groups };
        })
      )
    )),
    rxop.shareReplay()
  );

  return Object.assign(exports, { createStream });
});