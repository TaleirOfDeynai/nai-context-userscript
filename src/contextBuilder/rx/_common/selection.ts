import _conforms from "lodash/conforms";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { isInstance, isNumber } from "@utils/is";

import type { Observable } from "@utils/rx";
import type { TypePredicate } from "@utils/is";
import type { NormalizedBudgetStats } from "../../ContextContent";
import type { ActivatedSource } from "./activation";
import type { SourceOf, SomeContextSource } from "./index";

export interface BudgetedSource extends ActivatedSource {
  budgetStats: NormalizedBudgetStats;
};

export interface WeightedSource extends BudgetedSource {
  selectionIndex: number;
};

export type InsertableSource = SourceOf<BudgetedSource>;
export type InsertableObservable = Observable<InsertableSource>;

export default usModule((_require, exports) => {
  /** Gets the budget stats we'll need for reporting later. */
  const asBudgeted = async (source: ActivatedSource): Promise<BudgetedSource> =>
    Object.assign(source, { budgetStats: await source.entry.getStats() });

  /** Checks to see if `source` has a `budgetStats` field. */
  const isBudgetedSource = _conforms<any>({
    budgetStats: isInstance,
    activated: (v: any) => v === true
  }) as TypePredicate<BudgetedSource, SomeContextSource>;

  const isWeightedSource = dew(() => {
    const _check = _conforms<any>({
      selectionIndex: isNumber
    }) as TypePredicate<WeightedSource, BudgetedSource>;

    const _impl = (source: any) => isBudgetedSource(source) && _check(source);

    return _impl as TypePredicate<WeightedSource, SomeContextSource>;
  });

  /** Gets some budget stats from an insertable source. */
  const getBudgetStats = async (source: InsertableSource) => {
    if (isBudgetedSource(source)) return source.budgetStats;
    return {
      tokenBudget: (await source.entry.trimmed)?.tokens.length ?? 0,
      actualReservedTokens: 0
    };
  };

  return Object.assign(exports, {
    asBudgeted,
    isBudgetedSource,
    isWeightedSource,
    getBudgetStats
  });
});