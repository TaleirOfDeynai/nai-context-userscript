import { usModule } from "@utils/usModule";
import $SearchService from "../../../SearchService";

import type { EntrySorter } from "./index";

export default usModule((require, exports) => {
  const { findHighestIndex } = $SearchService(require);

  /**
   * Sorts sources that were story-activated:
   * - Before those that were not.
   * - In the order of where the match was found, later in the story first.
   * 
   * This is a secret NovelAI feature and is controlled by
   * `orderByKeyLocations` in the lorebook config.
   */
  const storyKeyOrder: EntrySorter = ({ orderByKeyLocations }) => {
    // Only sort when the feature is enabled.
    if (!orderByKeyLocations) return () => 0;

    return (a, b) => {
      // Keyed entries are higher priority than un-keyed entries.
      const aBest = findHighestIndex(a.activations?.get("keyed"));
      const bBest = findHighestIndex(b.activations?.get("keyed"));
      if (!aBest && !bBest) return 0;
      if (!aBest) return 1;
      if (!bBest) return -1;
  
      // We want to prefer the match with the highest index.
      const [, { index: aIndex }] = aBest;
      const [, { index: bIndex }] = bBest;
      return bIndex - aIndex;
    };
  };

  return Object.assign(exports, { storyKeyOrder });
});