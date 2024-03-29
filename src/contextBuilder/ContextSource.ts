/**
 * The abstraction here is basically just a scratch-pad used during the
 * builder pipeline.  Yeah, mutating an object in an RxJS stream is bad
 * mojo, but mutation is fast and types can guard programmers from
 * themselves.
 */

import { usModule } from "@utils/usModule";
import { isObject, isString } from "@utils/is";
import { assertAs } from "@utils/assert";

import type { IContextField } from "@nai/ContextModule";
import type { ContextContent } from "./ContextContent";

export type SourceType
  = "story" | "memory" | "an"
  | "lore" | "ephemeral"
  | "unknown";

export interface ContextSource<
  TField extends IContextField = IContextField,
  TType extends SourceType = SourceType
> {
  readonly uniqueId: string;
  identifier: string;
  type: TType;
  entry: ContextContent<TField>;
}

export type ExtendField<TSource extends ContextSource, TFieldEx extends {}>
  = TSource extends ContextSource<infer TF>
  ? TSource & { entry: ContextContent<TF & TFieldEx> }
  : never;

export default usModule((require, exports) => {
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

  const create = <TField extends IContextField, TType extends SourceType>(
    entry: ContextContent<TField>,
    type: TType,
    identifier = toIdentifier(entry.field, type)
  ): ContextSource<TField, TType> => {
    return {
      // Just alias the UUID of the content for convenience.
      get uniqueId() { return entry.uniqueId; },
      identifier, type, entry
    };
  };

  return Object.assign(exports, { create });
});