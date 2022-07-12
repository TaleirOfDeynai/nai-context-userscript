import { usModule } from "@utils/usModule";
import $TextSplitterService from "../TextSplitterService";
import $FromFullText from "./queryOps/fromFullText";

import type { TextFragment } from "../TextSplitterService";
import type { MatchResult } from "../MatcherService";
import type { IFragmentAssembly } from "./Fragment";

export namespace Cursor {
  export interface Fragment {
    readonly type: "fragment";
    readonly origin: IFragmentAssembly;
    readonly offset: number;
  }
  
  export interface FullText {
    readonly type: "fullText";
    readonly origin: IFragmentAssembly;
    readonly offset: number;
  }
  
  export type Any = Fragment | FullText;
}

export type Selection = readonly [Cursor.Fragment, Cursor.Fragment];

export default usModule((require, exports) => {
  /** Creates a full-text cursor. */
  const fullText = (origin: IFragmentAssembly, offset: number): Cursor.FullText =>
    Object.freeze({ type: "fullText", origin, offset });
  
  const fragment = (origin: IFragmentAssembly, offset: number): Cursor.Fragment =>
    Object.freeze({ type: "fragment", origin, offset });
  
  /** Creates a cursor of the given type. */
  const create = (
    origin: IFragmentAssembly,
    offset: number,
    type: Cursor.Any["type"]
  ): Cursor.Any => {
    switch (type) {
      case "fullText": return fullText(origin, offset);
      case "fragment": return fragment(origin, offset);
      default: throw new Error(`Unknown cursor type: ${type}`);
    }
  };

  /**
   * Checks if a given cursor's offset appears to be inside a given
   * fragment.
   * 
   * As fragments do not have information on their origin assembly,
   * it does not check to make sure the cursor is actually for the
   * fragment.  Use the `positionOf` function in the assembly query
   * operators to interrogate the assembly the fragment came from
   * for that.
   */
  const isCursorInside = (cursor: Cursor.Any, fragment: TextFragment) =>
    $TextSplitterService(require).isOffsetInside(cursor.offset, fragment);

  /** Ensures the given cursor is a {@link Cursor.Fragment}. */
  const asFragmentCursor = (cursor: Cursor.Any): Cursor.Fragment => {
    if (cursor.type === "fragment") return cursor;
    return $FromFullText(require).fromFullText(cursor.origin, cursor);
  };

  /**
   * Converts a {@link MatchResult} to a {@link Selection}.
   * 
   * If the match is zero-length, the two cursors will both be
   * identical instances.
   */
  const toSelection = (
    match: MatchResult,
    origin: IFragmentAssembly,
    type: Cursor.Any["type"]
  ): Selection => {
    const { index, length } = match;
    const left = asFragmentCursor(create(origin, index, type));
    if (length === 0) return Object.freeze([left, left] as const);

    const right = asFragmentCursor(create(origin, index + length, type));
    return Object.freeze([left, right] as const);
  };

  return Object.assign(exports, {
    fullText,
    fragment,
    create,
    isCursorInside,
    asFragmentCursor,
    toSelection
  });
});