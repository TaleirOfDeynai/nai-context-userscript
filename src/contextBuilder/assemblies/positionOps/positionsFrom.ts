import { usModule } from "@utils/usModule";
import { chain, batch, flatMap, mapIter, skip } from "@utils/iterables";
import $TextSplitterService from "../../TextSplitterService";
import $Cursors from "../Cursors";

import type { Cursor } from "../Cursors";
import type { IFragmentAssembly } from "../Fragment";
import type { TextFragment } from "../../TextSplitterService";
import type { IterDirection } from "./cursorForDir";

const lineBatcher = (c: TextFragment, p: TextFragment) =>
  c.content === p.content && c.content === "\n";

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const c = $Cursors(require);

  /**
   * Takes the given `fragments` from some `assembly` and converts them
   * into positions valid for `direction`.
   */
  const positionsFrom = (
    /** The assembly from which `fragments` originated. */
    assembly: IFragmentAssembly,
    /** The fragments being iterated. */
    fragments: Iterable<TextFragment>,
    /** Which direction `fragments` is iterating. */
    direction: IterDirection
  ): Iterable<Cursor.Fragment> => {
    // The side of the fragment we want to position the cursor differs
    // based on iteration direction.
    const toFragOffset = direction === "toTop" ? ss.beforeFragment : ss.afterFragment;
    // Prepare the function to get the multi-newline offset, which
    // is the inverse of `toFragOffset`.
    const toLineOffset = direction === "toTop" ? ss.afterFragment : ss.beforeFragment;

    // There's really only three positions we care about for this process.
    // - The position before a fragment containing words.
    // - The position after a fragment containing words.
    // - The zero-length position between two `\n` characters.
    return chain(fragments)
      // Group consecutive `\n` characters together.
      .thru((iter) => batch(iter, lineBatcher))
      .thru((iter) => flatMap(iter, (frags) => {
        // If we don't have multiple fragments in the batch, nothing
        // special needs to be done.
        if (frags.length === 1) return frags;
        // Let's give that zero-length position form.  Basically, we're
        // putting an empty fragment between each `\n` and then removing
        // the `\n` fragments, but cleverly.
        return mapIter(
          skip(frags, 1),
          (f) => ss.createFragment("", toLineOffset(f))
        );
      }))
      // And now preserve the empty fragments and those with words.
      .filter((f) => f.content.length === 0 || ss.hasWords(f))
      // Then convert them into cursors...
      .map((f) => c.fragment(assembly, toFragOffset(f)))
      .value();
  };

  return Object.assign(exports, {
    positionsFrom
  });
});