import { usModule } from "@utils/usModule";
import { assertExists } from "@utils/assert";
import * as IterOps from "@utils/iterables";
import $TextSplitterService from "../../TextSplitterService";
import $Cursors from "../Cursors";
import $IsFoundIn from "./isFoundIn";
import $IsContiguous from "./isContiguous";
import $PositionOf from "./positionOf";

import type { UndefOr } from "@utils/utility-types";
import type { ReduceFn } from "@utils/iterables";
import type { TextFragment } from "../../TextSplitterService";
import type { Cursor } from "../Cursors";
import type { IFragmentAssembly } from "../Fragment";

type OffsetResult = [offset: number, distance: number];

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const cursors = $Cursors(require);

  /**
   * Just a helper for {@link findBest}.
   * 
   * This can probably emit multiple identical tuples, but we're okay with that.
   */
  function *_iterBounds(
    frags: Iterable<TextFragment>,
    needle: number
  ): Iterable<OffsetResult> {
    for (const frag of frags) {
      const left = ss.beforeFragment(frag);
      yield [left, Math.abs(needle - left)];

      // If this fragment is empty, we can only get one offset from it.
      if (!frag.content) continue;

      const right = ss.afterFragment(frag);
      yield [right, Math.abs(needle - right)];
    }
  }

  /** A reducer function for {@link findBest}. */
  const _offsetReducer: ReduceFn<OffsetResult, OffsetResult, undefined> = (p, c) => {
    if (!p) return c;
    if (c[1] <= p[1]) return c;
    return p;
  };

  /**
   * Checks to ensure that the cursor references a valid text fragment;
   * that is, the fragment of this cursor is not missing.
   * 
   * If the fragment is missing, it will reposition the cursor to the
   * nearest existing fragment.
   * 
   * If the assembly is empty (all fragments have length-zero content),
   * it will reposition it to the nearest prefix or suffix offset.
   * 
   * When `cursor` originated from a related {@link FragmentAssembly}, this
   * can be used to adapt the cursor to a reasonable position that does
   * exist.
   */
  const findBest = (
    /** The assembly to query. */
    assembly: IFragmentAssembly,
    /** The cursor to potentially adjust. */
    cursor: Cursor.Fragment,
    /**
     * Whether to favor content fragments.  This does not guarantee that
     * the returned cursor will be inside the content, but it will do
     * its best.
     */
    preferContent: boolean = false
  ): Cursor.Fragment => {
    // This also does the various assertions, so no need to repeat those.
    if ($IsFoundIn(require).isFoundIn(assembly, cursor)) {
      if (!preferContent) return cursor;
      // If we're preferring content, make sure it is for content.
      const pos = $PositionOf(require).positionOf(assembly, cursor);
      if (pos === "content") return cursor;
    }

    // Seems to be missing.  Let's see about finding the next best offset.
    // That will be one end of some existing fragment with the minimum
    // distance from the cursor's offset and the fragment's end.

    // We can prefer searching within only the content.
    const fragments = preferContent ? assembly.content : assembly;
    const offsetsIterator = _iterBounds(fragments, cursor.offset);

    if ($IsContiguous(require).isContiguous(assembly)) {
      // Fast-path: for contiguous assemblies, we can stop as soon as the
      // distance stops getting smaller.
      let lastResult: UndefOr<OffsetResult> = undefined;
      for (const curResult of offsetsIterator) {
        const next = _offsetReducer(lastResult, curResult);
        // We hit the minimum if we get the `lastResult` back.
        if (next === lastResult) return cursors.fragment(assembly, next[0]);
        lastResult = next;
      }
      // If we get here, we ran through them all and never got the last
      // result back from `_offsetReducer`.  But, if we have `lastResult`,
      // we will assume the very last fragment was the nearest.
      if (lastResult) return cursors.fragment(assembly, lastResult[0]);
    }
    else {
      // For non-contiguous assemblies, we'll have to run through every
      // fragment to find the minimum difference.
      const result = IterOps.chain(offsetsIterator).reduce(undefined, _offsetReducer);
      if (result) return cursors.fragment(assembly, result[0]);
    }

    // If we get here, `fragments` was probably empty, which can happen
    // and is perfectly valid.  We can fall back to anchoring to the
    // boundaries of each significant block instead, defined completely by
    // the prefix and suffix.  This is one of the reasons why we're habitually
    // generating these, even if they're empty.
    const { prefix, suffix } = assembly.source;
    const [newOffset] = assertExists(
      "Expected to have boundaries from prefix and suffix.",
      IterOps.chain(_iterBounds([prefix, suffix], cursor.offset))
        .reduce(undefined, _offsetReducer)
    );
    return cursors.fragment(assembly, newOffset);
  }

  return Object.assign(exports, {
    findBest
  });
});