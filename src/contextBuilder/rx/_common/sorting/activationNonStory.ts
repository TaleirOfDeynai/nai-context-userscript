import type { EntrySorter } from "./index";

/** Sorts sources that were NOT story-activated first. */
const activationNonStory: EntrySorter = () => (a, b) => {
  const aKeyed = a.activations?.has("keyed") ?? false;
  const bKeyed = b.activations?.has("keyed") ?? false;
  if (aKeyed === bKeyed) return 0;
  if (aKeyed) return 1;
  return -1;
};

export default activationNonStory;