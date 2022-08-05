import _conforms from "lodash/conforms";
import * as rx from "@utils/rx";
import { usModule } from "@utils/usModule";

import type { ConstrainedMap } from "@utils/utility-types";
import type { TypePredicate } from "@utils/is";
import type { ForcedActivation } from "../20-activation/forced";
import type { KeyedActivation } from "../20-activation/keyed";
import type { EphemeralActivation } from "../20-activation/ephemeral";
import type { CascadeActivation } from "../20-activation/cascade";
import type { EnabledSource } from "../10-source";
import type { SourceOf } from "./index";

/** Just provides a source of types for {@link ActivationMap}. */
interface ActivationMapping {
  forced: ForcedActivation;
  keyed: KeyedActivation;
  ephemeral: EphemeralActivation;
  cascade: CascadeActivation;
}

/** A {@link Map} for types of activations. */
export type ActivationMap = ConstrainedMap<ActivationMapping>;

/** Shared state for activators. */
export type ActivationState<T extends EnabledSource = EnabledSource> = {
  source: T,
  activations: ActivationMap
};

export interface ActivatedSource extends EnabledSource {
  activated: true;
  activations: ActivationMap;
};

export interface RejectedSource extends EnabledSource {
  activated: false;
  activations: ActivationMap;
};

export type ActivationSource = ActivatedSource | RejectedSource;

export type ActivationObservable = rx.Observable<ActivationSource>;

export default usModule((_require, exports) => {
  /** Checks to see if the source is activated. */
  const isActivated = _conforms<any>({
    activated: (v: any) => v === true,
    activations: (v: any) => v instanceof Map
  }) as TypePredicate<ActivatedSource, SourceOf<ActivationSource>>;

  /** Checks to see if the source is not activated. */
  const isRejected = _conforms<any>({
    activated: (v: any) => v === false,
    activations: (v: any) => v instanceof Map
  }) as TypePredicate<RejectedSource, SourceOf<ActivationSource>>;

  return Object.assign(exports, {
    isActivated,
    isRejected
  });
});