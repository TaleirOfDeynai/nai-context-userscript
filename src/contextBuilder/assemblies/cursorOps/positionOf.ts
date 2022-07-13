import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import { isEmpty } from "@utils/iterables";
import $Cursors from "../../cursors";
import $QueryOps from "../queryOps";

import type { Cursor } from "../../cursors";
import type { IFragmentAssembly } from "../Fragment";

export type CursorPosition = "prefix" | "content" | "suffix" | "unrelated";

export default usModule((require, exports) => {
  const cursors = $Cursors(require);
  const queryOps = $QueryOps(require);

  /**
   * Determines what block the given `cursor` belongs to.  It makes the
   * following checks in this order:
   * - If the cursor has a source that differs from this assembly, it will
   *   return `"unrelated"` to indicate the cursor is unsuitable for this
   *   assembly.
   * - If the cursor is outside of the prefix and suffix, it returns `"content"`.
   * - If the cursor is adjacent to any content fragment, it returns `"content"`.
   * - If the cursor is inside the prefix, it returns `"prefix"`.
   * - If the cursor is inside the suffix, it returns `"suffix"`.
   * - Otherwise, it returns `"content"`, assuming the content fragment
   *   it belongs to is simply missing.
   * 
   * It does not check to see if a fragment exists in this assembly that
   * corresponds to the cursor's position.  Use {@link isFoundIn} to make that
   * determination.
   */
  const positionOf = (
    assembly: IFragmentAssembly,
    cursor: Cursor.Fragment
  ): CursorPosition => {
    assert(
      "Expected an fragment cursor.",
      cursor.type === "fragment"
    );

    // Can't be in this assembly if it is unrelated.
    if (!queryOps.checkRelated(assembly, cursor.origin)) return "unrelated";

    const source = queryOps.getSource(assembly);

    // We'll use the source's prefix/suffix to keep this consistent between
    // derived assemblies and their source.
    if (cursors.isCursorInside(cursor, source.prefix)) {
      if (isEmpty(assembly.content)) return "prefix";
      if (cursor.offset !== queryOps.getContentStats(assembly).minOffset) return "prefix";
    }
    else if (cursors.isCursorInside(cursor, source.suffix)) {
      if (isEmpty(assembly.content)) return "suffix";
      if (cursor.offset !== queryOps.getContentStats(assembly).maxOffset) return "suffix";
    }

    // Acts as the fallback value as well.
    return "content";
  }

  return Object.assign(exports, {
    positionOf
  });
});