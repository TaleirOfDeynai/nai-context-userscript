import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { assertExists } from "@utils/assert";
import { clamp } from "@utils/numbers";
import $QueryOps from "../../../assemblies/queryOps";
import $CursorOps from "../../../assemblies/cursorOps";
import $Cursors from "../../../cursors";
import $ContextContent from "../../../ContextContent";
import $SearchService from "../../../SearchService";
import $Activation from "../activation";
import { nil, scalar } from "./_helpers";

import type { LoreEntryConfig } from "@nai/Lorebook";
import type { ExtendField, ContextSource } from "../../../ContextSource";
import type { SomeContextSource } from "../index";
import type { EntryWeigher } from "./index";
import { IFragmentAssembly } from "@src/contextBuilder/assemblies/_interfaces";

type RangedSource = ExtendField<ContextSource, {
  searchRange: LoreEntryConfig["searchRange"]
}>;

/** The maximum penalty for this weighting function. */
const PENALTY = 0.1;

export default usModule((require, exports) => {
  const queryOps = $QueryOps(require);
  const cursorOps = $CursorOps(require);
  const cursors = $Cursors(require);
  const { ContextContent } = $ContextContent(require);
  const { findHighestIndex } = $SearchService(require);
  const { isActivated } = $Activation(require);

  const hasSearchRange = (source: SomeContextSource): source is RangedSource => {
    if (!source.entry.fieldConfig) return false;
    return "searchRange" in source.entry.fieldConfig;
  };

  /** Remaps a full-text offset to a fragment offset. */
  const remapOffset = (searchedText: IFragmentAssembly, ftOffset: number) => {
    const text = queryOps.getText(searchedText);
    ftOffset = clamp(ftOffset, 0, text.length);

    const ftCursor = cursors.fullText(searchedText, ftOffset);
    return cursorOps.fromFullText(searchedText, ftCursor).offset;
  };

  /**
   * Weight function that penalizes sources that are outside their
   * configured search range.  A scaling penalty is applied the farther
   * the source is from the search range, reaching the minimum multiplier
   * at twice the search range.
   * 
   * @see PENALTY for the maximum penalty.
   */
  const searchRange: EntryWeigher = (_params, allSources) => {
    const searchedText = dew(() => {
      const theStory = allSources.find((source) => source.type === "story");
      if (!theStory) return undefined;
      if (!(theStory.entry instanceof ContextContent)) return undefined;
      return theStory.entry.searchedText;
    });

    const ftLength = !searchedText ? 0 : queryOps.getText(searchedText).length;

    return (source) => {
      // Can't score when the story is empty or missing.
      if (!searchedText || ftLength === 0) return nil;
      // Can't score without a search range.
      if (!hasSearchRange(source)) return nil;
      // Can't score if the entry has no activation data.
      if (!isActivated(source)) return nil;

      // We only score it if the source has a story activation.
      const keyed = source.activations.get("keyed");
      if (!keyed) return nil;

      const { searchRange } = source.entry.fieldConfig;
      const ftOffset = ftLength - searchRange;
      // It can only be inside the search range.
      if (ftOffset <= 0) return nil;

      // Perform the cursor re-mapping to get the penalty range.
      const maxRange = remapOffset(searchedText, ftOffset);
      const minRange = remapOffset(searchedText, ftOffset - searchRange);

      // If we activated by a keyword, we definitely have a result.
      const result = assertExists(
        "Expected to have at least one match result.",
        findHighestIndex(keyed)
      );

      const best = result[1].selection[1].offset;
      if (best >= maxRange) return nil;
      if (best <= minRange) return scalar(PENALTY);

      return scalar(best, {
        input: { min: minRange, max: maxRange },
        output: { min: PENALTY, max: 1 },
        clamp: true
      });
    };
  };

  return Object.assign(exports, { searchRange });
});