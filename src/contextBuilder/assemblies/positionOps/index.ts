/**
 * Module related to locating insertion positions on `IFragmentAssembly`.
 */

import { usModule } from "@utils/usModule";

// Direct imports...
import cursorForDir from "./cursorForDir";

// User-script imports...
import $EntryPosition from "./entryPosition";
import $LocateInsertion from "./locateInsertion";
import $PositionsFrom from "./positionsFrom";
import $ShuntOut from "./shuntOut";
import $SplitToSelections from "./splitToSelections";

// Type re-exports...
export { IterDirection } from "./cursorForDir";
export { InsertionPosition } from "./locateInsertion";
export { Position, PositionResult } from "./locateInsertion";

export default usModule((require, exports) => {
  return Object.assign(exports, {
    cursorForDir,
    ...$EntryPosition(require),
    ...$LocateInsertion(require),
    ...$PositionsFrom(require),
    ...$ShuntOut(require),
    ...$SplitToSelections(require)
  });
});