import { usModule } from "@utils/usModule";
import { isObject, isString } from "@utils/is";
import { assertAs } from "@utils/assert";
import UUID from "@nai/UUID";

import type * as CB from "@nai/ContextBuilder";
import type { ConstrainedMap } from "@utils/utility-types";
import type { ForcedActivation } from "./rx/activation/forced";
import type { KeyedActivation } from "./rx/activation/keyed";
import type { EphemeralActivation } from "./rx/activation/ephemeral";
import type { CascadeActivation } from "./rx/activation/cascade";

/** Just provides a source of types for {@link ActivationMap}. */
interface ActivationMapping {
  forced: ForcedActivation;
  keyed: KeyedActivation;
  cascade: CascadeActivation;
  ephemeral: EphemeralActivation;
}

/** A {@link Map} for types of activations. */
export type ActivationMap = ConstrainedMap<ActivationMapping>;

export type SourceType
  = "story" | "memory" | "an"
  | "lore" | "ephemeral"
  | "unknown";

export interface ContextSource<
  TField extends CB.ContextField = CB.ContextField,
  TType extends SourceType = SourceType
> {
  uniqueId: string;
  identifier: string;
  type: TType;
  entry: TField;
  activations: ActivationMap;
}

export default usModule((require, exports) => {
  const uuid = require(UUID);

  const toIdentifier = (entry: Record<any, any>, type: SourceType): string => {
    assertAs("Expected an object.", isObject, entry);

    ephemeral: {
      if (type !== "ephemeral") break ephemeral;
      if (!("text" in entry)) break ephemeral;
      if (!isString(entry.text)) break ephemeral;
      const text = entry.text;
      return `E:${text.length > 12 ? `${text.slice(0, 12)}...` : text.slice(0, 15)}`;
    }

    loreLike: {
      if (!("displayName" in entry)) break loreLike;
      if (!isString(entry.displayName)) break loreLike;
      return entry.displayName;
    }

    switch (type) {
      case "story": return "Story";
      case "memory": return "Memory";
      case "an": return "A/N";
      default: return `Unknown Object (as ${type})`;
    }    
  };

  const create = <TField extends CB.ContextField, TType extends SourceType>(
    entry: TField,
    type: TType,
    identifier = toIdentifier(entry, type)
  ): ContextSource<TField, TType> => {
    return {
      uniqueId: uuid.v4(),
      identifier, type, entry,
      activations: new Map()
    };
  };

  return Object.assign(exports, { create });
});