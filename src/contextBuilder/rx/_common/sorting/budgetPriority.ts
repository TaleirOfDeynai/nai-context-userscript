import type { EntrySorter } from "./index";

/** Sorts sources by their budget priority, descending. */
const budgetPriority: EntrySorter = () => (a, b) => {
  const { budgetPriority: ap } = a.entry.contextConfig;
  const { budgetPriority: bp } = b.entry.contextConfig;
  return bp - ap;
};

export default budgetPriority;