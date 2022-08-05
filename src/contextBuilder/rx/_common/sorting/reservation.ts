import { usModule } from "@utils/usModule";
import $Selection from "../selection";

import type { InsertableSource } from "../selection";
import type { EntrySorter } from "./index";

export default usModule((require, exports) => {
  const { isBudgetedSource } = $Selection(require);

  const hasReservedTokens = (source: InsertableSource) => {
    if (!isBudgetedSource(source)) return false;
    return source.budgetStats.actualReservedTokens > 0;
  };

  /** Sorts sources by their budget priority, descending. */
  const reservation: EntrySorter = () => (a, b) => {
    const aReserved = hasReservedTokens(a);
    const bReserved = hasReservedTokens(b);
    if (aReserved === bReserved) return 0;
    if (aReserved) return -1;
    return 1;
  };

  return Object.assign(exports, { reservation });
});