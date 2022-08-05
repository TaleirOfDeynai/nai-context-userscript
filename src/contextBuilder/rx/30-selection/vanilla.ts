/**
 * A selector with no bells-and-whistles.
 * - It drops any entries that activated by keyword against the story,
 *   but that keyword was outside of the configured search range.
 *   With vanilla rules, this entry never would have activated, so
 *   that is resolved here.
 * - It sorts the final output into its insertion order.  For the
 *   purposes of experimentation, this sorting order is configurable.
 * 
 * Configuration that affects this module:
 * - Disabled by `weightedRandom.enabled`.
 * - Output ordering affected by `selection.insertionOrdering`.
 */

import usConfig from "@config";
import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import { chain } from "@utils/iterables";
import $QueryOps from "../../assemblies/queryOps";
import $CursorOps from "../../assemblies/cursorOps";
import $Cursors from "../../cursors";
import $Common from "../_common";
import Sorters from "./_sorters";

import type { LoreEntryConfig } from "@nai/Lorebook";
import type { ContextParams } from "../../ParamsService";
import type { ContextSource, ExtendField } from "../../ContextSource";
import type { ActivatedSource } from "../_common/activation";
import type { BudgetedSource } from "../_common/selection";
import type { StorySource } from "../10-source";
import type { SorterKey } from "./_sorters";

type RangedSource = ExtendField<ActivatedSource, {
  searchRange: LoreEntryConfig["searchRange"]
}>;

export default usModule((require, exports) => {
  const queryOps = $QueryOps(require);
  const cursorOps = $CursorOps(require);
  const cursors = $Cursors(require);
  const { selection } = $Common(require);

  /**
   * Sorts all inputs and emits them in order of their formalized insertion
   * priority.  This will also calculate each emitted element's budget stats.
   */
  const createStream = (
    contextParams: ContextParams,
    storySource: rx.Observable<StorySource>
  ) => {
    /** Sorting functions we're going to use. */
    const chosenSorters = chain(usConfig.selection.insertionOrdering)
      // Force the natural sorters to be the last ones.
      .filter((k) => k !== "naturalByPosition" && k !== "naturalByType")
      .appendVal<SorterKey>("naturalByType", "naturalByPosition")
      // Check to make sure there's a sorter for each key.
      .tap((k) => assert(`Unknown sorter "${k}" for \`selection.ordering\` config!`, k in Sorters))
      .map((k) => Sorters[k](contextParams, require))
      .toArray();

    const sortingFn = (a: BudgetedSource, b: BudgetedSource) => {
      for (let i = 0, len = chosenSorters.length; i < len; i++) {
        const result = chosenSorters[i](a, b);
        if (result !== 0) return result;
      }
      return 0;
    };

    const hasSearchRange = (source: ContextSource): source is RangedSource =>
      "searchRange" in source.entry.fieldConfig;

    return (sources: rx.Observable<ActivatedSource>) => storySource.pipe(
      rxop.mergeMap((s) => {
        // The search range is in characters of the story that were searchable.
        // We'll want to start relative to the full-text of the story and
        // then convert back to a fragment cursor.
        const { searchedText } = s.entry;
        const ftLength = queryOps.getText(searchedText).length;

        return sources.pipe(
          // Activation does not take search range into account.  We'll do
          // that here.
          rxop.collect((source) => {
            // If it has no search range, we can't check this and select the
            // source by default.
            if (!hasSearchRange(source)) return source;

            // NovelAI does apply search range to the cascade, but this
            // user-script is opting not to bother.  Reasoning is, the cascade
            // is defining relationships between two static entries.  The
            // location of the matched keyword is not really relevant.

            // Search range only seems useful as yet another obtuse way to
            // control entry priority, by giving the user the ability to author
            // entries that can activate against more or less text; allotting
            // more text to match against increases the chances of activation.

            // Therefore, this is only relevant to the dynamic story text.
            // We'll check this if a story keyword match was the only method
            // of activation.
            const keyed = source.activations.get("keyed");
            if (!keyed || source.activations.size > 1) return source;
  
            const { searchRange } = source.entry.fieldConfig;
            const ftOffset = ftLength - searchRange;
            // It can only be inside the search range.
            if (ftOffset <= 0) return source;

            // Perform the cursor re-mapping to get the minimum offset allowed.
            const ftCursor = cursors.fullText(searchedText, ftOffset);
            const { offset: minRange } = cursorOps.fromFullText(searchedText, ftCursor);

            const selections = chain(keyed.values())
              .flatten()
              .map((r) => r.selection)
              .value();
  
            // At least one selection must have both its cursors in range.
            for (const [l, r] of selections) {
              if (l.offset < minRange) continue;
              if (r.offset < minRange) continue;
              return source;
            }
            
            return undefined;
          })
        )
      }),
      rxop.mergeMap(selection.asBudgeted),
      rxop.toArray(),
      rxop.mergeMap((arr) => arr.sort(sortingFn))
    );
  };

  return Object.assign(exports, { createStream });
});