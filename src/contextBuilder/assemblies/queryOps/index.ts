/**
 * Module related to perform queries against `IFragmentAssembly`.
 */

import { usModule } from "@utils/usModule";

// Direct imports...
import * as theBasics from "./theBasics";

// User-script imports...
import $FindBest from "./findBest";
import $FromFullText from "./fromFullText";
import $IsContiguous from "./isContiguous";
import $IsFoundIn from "./isFoundIn";
import $PositionOf from "./positionOf";
import $TheStats from "./theStats";
import $ToFullText from "./toFullText";

// Type re-exports...
export type { CursorPosition } from "./positionOf";
 
export default usModule((require, exports) => {
  return Object.assign(exports, {
    ...theBasics,
    ...$FindBest(require),
    ...$FromFullText(require),
    ...$IsContiguous(require),
    ...$IsFoundIn(require),
    ...$PositionOf(require),
    ...$TheStats(require),
    ...$ToFullText(require)
  });
});