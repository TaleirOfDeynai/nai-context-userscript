import { isObject, isString } from "@utils/is";

import type { IContextField } from "@nai/ContextModule";
import type { LoreEntry, PhraseBiasConfig } from "@nai/Lorebook";
import type { ActivationSource, ActivatedSource, RejectedSource } from "./activation";
import type { ContextSource } from "../ContextSource";

// Activation stuff.

export const activation = {
  isActivated: (source: ActivationSource): source is ActivatedSource =>
    source.activated,
  isRejected: (source: ActivationSource): source is RejectedSource =>
    !source.activated
};

// Category stuff.

export interface CategorizedField extends IContextField {
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