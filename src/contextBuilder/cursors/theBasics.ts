import { usModule } from "@utils/usModule";
import $TextSplitterService from "../TextSplitterService";
import $FromFullText from "../assemblies/cursorOps/fromFullText";
import fragment, { FragmentCursor } from "./Fragment";
import fullText, { FullTextCursor } from "./FullText";

import type { TextFragment } from "../TextSplitterService";
import type { MatchResult } from "../MatcherService";
import type { Assembly } from "../assemblies";

/** Represents a range from one {@link FragmentCursor} to another. */
export type Selection = readonly [FragmentCursor, FragmentCursor];

/** Accepts any cursor. */
export type AnyCursor = FragmentCursor | FullTextCursor;

/** The named types of cursors. */
export type CursorType = AnyCursor["type"];

export default usModule((require, exports) => {
  const { isOffsetInside } = $TextSplitterService(require);
  const { fromFullText } = $FromFullText(require);

  /** Creates a cursor of the given type. */
  const create = (
    origin: Assembly.IFragment,
    offset: number,
    type: CursorType
  ): AnyCursor => {
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
  const isCursorInside = (cursor: AnyCursor, fragment: TextFragment) =>
    isOffsetInside(cursor.offset, fragment);

  /** Ensures the given cursor is a {@link FragmentCursor}. */
  const asFragmentCursor = (cursor: AnyCursor): FragmentCursor => {
    if (cursor.type === "fragment") return cursor;
    return fromFullText(cursor.origin, cursor);
  };

  /**
   * Converts a {@link MatchResult} to a {@link Selection}.
   * 
   * If the match is zero-length, the two cursors will both be
   * identical instances.
   */
  const toSelection = (
    match: MatchResult,
    origin: Assembly.IFragment,
    type: CursorType
  ): Selection => {
    const { index, length } = match;
    const left = asFragmentCursor(create(origin, index, type));
    if (length === 0) return Object.freeze([left, left] as const);

    const right = asFragmentCursor(create(origin, index + length, type));
    return Object.freeze([left, right] as const);
  };

  return Object.assign(exports, {
    create,
    isCursorInside,
    asFragmentCursor,
    toSelection
  });
});