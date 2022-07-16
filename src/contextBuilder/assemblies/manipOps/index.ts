/**
 * Module related to manipulating `IFragmentAssembly`.
 */

import { usModule } from "@utils/usModule";
 
// Direct imports...
import makeSafe from "./makeSafe";

// User-script imports...
import $GetAffixForSplit from "./getAffixForSplit";
import $RemoveAffix from "./removeAffix";
import $SplitAt from "./splitAt";

// Type re-exports...
export { ISafeAssembly } from "./makeSafe";
export { FragmentSplitResult } from "./splitAt";
  
export default usModule((require, exports) => {
  return Object.assign(exports, {
    makeSafe,
    ...$GetAffixForSplit(require),
    ...$RemoveAffix(require),
    ...$SplitAt(require)
  });
});