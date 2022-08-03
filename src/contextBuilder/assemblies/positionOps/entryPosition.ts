import { usModule } from "@utils/usModule";
import { first } from "@utils/iterables";
import makeCursor from "../../cursors/Fragment";
import $TextSplitterService from "../../TextSplitterService";
import $QueryOps from "../queryOps";
import $PositionsFrom from "./positionsFrom";

import type { TrimType } from "../../TrimmingProviders";
import type { Cursor } from "../../cursors";
import type { IFragmentAssembly } from "../_interfaces";
import type { IterDirection } from "./cursorForDir";

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const queryOps = $QueryOps(require);
  const { positionsFrom } = $PositionsFrom(require);

  /**
   * Gets a cursor for entering this assembly during iteration.
   */
  const entryPosition = (
    /** The assembly to query. */
    assembly: IFragmentAssembly,
    /** Which direction to iterate. */
    direction: IterDirection,
    /**
     * The type of insertion to be done.
     * 
     * This may be omitted to produce a cursor:
     * - at the beginning of the assembly if `direction` is `"toBottom"`.
     * - at the end of the assembly if `direction` is `"toTop"`.
     * 
     * When provided, it will provide a position valid for the
     * insertion type:
     * - the earliest possible position if `direction` is `"toBottom"`.
     * - the latest possible position if `direction` is `"toTop"`.
     * 
     * If there is no valid position, it will return the same value as
     * though it were omitted; this will be the case if the assembly is
     * empty.  It should be the prefix or suffix, doing their job as
     * positional anchors.
     */
    insertionType?: TrimType
  ): Cursor.Fragment => {
    if (insertionType) {
      const initCursor = entryPosition(assembly, direction);
      const c = [...positionsFrom(assembly, initCursor, insertionType, direction)];
      return first(c) ?? initCursor;
    }
    else if (direction === "toTop") {
      const frag = queryOps.getLastFragment(assembly) ?? assembly.prefix;
      return makeCursor(assembly, ss.afterFragment(frag));
    }
    else {
      const frag = queryOps.getFirstFragment(assembly) ?? assembly.suffix;
      return makeCursor(assembly, ss.beforeFragment(frag));
    }
  }

  return Object.assign(exports, {
    entryPosition
  });
});