import { usModule } from "@utils/usModule";
import { toImmutable } from "@utils/iterables";
import $TextSplitterService from "../../TextSplitterService";
import $QueryOps from "../queryOps";

import type { IFragmentAssembly } from "../Fragment";

export type AffixSplitResult = Pick<IFragmentAssembly, "prefix" | "suffix">;

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const queryOps = $QueryOps(require);

  /**
   * Generates a version of the given assembly that has no prefix or suffix.
   * 
   * It still has the same source, so cursors for that source will still
   * work as expected.
   */
  const removeAffix = (assembly: IFragmentAssembly): IFragmentAssembly => {
    // No need if we don't have a prefix or suffix.
    if (!queryOps.isAffixed(assembly)) return assembly;

    // Replace the suffix and prefix with zero-length fragments.
    return {
      prefix: ss.asEmptyFragment(assembly.prefix),
      content: toImmutable(assembly.content),
      suffix: ss.asEmptyFragment(assembly.suffix),
      source: assembly.source
    };
  }
 
  return Object.assign(exports, {
    removeAffix
  });
});