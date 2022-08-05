import type { EntrySorter } from "./index";

/**
 * Sorts sources that activated by cascade:
 * - Before those that did not.
 * - By the initial degree of the cascade, ascending.
 * 
 * The initial degree of the cascade is how many other entries had
 * to activate by cascade before this entry could activate.
 * 
 * This will order entries so any entries that an entry initially matched
 * come before that entry.
 */
const cascadeInitDegree: EntrySorter = () => (a, b) => {
  const aCascade = a.activations?.get("cascade");
  const bCascade = b.activations?.get("cascade");
  if (!aCascade && !bCascade) return 0;
  if (!aCascade) return 1;
  if (!bCascade) return -1;
  // Prefer the one with the lowest degree.
  return aCascade.initialDegree - bCascade.initialDegree;
};

export default cascadeInitDegree;