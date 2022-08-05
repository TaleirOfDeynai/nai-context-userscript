import type { EntrySorter } from "./index";

/** Sorts sources that were force-activated first. */
const activationForced: EntrySorter = () => (a, b) => {
  const aForced = a.activations?.has("forced") ?? false;
  const bForced = b.activations?.has("forced") ?? false;
  if (aForced === bForced) return 0;
  if (aForced) return -1;
  return 1;
};

export default activationForced;