import { isObject, isString } from "@utils/is";

import type { ContextField } from "@nai/ContextBuilder";
import type { LoreEntry, PhraseBiasConfig } from "@nai/Lorebook";
import type { ContextSource } from "../ContextSource";

// Category stuff.

export interface CategorizedField extends ContextField {
  category: LoreEntry["category"];
}

type CategorizedSource = ContextSource<CategorizedField>;

export const categories = {
  /** Checks to see if the entry of `source` has a `category` field. */
  isCategorized: (source: ContextSource<any>): source is CategorizedSource => {
    const { entry } = source;
    if (!isObject(entry)) return false;
    if (!("category" in entry)) return false;
    if (!isString(entry.category)) return false;
    return Boolean(entry.category);
  }
};

// Phrase bias stuff.

export interface TriggeredBiasGroup {
  groups: PhraseBiasConfig[];
  identifier: string;
}

export const biasGroups = {
  whenActive: (biasGroup: PhraseBiasConfig) =>
    !biasGroup.whenInactive,
  whenInactive: (biasGroup: PhraseBiasConfig) =>
    biasGroup.whenInactive,
  hasValidPhrase: (biasGroup: PhraseBiasConfig) =>
    biasGroup.enabled && Boolean(biasGroup.phrases.length)
};