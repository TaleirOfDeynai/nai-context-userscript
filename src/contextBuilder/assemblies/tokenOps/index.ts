/**
 * Module related to manipulating `ITokenizedAssembly`.
 */

import { usModule } from "@utils/usModule";
 
// Direct imports...
import getTokensForSplit from "./getTokensForSplit";

// User-script imports...
import $RemoveAffix from "./removeAffix";
import $SplitAt from "./splitAt";

// Type re-exports...
export { TokenizedSplitResult } from "./splitAt";
  
export default usModule((require, exports) => {
  return Object.assign(exports, {
    getTokensForSplit,
    ...$RemoveAffix(require),
    ...$SplitAt(require)
  });
});