import conforms from "lodash-es/conforms";
import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { isArray } from "@utils/is";
import { chain } from "@utils/iterables";
import { biasGroups } from "../_shared";

import type { TypePredicate } from "@utils/is";
import type { IContextField } from "@nai/ContextModule";
import type { LoreEntry } from "@nai/Lorebook";
import type { ContextSource } from "../../ContextSource";
import type { ActivationObservable } from "../activation";
import type { TriggeredBiasGroup } from "../_shared";

interface BiasedField extends IContextField {
  loreBiasGroups: LoreEntry["loreBiasGroups"];
}

type BiasedSource = ContextSource<BiasedField>;

/**
 * Checks each {@link ContextSource} for lore bias group inclusions.
 */
export default usModule((_require, exports) => {
  const isBiased = conforms({
    entry: conforms({
      fieldConfig: conforms({
        // Need a non-empty array to qualify.
        loreBiasGroups: (v) => isArray(v) && Boolean(v.length)
      })
    })
  }) as TypePredicate<BiasedSource>;

  const createStream = (
    /** The stream of activation results. */
    activating: ActivationObservable
  ): rx.Observable<TriggeredBiasGroup> => activating.pipe(
    rxop.connect((shared) => rx.merge(
      // Look for "when not inactive" bias groups by searching the activated entries.
      shared.pipe(
        rxop.collect((source) => {
          if (!source.activated) return undefined;
          if (!isBiased(source)) return undefined;

          const groups = chain(source.entry.fieldConfig.loreBiasGroups)
            .filter(biasGroups.whenActive)
            .filter(biasGroups.hasValidPhrase)
            .toArray();
          if (!groups.length) return undefined;

          return { identifier: source.identifier, groups };
        })
      ),
      // Look for "when inactive" bias groups by searching the rejections.
      // This intentionally does not include disabled sources; those are disabled!
      shared.pipe(
        rxop.collect((source) => {
          if (source.activated) return undefined;
          if (!isBiased(source)) return undefined;

          const groups = chain(source.entry.fieldConfig.loreBiasGroups)
            .filter(biasGroups.whenInactive)
            .filter(biasGroups.hasValidPhrase)
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