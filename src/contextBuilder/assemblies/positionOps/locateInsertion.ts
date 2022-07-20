import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { assert } from "@utils/assert";
import { isNumber } from "@utils/is";
import { chain, skipUntil, concat } from "@utils/iterables";
import $TextSplitterService from "../../TextSplitterService";
import $QueryOps from "../queryOps";
import $CursorOps from "../cursorOps";
import cursorForDir from "./cursorForDir";
import $PositionsFrom from "./positionsFrom";
import $SplitUpFrom from "./splitUpFrom";

import type { TrimType } from "../../TrimmingProviders";
import type { Cursor } from "../../cursors";
import type { IFragmentAssembly } from "../_interfaces";
import type { IterDirection } from "./cursorForDir";

export interface InsertionPosition {
  /**
   * A cursor or selection marking the position of the iteration.
   * 
   * If a {@link Cursor.Selection}:
   * - When `direction` is `"toTop"`, the first cursor is used.
   * - When `direction` is `"toBottom"`, the second cursor is used.
   */
  position: Cursor.Fragment | Cursor.Selection;
  /** Which direction to look for an insertion position. */
  direction: IterDirection;
  /** How many elements to shift the position by; must be positive. */
  offset: number;
}

export namespace Position {
  /** No suitable place found; continue with next fragment. */
  export interface ContinueResult {
    type: IterDirection;
    remainder: number;
  }

  /** Split the assembly at `cursor` and insert between them. */
  export interface SuccessResult {
    type: "inside";
    /** The position to perform the split. */
    cursor: Cursor.Fragment;
  }

  /** Insert before/after the assembly. */
  export interface InsertResult {
    type: "insertBefore" | "insertAfter";
    /** 
     * The number of characters the entry was shunted from its
     * perfect position.
     */
    shunted: number;
  }

  export type Result = ContinueResult | SuccessResult | InsertResult;
}

export type PositionResult = Position.Result;

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const queryOps = $QueryOps(require);
  const cursorOps = $CursorOps(require);
  const { positionsFrom } = $PositionsFrom(require);
  const { splitUpFrom } = $SplitUpFrom(require);

  /**
   * Locates a position relative to the given `position`.
   * 
   * This is intended to be used during the insertion phase to find
   * a key-relative position to split an assembly at to insert another
   * entry in the middle of it.
   * 
   * It will not provide cursors inside of the prefix or suffix, as
   * I did not want to deal with the added complexity of splitting
   * on those fragments.
   * 
   * If you get a result where `remainder === 0`, that is an indication
   * to place the entry immediately before or after this assembly.
   */
  const locateInsertion = (
    /** The assembly to query. */
    assembly: IFragmentAssembly,
    /** The type of insertion being done. */
    insertionType: TrimType,
    /** An object describing how to locate the insertion. */
    positionData: Readonly<InsertionPosition>
  ): PositionResult => {
    const { position, direction, offset } = positionData;

    assert("Expected `offset` to be a positive number.", offset >= 0);

    // Fast-path: If this assembly is empty, tell it to carry on.
    if (queryOps.isEmpty(assembly)) return { type: direction, remainder: offset };

    const initCursor = cursorOps.findBest(assembly, cursorForDir(position, direction));

    // Fast-path: If we're given an offset of 0, we don't need to move
    // the cursor at all (though, `findBest` could have moved it).
    if (offset === 0) return { type: "inside", cursor: initCursor };

    const result = dew(() => {
      // Tracks how many elements we still need to pass.
      let remainder = offset;

      const cursors = chain(splitUpFrom(assembly, initCursor, insertionType, direction))
        // Convert into positions...
        .thru((iter) => positionsFrom(assembly, iter, direction))
        // ...but if we find the initial cursor, skip it...
        .pipe(skipUntil, (c) => c.offset !== initCursor.offset)
        // ...because we're adding it into the first position here.
        .thru((cursors) => concat(initCursor, cursors))
        .value();

      for (const cursor of cursors) {
        if (remainder <= 0) return cursor;
        remainder -= 1;
      }

      // If we get here, we couldn't find a good fragment within the assembly.
      return remainder;
    });

    // If we got a remainder, we tell it to carry on.
    if (isNumber(result)) return { type: direction, remainder: result };

    // We're not going to split on the prefix or suffix, just to avoid
    // the complexity of it, so we need to check where we are.
    switch (cursorOps.positionOf(assembly, result)) {
      // This is the best case; everything is just fine, but this
      // fragment will need to be split.
      case "content": return { type: "inside", cursor: result };
      // This tells it to insert before this fragment.
      case "prefix": return {
        type: "insertBefore",
        shunted: result.offset - ss.beforeFragment(assembly.prefix)
      };
      // And this after this fragment.
      case "suffix": return {
        type: "insertAfter",
        shunted: ss.afterFragment(assembly.suffix) - result.offset
      };
      default: throw new Error("Unexpected position.");
    }
  }

  return Object.assign(exports, {
    locateInsertion
  });
});