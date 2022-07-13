import { usModule } from "@utils/usModule";
import $Cursors from "../../cursors";
import $TextSplitterService from "../../TextSplitterService";

import type { TextFragment } from "../../TextSplitterService";
import type { Cursor } from "../../cursors";

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const cursors = $Cursors(require);

  /**
   * Given a cursor and a sequence of text fragments, splits the sequence
   * into two sequences.  The result is a tuple where the first element
   * is the text before the cut and the second element is the text after
   * the cut.
   * 
   * It is assumed that `cursor` belongs to some fragment of `content`.
   */
  const splitAt = (
    content: readonly TextFragment[],
    cursor: Cursor.Fragment
  ): [TextFragment[], TextFragment[]] => {
    const beforeCut: TextFragment[] = [];
    const afterCut: TextFragment[] = [];
    let curBucket = beforeCut;
    for (const frag of content) {
      // Do we need to swap buckets?
      checkForSwap: {
        if (curBucket === afterCut) break checkForSwap;
        if (!cursors.isCursorInside(cursor, frag)) break checkForSwap;

        const cursorOffset = cursor.offset;

        // This is the fragment of the cut.  Let's figure out how to split
        // the fragment.  We only need to bother if the point is inside the
        // fragment, that is, not at one of its ends.  We're going to the
        // trouble because text fragments are immutable and it'd be nice to
        // preserve referential equality where possible.
        switch (cursorOffset) {
          case ss.beforeFragment(frag):
            afterCut.push(frag);
            break;
          case ss.afterFragment(frag):
            beforeCut.push(frag);
            break;
          default: {
            const [before, after] = ss.splitFragmentAt(frag, cursorOffset);
            beforeCut.push(before);
            afterCut.push(after);
            break;
          }
        }
        // Finally, swap the buckets so we place the remaining fragments in
        // the correct derivative assembly.
        curBucket = afterCut;
        continue;
      }

      // If we left the `checkForSwap` block, just add it to the current bucket.
      curBucket.push(frag);
    }

    return [beforeCut, afterCut];
  };
 
  return Object.assign(exports, {
    splitAt
  });
});