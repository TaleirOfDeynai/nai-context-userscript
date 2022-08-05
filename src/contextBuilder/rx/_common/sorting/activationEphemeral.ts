import type { EntrySorter } from "./index";

/** Sorts sources that were ephemerally-activated first. */
const activationEphemeral: EntrySorter = () => (a, b) => {
  const aEphemeral = a.activations?.has("ephemeral") ?? false;
  const bEphemeral = b.activations?.has("ephemeral") ?? false;
  if (aEphemeral === bEphemeral) return 0;
  if (aEphemeral) return -1;
  return 1;
};

export default activationEphemeral;