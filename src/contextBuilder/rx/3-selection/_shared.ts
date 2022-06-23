import type { NormalizedBudgetStats } from "../../ContextContent";
import type { ActivatedSource } from "../2-activation";

export interface BudgetedSource extends ActivatedSource {
  budgetStats: NormalizedBudgetStats;
};

/** Gets the budget stats we'll need for reporting later. */
export async function asBudgeted(source: ActivatedSource): Promise<BudgetedSource> {
  const budgetStats = await source.entry.getStats();
  return Object.assign(source, { budgetStats });
};