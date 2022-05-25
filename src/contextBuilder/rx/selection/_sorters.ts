import $SearchService from "../../SearchService";

import type { IContextField } from "@nai/ContextModule";
import type { WrappedRequireFn } from "../../../require";
import type { ContextParams } from "../../ParamsService";
import type { SourceType } from "../../ContextSource";
import type { BudgetedSource } from "./_shared";

export type EntrySorter =
  (contextParams: ContextParams, require: WrappedRequireFn) =>
  (a: BudgetedSource, b: BudgetedSource) =>
  number;

const sorters = {
  /** Sorts sources by their budget priority, descending. */
  budgetPriority: () => (a: BudgetedSource, b: BudgetedSource) => {
    const { budgetPriority: ap } = a.entry.contextConfig;
    const { budgetPriority: bp } = b.entry.contextConfig;
    return bp - ap;
  },
  /** Sorts sources with token reservations first. */
  reservation: () => (a: BudgetedSource, b: BudgetedSource) => {
    const aReserved = a.budgetStats.actualReservedTokens > 0;
    const bReserved = b.budgetStats.actualReservedTokens > 0;
    if (aReserved === bReserved) return 0;
    if (aReserved) return -1;
    return 1;
  },
  /** Sorts sources that were ephemerally-activated first. */
  activationEphemeral: () => (a: BudgetedSource, b: BudgetedSource) => {
    const aEphemeral = a.activations.has("ephemeral");
    const bEphemeral = b.activations.has("ephemeral");
    if (aEphemeral === bEphemeral) return 0;
    if (aEphemeral) return -1;
    return 1;
  },
  /** Sorts sources that were force-activated first. */
  activationForced: () => (a: BudgetedSource, b: BudgetedSource) => {
    const aForced = a.activations.has("forced");
    const bForced = b.activations.has("forced");
    if (aForced === bForced) return 0;
    if (aForced) return -1;
    return 1;
  },
  /**
   * Sorts sources that activated by a keyword match in the story:
   * - Over those that did not.
   * - In the order of where the match was found, later in the story first.
   * 
   * This is a secret NovelAI feature and is controlled by
   * `orderByKeyLocations` in the lorebook config.
   */
  storyKeyOrder: ({ orderByKeyLocations }: ContextParams, require) => {
    if (!orderByKeyLocations) return () => 0;

    const { findHighestIndex } = $SearchService(require);

    return (a: BudgetedSource, b: BudgetedSource) => {
      // Keyed entries are higher priority than un-keyed entries.
      const aBest = findHighestIndex(a.activations.get("keyed"));
      const bBest = findHighestIndex(b.activations.get("keyed"));
      if (!aBest && !bBest) return 0;
      if (!aBest) return 1;
      if (!bBest) return -1;
  
      // We want to prefer the match with the highest index.
      const [, { index: aIndex }] = aBest;
      const [, { index: bIndex }] = bBest;
      return bIndex - aIndex;
    };
  },
  /**
   * Sorts sources that activated by cascade:
   * - Over those that did not.
   * - By the order of the cascade, earlier first.
   */
  cascadeOrder: () => (a: BudgetedSource, b: BudgetedSource) => {
    const aCascade = a.activations.get("cascade");
    const bCascade = b.activations.get("cascade");
    if (!aCascade && !bCascade) return 0;
    if (!aCascade) return 1;
    if (!bCascade) return -1;
    // Prefer the one with the lowest order.
    return aCascade.order - bCascade.order;
  },
  /**
   * Sorts sources by their underlying type.
   * 
   * Intended to be positioned before `naturalByPosition`.
   * 
   * NovelAI has a natural, deterministic order to entries that is likely
   * lost due to all the asynchronous activity.  This helps to restore it.
   */
  naturalByType: () => {
    const byType = new Map<SourceType, number>(([
      "story", "memory", "an",
      "ephemeral", "lore", "unknown"
    ] as const).map((type, i) => [type, i] as const));

    // Default to "unknown", basically.
    const defaultOrder = Math.max(...byType.values());

    return (a: BudgetedSource, b: BudgetedSource) => {
      const aType = byType.get(a.type) ?? defaultOrder;
      const bType = byType.get(b.type) ?? defaultOrder;
      return aType - bType;
    };
  },
  /**
   * Sorts sources by their position in the lorebook.
   * 
   * Intended to be positioned after `naturalByType`.
   * 
   * NovelAI has a natural, deterministic order to entries that is likely
   * lost due to all the asynchronous activity.  This helps to restore it.
   */
  naturalByPosition: ({ storyContent }: ContextParams) => {
    // This assumes that `naturalByType` has run, so multiple entries
    // with the same index won't matter, because only same types should
    // be being compared...
    const byPos = new Map<IContextField, number>([
      ...storyContent.lorebook.entries.map((entry, i) => [entry, i] as const),
      ...storyContent.ephemeralContext.map((entry, i) => [entry, i] as const)
    ]);

    // Default to after everything else, basically.
    const defaultOrder = Math.max(0, ...byPos.values()) + 1;

    return (a: BudgetedSource, b: BudgetedSource) => {
      const aPos = byPos.get(a.entry.field) ?? defaultOrder;
      const bPos = byPos.get(b.entry.field) ?? defaultOrder;
      return aPos - bPos;
    };
  }
} as const;

export type SorterKey = keyof typeof sorters;

export default sorters as Record<SorterKey, EntrySorter>;