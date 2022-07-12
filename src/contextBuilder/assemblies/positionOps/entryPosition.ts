import { usModule } from "@utils/usModule";
import { chain, first, last } from "@utils/iterables";
import $TextSplitterService from "../../TextSplitterService";
import $Cursors from "../Cursors";
import $PositionsFrom from "./positionsFrom";
import $SplitUpFrom from "./splitUpFrom";

import type { TrimType } from "../../TrimmingProviders";
import type { Cursor } from "../Cursors";
import type { IFragmentAssembly } from "../Fragment";
import type { IterDirection } from "./cursorForDir";

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const c = $Cursors(require);
  const { positionsFrom } = $PositionsFrom(require);
  const { splitUpFrom } = $SplitUpFrom(require);

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
      return chain(splitUpFrom(assembly, initCursor, insertionType, direction))
        .thru((iter) => positionsFrom(assembly, iter, direction))
        .value((c) => first(c) ?? initCursor);
    }
    else if (direction === "toTop") {
      const suffix = assembly.suffix.content ? assembly.suffix : undefined;
      const frag = suffix ?? last(assembly.content) ?? assembly.prefix;
      return c.fragment(assembly, ss.afterFragment(frag));
    }
    else {
      const prefix = assembly.prefix.content ? assembly.prefix : undefined;
      const frag = prefix ?? first(assembly.content) ?? assembly.suffix;
      return c.fragment(assembly, ss.beforeFragment(frag));
    }
  }

  return Object.assign(exports, {
    entryPosition
  });
});