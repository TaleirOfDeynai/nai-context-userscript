import { usModule } from "@utils/usModule";
import { isBoolean } from "@utils/is";
import $TextSplitterService from "../../TextSplitterService";

import type { IFragmentAssembly } from "../_interfaces";

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);

  /**
   * Checks if the given assembly's content is contiguous.
   * 
   * If the assembly has an `isContiguous` property, it will defer to
   * that and avoid the expensive recheck.
   */
  const isContiguous = (assembly: IFragmentAssembly) => {
    if (isBoolean(assembly.isContiguous)) return assembly.isContiguous;
    return ss.isContiguous(assembly.content);
  };

  return Object.assign(exports, {
    isContiguous
  });
});