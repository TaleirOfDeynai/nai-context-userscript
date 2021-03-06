import { usModule } from "@utils/usModule";
import { skipUntil, flatMap } from "@utils/iterables";
import $TrimmingProviders from "../../TrimmingProviders";
import $Cursors from "../../cursors";
import $QueryOps from "../queryOps";

import type { Cursor } from "../../cursors";
import type { IFragmentAssembly } from "../_interfaces";
import type { TextFragment } from "../../TextSplitterService";
import type { TrimType, TextSequencer } from "../../TrimmingProviders";
import type { IterDirection } from "./cursorForDir";

export default usModule((require, exports) => {
  const providers = $TrimmingProviders(require);
  const cursors = $Cursors(require);
  const queryOps = $QueryOps(require);

  /**
   * Get the fragments of an assembly starting from the fragment identified
   * by a `cursor` toward either the top or bottom of the text.
   * 
   * Helper function for {@link splitUpFrom}.
   */
   const fragsStartingFrom = (
    /** The assembly to query. */
    assembly: IFragmentAssembly,
    /** The cursor that will identify the starting fragment. */
    cursor: Cursor.Fragment,
    /** Which direction to iterate. */
    direction: IterDirection
  ): Iterable<TextFragment> => {
    const theFrags = queryOps.iterateOn(assembly, direction === "toTop");
    return skipUntil(theFrags, (f) => cursors.isCursorInside(cursor, f));
  };

  /**
   * Split up the input fragments and yields the result fragments starting
   * from the fragment identified by a `cursor`.
   * 
   * Helper function for {@link splitUpFrom}.
   */
  const sequenceFragments = (
    /** The cursor that will identify the starting fragment. */
    cursor: Cursor.Fragment,
    /** The input fragments to process. */
    inFrags: Iterable<TextFragment>,
    /** The sequencers left to run. */
    sequencers: TextSequencer[]
  ): Iterable<TextFragment> => {
    // Skip fragments while we have not found the cursor that
    // indicates the start of iteration.  This needs to be done
    // regardless of if we're doing further splitting.
    const theFrags = skipUntil(inFrags, (f) => cursors.isCursorInside(cursor, f));
    if (!sequencers.length) return theFrags;

    const [sequencer, ...restSeq] = sequencers;
    // Split them up.
    const splitFrags = flatMap(theFrags, sequencer.splitUp);
    // Recurse to split them up further until we're out of sequencers.
    return sequenceFragments(cursor, splitFrags, restSeq);
  };

  /**
   * Splits up the fragments of an assembly starting from the position
   * identified by a `cursor`, toward the given `direction`.
   */
  const splitUpFrom = (
    /** The assembly to query. */
    assembly: IFragmentAssembly,
    /** The cursor that will identify the starting fragment. */
    cursor: Cursor.Fragment,
    /** The type of splitting to perform. */
    splitType: TrimType,
    /** Which direction to iterate. */
    direction: IterDirection
  ): Iterable<TextFragment> => {
    const provider = direction === "toTop" ? "trimTop" : "trimBottom";
    return sequenceFragments(
      cursor,
      fragsStartingFrom(assembly, cursor, direction),
      providers.getSequencersFrom(provider, splitType)
    );
  };

  return Object.assign(exports, {
    fragsStartingFrom,
    sequenceFragments,
    splitUpFrom
  });
});