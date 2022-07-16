/**
 * Module related to interactions between `IFragmentAssembly` and
 * the cursors.
 */

import { usModule } from "@utils/usModule";

// User-script imports...
import $ContentCursorOf from "./contentCursorOf";
import $FindBest from "./findBest";
import $FromFullText from "./fromFullText";
import $IsFoundIn from "./isFoundIn";
import $PositionOf from "./positionOf";
import $ToFullText from "./toFullText";

// Type re-exports...
export type { CursorPosition } from "./positionOf";
 
export default usModule((require, exports) => {
  return Object.assign(exports, {
    ...$ContentCursorOf(require),
    ...$FindBest(require),
    ...$FromFullText(require),
    ...$IsFoundIn(require),
    ...$PositionOf(require),
    ...$ToFullText(require)
  });
});