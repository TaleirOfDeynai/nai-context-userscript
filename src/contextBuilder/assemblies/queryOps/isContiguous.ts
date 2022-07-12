import _hasIn from "lodash/hasIn";
import { usModule } from "@utils/usModule";
import $TextSplitterService from "../../TextSplitterService";

import type { IFragmentAssembly } from "../Fragment";

type WithIsContiguous = { isContiguous: boolean };
type SomeAssembly = IFragmentAssembly | WithIsContiguous;

const hasIsContiguous = (value: SomeAssembly): value is WithIsContiguous =>
  _hasIn(value, "isContiguous");

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);

  /**
   * Checks if the given assembly's content is contiguous.
   * 
   * If the assembly has an `isContiguous` property, it will defer to
   * that and avoid the expensive recheck.
   */
  const isContiguous = (assembly: SomeAssembly) => {
    if (hasIsContiguous(assembly)) return assembly.isContiguous;
    return ss.isContiguous(assembly.content);
  };

  return Object.assign(exports, {
    isContiguous
  });
});