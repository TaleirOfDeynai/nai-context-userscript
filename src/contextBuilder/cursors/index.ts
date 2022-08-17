/**
 * Cursors represent a position relative to the source string for
 * an `IFragmentAssembly`.
 * 
 * Because a `TextFragment` knows where it was once positioned in
 * the source text, we have a means to map an offset from the source
 * string to one of its fragments, even as we tear that string apart
 * and throw parts of it into the trash.
 * 
 * This module provides utilities for working with these offsets.
 */

import { usModule } from "@utils/usModule";
import fragment, { FragmentCursor } from "./Fragment";
import fullText, { FullTextCursor } from "./FullText";
import $TheBasics from "./theBasics";

import type * as TheBasics from "./theBasics";

/** Quick access to cursor types. */
export namespace Cursor {
  export type Fragment = FragmentCursor;
  export type FullText = FullTextCursor;
  export type Any = TheBasics.AnyCursor;
  export type Selection = TheBasics.Selection;
  export type Type = TheBasics.CursorType;
}

export default usModule((require, exports) => {
  return Object.assign(exports, {
    fullText,
    fragment,
    ...$TheBasics(require)
  });
});