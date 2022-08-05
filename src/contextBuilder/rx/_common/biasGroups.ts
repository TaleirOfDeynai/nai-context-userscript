import _conforms from "lodash/conforms";
import { usModule } from "@utils/usModule";
import { isArray } from "@utils/is";

import type { TypePredicateOf } from "@utils/is";
import type { IContextField } from "@nai/ContextModule";
import type { PhraseBiasConfig, LoreEntry, Categories } from "@nai/Lorebook";
import type { ContextSource } from "../../ContextSource";

export interface BiasedField extends IContextField {
  loreBiasGroups: LoreEntry["loreBiasGroups"];
}

export type BiasedSource = ContextSource<BiasedField>;

export default usModule((_require, exports) => {
  const whenActive = (biasGroup: PhraseBiasConfig) =>
    !biasGroup.whenInactive;

  const whenInactive = (biasGroup: PhraseBiasConfig) =>
    biasGroup.whenInactive;

  const hasValidPhrase = (biasGroup: PhraseBiasConfig) =>
    biasGroup.enabled && Boolean(biasGroup.phrases.length);

  const isBiased = _conforms<any>({
    entry: _conforms({
      fieldConfig: _conforms({
        // Need a non-empty array to qualify.
        loreBiasGroups: (v) => isArray(v) && Boolean(v.length)
      })
    })
  }) as TypePredicateOf<BiasedSource>;

  return Object.assign(exports, {
    whenActive,
    whenInactive,
    hasValidPhrase,
    isBiased
  });
});