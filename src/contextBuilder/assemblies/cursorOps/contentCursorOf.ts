import { usModule } from "@utils/usModule";
import $FindBest from "./findBest";
import $IsFoundIn from "./isFoundIn";
import $PositionOf from "./positionOf";

import type { UndefOr } from "@utils/utility-types";
import type { Cursor } from "../../cursors";
import type { IFragmentAssembly } from "../_interfaces";

export default usModule((require, exports) => {
  const { findBest } = $FindBest(require);
  const { isFoundIn } = $IsFoundIn(require);
  const { positionOf } = $PositionOf(require);

  /**
   * Checks to make sure that the given `cursor` points to a valid
   * fragment in the assembly's `content`.
   * 
   * When `loose` is `true` and no fragment was found, it will try
   * to reposition the cursor to the nearest valid fragment.
   * 
   * Otherwise, it returns `undefined` if no fragment was found.
   */
  const contentCursorOf = (
    /** The assembly to check against. */
    assembly: IFragmentAssembly,
    /** The cursor demarking the position of the cut. */
    cursor: Cursor.Fragment,
    /**
     * If `true` and no fragment exists in the assembly for the position,
     * the next best position will be used instead as a fallback.
     */
    loose: boolean = false
  ): UndefOr<Cursor.Fragment> => {
    // The input cursor must be for the content.
    if (positionOf(assembly, cursor) !== "content") return undefined;

    // Without `loose`, we cannot try to adjust it.
    if (!loose) return isFoundIn(assembly, cursor) ? cursor : undefined;

    const bestCursor = findBest(assembly, cursor, true);

    // Make sure the cursor did not get moved out of the content.
    // This can happen when the content is empty; the only remaining
    // place it could be moved was to a prefix/suffix fragment.
    const isForContent = positionOf(assembly, bestCursor) === "content";
    return isForContent ? bestCursor : undefined;
  };

  return Object.assign(exports, {
    contentCursorOf
  });
});