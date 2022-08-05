import _conforms from "lodash/conforms";
import { usModule } from "@utils/usModule";
import { isInstance } from "@utils/is";

import type { Observable } from "@utils/rx";
import type { TypePredicate } from "@utils/is";
import type { NormalizedBudgetStats } from "../../ContextContent";
import type { ActivatedSource } from "./activation";
import type { SourceOf, SomeContextSource } from "./index";

export interface BudgetedSource extends ActivatedSource {
  budgetStats: NormalizedBudgetStats;
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
    getBudgetStats
  });
});