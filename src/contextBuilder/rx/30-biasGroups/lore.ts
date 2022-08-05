import _conforms from "lodash/conforms";
import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { chain } from "@utils/iterables";
import $Common from "../_common";

import type { UndefOr } from "@utils/utility-types";
import type { ResolvedBiasGroup } from "@nai/ContextBuilder";
import type { ActivationObservable } from "../_common/activation";

/**
 * Checks each {@link ContextSource} for lore bias group inclusions.
 */
export default usModule((require, exports) => {
  const { biasGroups } = $Common(require);

  const createStream = (
    /** The stream of activation results. */
    activating: ActivationObservable
  ): rx.Observable<ResolvedBiasGroup> => activating.pipe(
    rxop.connect((shared) => rx.merge(
      // Look for "when not inactive" bias groups by searching the activated entries.
      shared.pipe(
        rxop.collect((source): UndefOr<ResolvedBiasGroup> => {
          if (!source.activated) return undefined;
          if (!biasGroups.isBiased(source)) return undefined;

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
        rxop.collect((source): UndefOr<ResolvedBiasGroup> => {
          if (source.activated) return undefined;
          if (!biasGroups.isBiased(source)) return undefined;

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