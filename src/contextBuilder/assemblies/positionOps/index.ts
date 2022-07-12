/**
 * Module related to locating insertion positions on `IFragmentAssembly`.
 */

import { usModule } from "@utils/usModule";

// Direct imports...
import cursorForDir from "./cursorForDir";

// User-script imports...
import $PositionsFrom from "./positionsFrom";
import $ShuntOut from "./shuntOut";
import $SplitUpFrom from "./splitUpFrom";

// Type re-exports...
export * from "./_types.d";

export default usModule((require, exports) => {
  return Object.assign(exports, {
    cursorForDir,
    ...$PositionsFrom(require),
    ...$SplitUpFrom(require),
    ...$ShuntOut(require)
  });
});