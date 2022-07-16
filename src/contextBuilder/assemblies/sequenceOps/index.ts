/**
 * Module related to operating on kinds of `Iterable<TextFragment>`.
 */

import { usModule } from "@utils/usModule";

// User-script imports...
import $GetStats from "./getStats";
import $SplitAt from "./splitAt";

// Type re-exports...
export type { AssemblyStats } from "./getStats";

export default usModule((require, exports) => {
  return Object.assign(exports, {
    ...$GetStats(require),
    ...$SplitAt(require)
  });
});