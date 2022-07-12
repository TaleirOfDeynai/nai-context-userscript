import { usModule } from "@utils/usModule";
import { toImmutable } from "@utils/iterables";
import $TextSplitterService from "../../TextSplitterService";
import $GetStats from "../sequenceOps/getStats";
import { iterateOn, getSource, isAffixed } from "./theBasics";

import type { IFragmentAssembly } from "../Fragment";

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const stats = $GetStats(require);

  /**
   * Gets the full fragment stats for a given assembly.
   * 
   * If the assembly has a `stats` property, it will defer to that and
   * avoid the expensive recheck, unless `force` is true.
   */
  const getStats = (assembly: IFragmentAssembly, force = false) => {
    if (!force && assembly.stats) return assembly.stats;
    // If we're un-affixed, we can reuse the content stats.
    // This would skip the conversion to an array.
    if (!isAffixed(assembly)) return getContentStats(assembly);
    return stats.getStats(toImmutable(iterateOn(assembly)));
  }

  /**
   * Gets the content stats for a given assembly.
   * 
   * If the assembly has a `stats` property, it will defer to that and
   * avoid the expensive recheck, unless `force` is true.
   */
  const getContentStats = (assembly: IFragmentAssembly, force = false) => {
    if (!force && assembly.contentStats) return assembly.contentStats;

    // If the assembly's content was empty, make sure we supply a default
    // offset after the source's prefix.
    return stats.getStats(
      toImmutable(assembly.content),
      ss.afterFragment(getSource(assembly).prefix)
    );
  };

  return Object.assign(exports, {
    getStats,
    getContentStats
  });
});