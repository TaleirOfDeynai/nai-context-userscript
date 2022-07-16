import { usModule } from "@utils/usModule";
import { chain } from "@utils/iterables";
import $TextSplitterService from "../../TextSplitterService";

import type { TextFragment } from "../../TextSplitterService";

export interface AssemblyStats {
  /** The minimum possible offset of all fragments. */
  minOffset: number;
  /** The maximum possible offset of all fragments. */
  maxOffset: number;
  /** The length implied by `maxOffset - minOffset`. */
  impliedLength: number;
  /** The actual count of characters in all the provided fragments. */
  concatLength: number;
}

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);

  /**
   * Produces some useful stats given a collection of fragments.
   * 
   * This takes an array to force conversion to an iterable type that
   * can definitely be iterated multiple times.
   */
  const getStats = (
    /** The fragments to analyze. */
    fragments: readonly TextFragment[],
    /** When `fragments` is empty, the default offset to use. */
    emptyOffset = 0
  ): AssemblyStats => {
    // The empty offset is only used when `fragments` is empty.
    const initOffset = fragments.length ? 0 : emptyOffset;

    const maxOffset = chain(fragments)
      .map(ss.afterFragment)
      .reduce(initOffset, Math.max);
    const minOffset = chain(fragments)
      .map(ss.beforeFragment)
      .reduce(maxOffset, Math.min);
    
    return {
      minOffset, maxOffset,
      impliedLength: maxOffset - minOffset,
      concatLength: fragments.reduce((p, v) => p + v.content.length, 0)
    };
  };

  return Object.assign(exports, {
    getStats
  });
});