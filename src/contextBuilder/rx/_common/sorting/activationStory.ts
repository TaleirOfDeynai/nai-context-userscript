import type { EntrySorter } from "./index";

/** Sorts sources that were story-activated first. */
const activationStory: EntrySorter = () => (a, b) => {
  const aKeyed = a.activations?.has("keyed") ?? false;
  const bKeyed = b.activations?.has("keyed") ?? false;
  if (aKeyed === bKeyed) return 0;
  if (aKeyed) return -1;
  return 1;
};

export default activationStory;