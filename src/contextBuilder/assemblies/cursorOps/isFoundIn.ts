import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import $Cursors from "../../cursors";
import $QueryOps from "../queryOps";

import type { Cursor } from "../../cursors";
import type { IFragmentAssembly } from "../_interfaces";

export default usModule((require, exports) => {
  const cursors = $Cursors(require);
  const queryOps = $QueryOps(require);

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
    /** The assembly to check. */
    assembly: IFragmentAssembly,
    /** The cursor to look for. */
    cursor: Cursor.Fragment,
    /** Whether to accept the cursor to targeting an empty prefix/suffix. */
    allowEmpty: boolean = false
  ): boolean => {
    assert(
      "Expected a fragment cursor.",
      cursor.type === "fragment"
    );
    assert(
      "Expected cursor to be related to the given assembly.",
      queryOps.checkRelated(assembly, cursor.origin)
    );

    // When allowing empty, we explicitly check the affix fragments.
    if (allowEmpty) {
      if (cursors.isCursorInside(cursor, assembly.prefix)) return true;
      if (cursors.isCursorInside(cursor, assembly.suffix)) return true;
    }

    // `iterateOn` will skip any empty affix fragments.  Since we'll have
    // already checked them when allowing empty fragments, we can just
    // iterate on the content fragments.
    const frags = allowEmpty ? assembly.content : queryOps.iterateOn(assembly);

    for (const frag of frags)
      if (cursors.isCursorInside(cursor, frag))
        return true;

    return false;
  };

  return Object.assign(exports, {
    isFoundIn
  });
});