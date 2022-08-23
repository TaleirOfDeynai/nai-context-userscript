import { usModule } from "@utils/usModule";
import $Selection from "../selection";

import type { EntrySorter } from "./index";

export default usModule((require, exports) => {
  const { isWeightedSource } = $Selection(require);

  /**
   * Sorts sources by their `selectionIndex`, if they have one.
   * 
   * If any source lacks a `selectionIndex`, they are treated equally.
   */
  const selectionIndex: EntrySorter = () => {
    return (a, b) => {
      if (!isWeightedSource(a)) return 0;
      if (!isWeightedSource(b)) return 0;
      return a.selectionIndex - b.selectionIndex;
    };
  };

  return Object.assign(exports, { selectionIndex });
});