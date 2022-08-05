import type { EntrySorter } from "./index";

/**
 * Sorts sources that activated by cascade:
 * - Before those that did not.
 * - By the final degree of the cascade, ascending.
 * 
 * The final degree of cascade is how many layers deep into the cascade
 * we were when the last match was found.  Entries with a lower final
 * degree could have been matched by the entry.
 * 
 * This will order entries so all entries that an entry matched come
 * before that entry.
 */
const cascadeFinalDegree: EntrySorter = () => (a, b) => {
  const aCascade = a.activations?.get("cascade");
  const bCascade = b.activations?.get("cascade");
  if (!aCascade && !bCascade) return 0;
  if (!aCascade) return 1;
  if (!bCascade) return -1;
  // Prefer the one with the lowest degree.
  return aCascade.finalDegree - bCascade.finalDegree;
};

export default cascadeFinalDegree;