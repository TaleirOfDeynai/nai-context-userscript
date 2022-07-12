import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { assert, assertInBounds } from "@utils/assert";
import { toImmutable, first } from "@utils/iterables";
import $TextSplitterService from "../../TextSplitterService";
import $Cursors from "../Cursors";
import $IsContiguous from "./isContiguous";
import isAffixed from "./isAffixed";

import type { UndefOr } from "@utils/utility-types";
import type { TextFragment } from "../../TextSplitterService";
import type { Cursor } from "../Cursors";
import type { IFragmentAssembly } from "../Fragment";

export default usModule((require, exports) => {
  const splitterService = $TextSplitterService(require);
  const cursors = $Cursors(require);
  const { hasWords } = splitterService;
  const { beforeFragment, afterFragment } = splitterService;
  const { isContiguous } = $IsContiguous(require);

  /**
   * Given a cursor that is addressing this instance's `text`,
   * re-maps that cursor into one addressing the `prefix`, `content`,
   * or `suffix` of the assembly instead.
   * 
   * When the cursor falls between two fragments, creating an ambiguity
   * in which offset to use, it will use the first rule below that matches
   * the cursor's situation:
   * - Between prefix and suffix fragments:
   *   - When prefix is non-empty, use the end of the prefix fragment.
   *   - When suffix is non-empty, use the start of the suffix fragment.
   *   - When derived, use the end of the **source's** prefix fragment.
   *   - Otherwise, use offset 0 as a fail-safe.
   * - Between prefix and any content fragment, use the content fragment.
   * - Between suffix and any content fragment, use the content fragment.
   * - Between a wordy fragment and a non-wordy fragment, use the wordy fragment.
   * - Otherwise, whichever fragment comes first in natural order.
   */
  const fromFullText = (
    assembly: IFragmentAssembly,
    cursor: Cursor.FullText
  ): Cursor.Fragment => {
    assert(
      "Expected a full-text cursor.",
      cursor.type === "fullText"
    );
    assert(
      "Expected cursor to be for the given assembly.",
      cursor.origin === assembly
    );
    assertInBounds(
      "Expected cursor offset to be in bounds of `assembly.text`.",
      cursor.offset,
      assembly.text
    );

    const { prefix, suffix } = assembly;
    const content = toImmutable(assembly.content);
    const prefixLength = prefix.content.length;

    const initOffset = dew(() => {
      // If we have an initial fragment, getting an initial offset
      // is very straight-forward.
      const firstFrag = first(content);
      if (firstFrag) return beforeFragment(firstFrag);

      // However, if this assembly has no content, we will still want
      // to produce a stable answer of some sort.  Using the offset
      // after the prefix is a good idea, but since the `prefix` can
      // change due to `splitAt`, we should use the source assembly's
      // prefix instead, since all derived assemblies should have the
      // same value here.
      return afterFragment(assembly.source.prefix);
    });

    // Fast-path: We can just map straight to `content`.
    if (!isAffixed(assembly) && isContiguous(assembly))
      return cursors.fragment(assembly, cursor.offset + initOffset);
    
    // When the cursor is within the prefix.
    if (cursor.offset < prefixLength)
      return cursors.fragment(assembly, cursor.offset);

    const suffixThreshold = prefixLength + assembly.contentStats.concatLength;

    // When the cursor is within the suffix.
    if (cursor.offset > suffixThreshold)
      return cursors.fragment(assembly, (cursor.offset - suffixThreshold) + suffix.offset);

    // Exceptional circumstances; this function is setup to favor the
    // content, but if content is empty and the cursor is between the
    // prefix and suffix (the only possibility left, assuming this cursor
    // actually is for this instance's `text`), we must favor one of
    // those instead.
    if (content.length === 0) {
      if (prefixLength) return cursors.fragment(assembly, prefixLength);
      if (suffix.content) return cursors.fragment(assembly, suffix.offset);
    }
    else {
      // Remove the prefix from the full-text cursor so we're inside
      // the content block.
      let cursorOffset = cursor.offset - prefixLength;

      // Fast-path: For contiguous content, we can map the cursor directly
      // to the content, now that the prefix was accounted for.
      if (isContiguous(assembly)) return cursors.fragment(assembly, cursorOffset + initOffset);
      
      // Otherwise, we have to iterate to account for the gaps in content.
      // When there is ambiguity between a fragment with words and a
      // fragment without words, we will favor the one with words.
      let lastFrag: UndefOr<TextFragment> = undefined;
      for (const curFrag of content) {
        const fragLength = curFrag.content.length;

        // Here, we're dealing with an ambiguity; the last fragment was
        // non-wordy, so we pulled one more fragment in hopes it was wordy.
        if (lastFrag && cursorOffset === 0) {
          // If the current fragment is also non-wordy, break the loop
          // to use the end of the last fragment.
          if (!hasWords(curFrag.content)) break;
          // Otherwise, use the start of this fragment.
          return cursors.fragment(assembly, beforeFragment(curFrag));
        }

        // Remove this fragment from the full-text offset.  This will go
        // negative if the offset is inside this fragment.
        cursorOffset -= fragLength;

        checks: {
          // If it's non-zero and positive, we're not in this fragment.
          if (cursorOffset > 0) break checks;
          // We're at the very end of this fragment, but because this
          // fragment has no wordy content, we want to check the next
          // fragment to see if it is a better candidate to favor.
          if (cursorOffset === 0 && !hasWords(curFrag.content)) break checks;
          // Otherwise, this is our fragment.  Because we preemptively
          // subtracted `cursorOffset` to make the checks of the loop
          // simpler, we have to add it back to the length to get the
          // correct offset.
          return cursors.fragment(assembly, curFrag.offset + fragLength + cursorOffset);
        }

        // Update the last fragment.
        lastFrag = curFrag;
      }

      // It is possible we still have no last fragment; remember that
      // we were skipping empty fragments.  But if we have one, assume
      // we are meant to use the end of that fragment, since we were
      // likely attempting the non-wordy disambiguation and ran out
      // of fragments.
      if (lastFrag) return cursors.fragment(assembly, afterFragment(lastFrag));
    }

    // If we get here, this is the "completely empty assembly" fail-safe;
    // just use the initial offset we determined.
    return cursors.fragment(assembly, initOffset);
  }

  return Object.assign(exports, {
    fromFullText
  });
});