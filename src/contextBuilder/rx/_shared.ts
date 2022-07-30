import _conforms from "lodash/conforms";
import { isString } from "@utils/is";

import type { Observable } from "@utils/rx";
import type { TypePredicate } from "@utils/is";
import type { IContextField } from "@nai/ContextModule";
import type { LoreEntry, PhraseBiasConfig } from "@nai/Lorebook";
import type { SourceLike } from "../assemblies/Compound";
import type { ContextSource } from "../ContextSource";
import type { NormalizedBudgetStats } from "../ContextContent";
import type { ActivationSource, ActivatedSource, RejectedSource } from "./2-activation";

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

export type CategorizedSource = ContextSource<CategorizedField>;

export const categories = {
  /** Checks to see if the entry of `source` has a `category` field. */
  isCategorized: _conforms({
    entry: _conforms({
      fieldConfig: _conforms({
        // Need a non-empty string to qualify.
        category: (v) => isString(v) && Boolean(v)
      })
    })
  }) as TypePredicate<CategorizedSource>
};

// Phrase bias stuff.

export const biasGroups = {
  whenActive: (biasGroup: PhraseBiasConfig) =>
    !biasGroup.whenInactive,
  whenInactive: (biasGroup: PhraseBiasConfig) =>
    biasGroup.whenInactive,
  hasValidPhrase: (biasGroup: PhraseBiasConfig) =>
    biasGroup.enabled && Boolean(biasGroup.phrases.length)
};

// Selection and assembly stuff.

export interface BudgetedSource extends ActivatedSource {
  budgetStats: NormalizedBudgetStats;
};

export type InsertableSource = BudgetedSource | SourceLike;
export type InsertableObservable = Observable<InsertableSource>;

/** Gets the budget stats we'll need for reporting later. */
export const asBudgeted = async (source: ActivatedSource): Promise<BudgetedSource> =>
  Object.assign(source, { budgetStats: await source.entry.getStats() });

/** Checks to see if `source` has a `budgetStats` field. */
export const isBudgetedSource = (source: InsertableSource): source is BudgetedSource =>
  "budgetStats" in source;

/** Gets some budget stats from an insertable source. */
export const getBudgetStats = async (source: InsertableSource) => {
  if (isBudgetedSource(source)) return source.budgetStats;
  return {
    tokenBudget: (await source.entry.trimmed)?.tokens.length ?? 0,
    actualReservedTokens: 0
  };
};