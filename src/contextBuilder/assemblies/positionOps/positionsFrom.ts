import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { chain, batch, flatMap, mapIter, skip } from "@utils/iterables";
import makeCursor from "../../cursors/Fragment";
import $TextSplitterService from "../../TextSplitterService";
import $SplitUpFrom from "./splitUpFrom";

import type { UndefOr } from "@utils/utility-types";
import type { Cursor } from "../../cursors";
import type { IFragmentAssembly } from "../_interfaces";
import type { TextFragment } from "../../TextSplitterService";
import type { TrimType } from "../../TrimmingProviders";
import type { IterDirection } from "./cursorForDir";

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
  handleNewlines: (iter: Iterable<TextFragment[]>) => Iterable<TextFragment>;
  /**
   * Partial function constructing a cursor for {@link positionsFrom}.
   * 
   * This will:
   * - Preserves fragments that are empty or have wordy content.
   * - Removes fragments that would produce an invalid position.
   * - Convert the fragment to a cursor.
   */
  toPosition: (a: IFragmentAssembly, c: Cursor.Fragment) =>
    (f: TextFragment) => UndefOr<Cursor.Fragment>;
}

const lineBatcher = (c: TextFragment, p: TextFragment) =>
  c.content === p.content && c.content === "\n";

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const { splitUpFrom } = $SplitUpFrom(require);

  /**
   * Yields batches of normal fragments, but for batches of `\n` fragments,
   * it will insert a zero-length fragment between each of them then remove
   * the `\n` fragments.
   */
  const makeHandler = (toLineOffset: (f: TextFragment) => number) => {
    const emptyFrom = (f: TextFragment) => ss.createFragment("", toLineOffset(f));

    return (iter: Iterable<TextFragment[]>) => flatMap(iter, (frags) => {
      // Batches with a length greater than `1` will contain only `\n`
      // fragments.  For anything else, nothing special needs to be done.
      if (frags.length === 1) return frags;
      // Doing what was said above, but cleverly.
      return mapIter(skip(frags, 1), emptyFrom);
    });
  };

  const forDir: Record<IterDirection, ForDir> = {
    toTop: {
      /** Direction of iteration ← \n|\n|~\n~ */
      handleNewlines: makeHandler(ss.afterFragment),
      toPosition: (a, c) => (f) => {
        if (f.content.length !== 0 && !ss.hasWords(f)) return undefined;
        const offset = ss.beforeFragment(f);
        if (offset > c.offset) return undefined;
        return makeCursor(a, offset);
      }
    },
    toBottom: {
      /** Direction of iteration → ~\n~|\n|\n */
      handleNewlines: makeHandler(ss.beforeFragment),
      toPosition: (a, c) => (f) => {
        if (f.content.length !== 0 && !ss.hasWords(f)) return undefined;
        const offset = ss.beforeFragment(f);
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
    const fragments = splitUpFrom(assembly, cursor, splitType, direction);

    // Prepare the functions used by this option.
    const fns = forDir[direction];
    const handleNewlines = fns.handleNewlines;
    const toCursor = fns.toPosition(assembly, cursor);

    // There's really only three positions we care about for this process.
    // - The position before a fragment containing words.
    // - The zero-length position between two `\n` characters.
    // The position defined by the given cursor is handled by `locateInsertion`.
    return chain(fragments)
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