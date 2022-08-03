import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { skipUntil, flatMap } from "@utils/iterables";
import $TextSplitterService from "../../TextSplitterService";
import $TrimmingProviders from "../../TrimmingProviders";
import $Cursors from "../../cursors";
import $QueryOps from "../queryOps";
import $CursorOps from "../cursorOps";

import type { Cursor } from "../../cursors";
import type { IFragmentAssembly } from "../_interfaces";
import type { TextFragment } from "../../TextSplitterService";
import type { TrimType, TextSequencer } from "../../TrimmingProviders";
import type { IterDirection } from "./cursorForDir";

export interface SplitSelection {
  /** The content of this selection. */
  readonly content: string;
  /** The selection indicating the start and end of the text. */
  readonly selection: Cursor.Selection;
}

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const providers = $TrimmingProviders(require);
  const cursors = $Cursors(require);
  const queryOps = $QueryOps(require);
  const cursorOps = $CursorOps(require);

  /**
   * Split up the input fragments and yields the result fragments starting
   * from the fragment identified by a `offset`.
   * 
   * Helper function for {@link splitToSelections}.
   */
  const sequenceFragments = (
    /** The offset that will identify the starting fragment. */
    offset: number,
    /** The input fragments to process. */
    inFrags: Iterable<TextFragment>,
    /** The sequencers left to run. */
    sequencers: TextSequencer[]
  ): Iterable<TextFragment> => {
    // Skip fragments while we have not found the cursor that
    // indicates the start of iteration.  This needs to be done
    // regardless of if we're doing further splitting.
    const theFrags = skipUntil(inFrags, (f) => ss.isOffsetInside(offset, f));
    if (!sequencers.length) return theFrags;

    const [sequencer, ...restSeq] = sequencers;
    // Split them up.
    const splitFrags = flatMap(theFrags, sequencer.splitUp);
    // Recurse to split them up further until we're out of sequencers.
    return sequenceFragments(offset, splitFrags, restSeq);
  };

  /**
   * Uses the given {@link TrimType} to split the given assembly into
   * selections that represent the start and end of those split fragments.
   * 
   * This allows us to deal with oddities in the assembly, like gaps, while
   * splitting it like its fragments were all concatenated.
   */
  function* splitToSelections(
    /** The assembly to split. */
    assembly: IFragmentAssembly,
    /** The type of splitting to perform. */
    splitType: TrimType,
    /** Which direction to iterate. */
    direction: IterDirection,
    /** The cursor that will identify the starting fragment. */
    cursor?: Cursor.Fragment
  ): Iterable<SplitSelection> {
    const provider = direction === "toTop" ? "trimTop" : "trimBottom";
    const sequencers = providers.getSequencersFrom(provider, splitType);

    // We're going to switch into the full-text perspective, split that
    // into fragments, and then switch back to the fragment perspective.
    const fullText = ss.createFragment(queryOps.getText(assembly), 0);
    const ftCursor = dew(() => {
      if (cursor) {
        const bestCursor = cursorOps.findBest(assembly, cursor, false, false);
        return cursorOps.toFullText(assembly, bestCursor);
      }
      else {
        const offsetFn = direction === "toTop" ? ss.afterFragment : ss.beforeFragment;
        return cursors.fullText(assembly, offsetFn(fullText));
      }
    });

    // Split the full-text into fragments.
    const frags = sequenceFragments(ftCursor.offset, [fullText], sequencers);

    // Now, we map the start and end of each fragment into a selection.
    for (const frag of frags) {
      const start = cursors.fullText(assembly, ss.beforeFragment(frag));
      const end = cursors.fullText(assembly, ss.afterFragment(frag));
      const selection = Object.freeze([
        cursorOps.fromFullText(assembly, start),
        cursorOps.fromFullText(assembly, end)
      ] as const);

      yield Object.freeze({ content: frag.content, selection });
    }
  }

  return Object.assign(exports, {
    splitToSelections
  });
});