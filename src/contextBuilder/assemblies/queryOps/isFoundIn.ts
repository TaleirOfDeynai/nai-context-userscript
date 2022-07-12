import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import $Cursors from "../Cursors";
import { checkRelated, iterateOn } from "./theBasics";

import type { Cursor } from "../Cursors";
import type { IFragmentAssembly } from "../Fragment";

export default usModule((require, exports) => {
  const cursors = $Cursors(require);

  /**
   * Checks to ensure that the cursor references a valid text fragment;
   * that is, the fragment of this cursor is not missing.
   * 
   * When `cursor` originated from another {@link IFragmentAssembly} that was
   * created from the same source text, this can be used to validate that
   * the fragment the cursor is trying to target is still in this instance's
   * `content` array.
   */
  const isFoundIn = (
    assembly: IFragmentAssembly,
    cursor: Cursor.Fragment
  ): boolean => {
    assert(
      "Expected an fragment cursor.",
      cursor.type === "fragment"
    );
    assert(
      "Expected cursor to be related to the given assembly.",
      checkRelated(assembly, cursor.origin)
    );

    for (const frag of iterateOn(assembly))
      if (cursors.isCursorInside(cursor, frag))
        return true;

    return false;
  };

  return Object.assign(exports, {
    isFoundIn
  });
});