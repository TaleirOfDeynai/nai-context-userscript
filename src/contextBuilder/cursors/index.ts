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