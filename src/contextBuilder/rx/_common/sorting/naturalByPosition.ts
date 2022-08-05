import { usModule } from "@utils/usModule";
import $Selection from "../selection";

import type { IContextField } from "@nai/ContextModule";
import type { InsertableSource } from "../selection";
import type { EntrySorter } from "./index";

export default usModule((require, exports) => {
  const { isBudgetedSource } = $Selection(require);

  /**
   * Sorts sources by their position in the lorebook.
   * 
   * Intended to be positioned after `naturalByType`.
   * 
   * NovelAI has a natural, deterministic order to entries that is likely
   * lost due to all the asynchronous activity.  This helps to restore it.
   */
  const naturalByPosition: EntrySorter = ({ storyContent }) => {
    // This assumes that `naturalByType` has run, so multiple entries
    // with the same index won't matter, because only same types should
    // be being compared...
    const byPos = new Map<IContextField, number>([
      ...storyContent.lorebook.entries.map((entry, i) => [entry, i] as const),
      ...storyContent.ephemeralContext.map((entry, i) => [entry, i] as const)
    ]);

    // Default to after everything else, basically.
    const defaultOrder = Math.max(0, ...byPos.values()) + 1;

    const getPos = (source: InsertableSource) => {
      if (!isBudgetedSource(source)) return defaultOrder;
      return byPos.get(source.entry.field) ?? defaultOrder;
    };

    return (a, b) => getPos(a) - getPos(b);
  };

  return Object.assign(exports, { naturalByPosition });
});