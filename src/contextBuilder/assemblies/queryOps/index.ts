/**
 * Module related to perform queries against `IFragmentAssembly`.
 */

import { usModule } from "@utils/usModule";

// Direct imports...
import checkRelated from "./checkRelated";
import isAffixed from "./isAffixed";
import iterateOn from "./iterateOn";

// User-script imports...
import $FindBest from "./findBest";
import $FromFullText from "./fromFullText";
import $IsContiguous from "./isContiguous";
import $IsFoundIn from "./isFoundIn";
import $PositionOf from "./positionOf";
import $ToFullText from "./toFullText";

// Type re-exports...
export type { CursorPosition } from "./positionOf";
 
export default usModule((require, exports) => {
  return Object.assign(exports, {
    checkRelated,
    isAffixed,
    iterateOn,
    ...$FindBest(require),
    ...$FromFullText(require),
    ...$IsContiguous(require),
    ...$IsFoundIn(require),
    ...$PositionOf(require),
    ...$ToFullText(require)
  });
});