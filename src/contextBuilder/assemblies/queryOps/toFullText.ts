import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import $TextSplitterService from "../../TextSplitterService";
import $Cursors from "../Cursors";
import $IsFoundIn from "./isFoundIn";
import { checkRelated, iterateOn } from "./theBasics";

import type { Cursor } from "../Cursors";
import type { IFragmentAssembly } from "../Fragment";

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const cursors = $Cursors(require);

  /**
   * Converts an fragment cursor into a full-text cursor.
   * 
   * The cursor must be addressing a fragment that exists within this assembly.
   */
  const toFullText = (
    assembly: IFragmentAssembly,
    cursor: Cursor.Fragment
  ): Cursor.FullText => {
    assert(
      "Expected an fragment cursor.",
      cursor.type === "fragment"
    );
    assert(
      "Expected cursor to be related to the given assembly.",
      checkRelated(assembly, cursor.origin)
    );
    assert(
      "Expected cursor to belong to a fragment of the given assembly.",
      $IsFoundIn(require).isFoundIn(assembly, cursor)
    );

    let fullLength = 0;
    for (const frag of iterateOn(assembly)) {
      if (cursors.isCursorInside(cursor, frag)) {
        fullLength += cursor.offset - ss.beforeFragment(frag);
        break;
      }
      fullLength += frag.content.length;
    }

    return cursors.fullText(assembly, fullLength);
  };

  return Object.assign(exports, {
    toFullText
  });
});