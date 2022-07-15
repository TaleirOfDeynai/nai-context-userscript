import { usModule } from "@utils/usModule";
import $TextSplitterService from "../../TextSplitterService";

import type { IFragmentAssembly } from "../Fragment";

export type AffixSplitResult = Pick<IFragmentAssembly, "prefix" | "suffix">;

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);

  /**
   * Helper function that prepares the `prefix` and `suffix` properties
   * for splitting.  If one of the fragments is already empty, it will
   * avoid instantiating a new fragment.
   */
  const getAffixForSplit = (
    /** The assembly being split. */
    assembly: IFragmentAssembly
  ): [AffixSplitResult, AffixSplitResult] => {
    // If we're splitting this assembly, it doesn't make sense to preserve
    // the suffix on the assembly before the cut or the prefix after the cut.
    // Replace them with empty fragments, as needed.
    const { prefix, suffix } = assembly;
    const afterPrefix = ss.asEmptyFragment(prefix);
    const beforeSuffix = ss.asEmptyFragment(suffix);

    return [
      { prefix, suffix: beforeSuffix },
      { prefix: afterPrefix, suffix }
    ];
  };
 
  return Object.assign(exports, {
    getAffixForSplit
  });
});