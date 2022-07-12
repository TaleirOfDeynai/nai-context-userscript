import type { Cursor, Selection } from "../Cursors";

export type IterDirection = "toTop" | "toBottom";

export interface InsertionPosition {
  /**
   * A cursor or selection marking the position of the iteration.
   * 
   * If a {@link Selection}:
   * - When `direction` is `"toTop"`, the first cursor is used.
   * - When `direction` is `"toBottom"`, the second cursor is used.
   */
  position: Cursor.Fragment | Selection;
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