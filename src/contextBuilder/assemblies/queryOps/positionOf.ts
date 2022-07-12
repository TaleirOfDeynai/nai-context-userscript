import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import { isEmpty } from "@utils/iterables";
import $Cursors from "../Cursors";
import $TheStats from "./theStats";
import { getSource, checkRelated } from "./theBasics";

import type { Cursor } from "../Cursors";
import type { IFragmentAssembly } from "../Fragment";

export type CursorPosition = "prefix" | "content" | "suffix" | "unrelated";

export default usModule((require, exports) => {
  const { getContentStats } = $TheStats(require);
  const cursors = $Cursors(require);

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
    if (!checkRelated(assembly, cursor.origin)) return "unrelated";

    // We'll use the source's prefix/suffix to keep this consistent between
    // derived assemblies and their source.
    if (cursors.isCursorInside(cursor, getSource(assembly).prefix)) {
      if (isEmpty(assembly.content)) return "prefix";
      if (cursor.offset !== getContentStats(assembly).minOffset) return "prefix";
    }
    else if (cursors.isCursorInside(cursor, getSource(assembly).suffix)) {
      if (isEmpty(assembly.content)) return "suffix";
      if (cursor.offset !== getContentStats(assembly).maxOffset) return "suffix";
    }

    // Acts as the fallback value as well.
    return "content";
  }

  return Object.assign(exports, {
    positionOf
  });
});