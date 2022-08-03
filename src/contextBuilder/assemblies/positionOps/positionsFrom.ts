import { usModule } from "@utils/usModule";
import { chain, batch, flatMap, mapIter, skip } from "@utils/iterables";
import makeCursor from "../../cursors/Fragment";
import $TextSplitterService from "../../TextSplitterService";
import $SplitToSelections from "./splitToSelections";

import type { UndefOr } from "@utils/utility-types";
import type { Cursor } from "../../cursors";
import type { IFragmentAssembly } from "../_interfaces";
import type { TrimType } from "../../TrimmingProviders";
import type { IterDirection } from "./cursorForDir";
import type { SplitSelection } from "./splitToSelections";

interface ForDir {
  /**
   * When dealing with the batches of `\n` fragments, we need to select
   * the offset that is consistent with the direction of iteration.
   * 
   * Since we drop the first fragment and we're iterating in reverse when
   * going `toTop` we have to change which side of the fragment we use as
   * the offset.
   * 
   * Where `|` indicates the offset we actually want:
   * - `toTop`: Direction of iteration ← \n|\n|~\n~
   * - `toBottom`: Direction of iteration → ~\n~|\n|\n
   */
  handleNewlines: (iter: Iterable<SplitSelection[]>) => Iterable<SplitSelection>;
  /**
   * Partial function constructing a cursor for {@link positionsFrom}.
   * 
   * This will:
   * - Preserves fragments that are empty or have wordy content.
   * - Removes fragments that would produce an invalid position.
   * - Convert the fragment to a cursor.
   */
  toPosition: (a: IFragmentAssembly, c: Cursor.Fragment) =>
    (f: SplitSelection) => UndefOr<Cursor.Fragment>;
}

const lineBatcher = (c: SplitSelection, p: SplitSelection) =>
  c.content === p.content && c.content === "\n";

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const { splitToSelections } = $SplitToSelections(require);

  /**
   * Yields batches of normal fragments, but for batches of `\n` fragments,
   * it will insert a zero-length fragment between each of them then remove
   * the `\n` fragments.
   */
  const makeHandler = (toLineCursor: (f: SplitSelection) => Cursor.Fragment) => {
    const emptyFrom = (f: SplitSelection): SplitSelection => {
      const c = toLineCursor(f);
      return { content: "", selection: [c, c] };
    };

    return (iter: Iterable<SplitSelection[]>) => flatMap(iter, (splitUp) => {
      // Batches with a length greater than `1` will contain only `\n`
      // fragments.  For anything else, nothing special needs to be done.
      if (splitUp.length === 1) return splitUp;
      // Doing what was said above, but cleverly.
      return mapIter(skip(splitUp, 1), emptyFrom);
    });
  };

  const forDir: Record<IterDirection, ForDir> = {
    toTop: {
      /** Direction of iteration ← \n|\n|~\n~ */
      handleNewlines: makeHandler(({ selection: s }) => s[1]),
      toPosition: (a, c) => (s) => {
        if (s.content.length !== 0 && !ss.hasWords(s.content)) return undefined;
        const { offset } = s.selection[0];
        if (offset > c.offset) return undefined;
        return makeCursor(a, offset);
      }
    },
    toBottom: {
      /** Direction of iteration → ~\n~|\n|\n */
      handleNewlines: makeHandler(({ selection: s }) => s[0]),
      toPosition: (a, c) => (s) => {
        if (s.content.length !== 0 && !ss.hasWords(s.content)) return undefined;
        const { offset } = s.selection[0];
        if (offset < c.offset) return undefined;
        return makeCursor(a, offset);
      }
    }
  };

  /**
   * Takes the given `assembly`, splits its full contents into fragments
   * based on the given `splitType`, then converts them into insertion
   * positions valid for `direction`.
   * 
   * The positions are yielded from the given `cursor` toward the given
   * `direction`.
   * 
   * Refer to the examples below to see the positions under a few different
   * circumstances.
   * 
   * From top to bottom:
   * > [0]One sentence.  [1]Two sentence.  [2]This is another sentence.
   *   [3]Three sentence.  [4]Four sentence.
   * 
   * From bottom to top:
   * > [-6]One sentence.  [-5]Two sentence.  [-4]This is another sentence.
   *   [-3]Three sentence.  [-2]Four sentence.[-1]
   * 
   * Relative to the match `"another"`:
   * > [-4]One sentence.  [-3]Two sentence.  [-2]This is [-1]another[0]
   *   sentence.  [1]Three sentence.  [2]Four sentence.
   */
  const positionsFrom = (
    /** The assembly to query. */
    assembly: IFragmentAssembly,
    /** The cursor that will identify the starting fragment. */
    cursor: Cursor.Fragment,
    /** The type of splitting to perform. */
    splitType: TrimType,
    /** Which direction `fragments` is iterating. */
    direction: IterDirection
  ): Iterable<Cursor.Fragment> => {
    // Do the work splitting everything up.
    const splitUp = splitToSelections(assembly, splitType, direction, cursor);

    // Prepare the functions used by this option.
    const fns = forDir[direction];
    const handleNewlines = fns.handleNewlines;
    const toCursor = fns.toPosition(assembly, cursor);

    // There's really only three positions we care about for this process.
    // - The position before a fragment containing words.
    // - The zero-length position between two `\n` characters.
    // The position defined by the given cursor is handled by `locateInsertion`.
    return chain(splitUp)
      // Group consecutive `\n` characters together.
      .thru((iter) => batch(iter, lineBatcher))
      // Sort out and handle the `\n` batches from the normal fragments...
      .thru(handleNewlines)
      // Now apply this partial function to get our cursors...
      .collect(toCursor)
      .value();
  };

  return Object.assign(exports, {
    positionsFrom
  });
});