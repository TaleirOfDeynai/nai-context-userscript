import type { SourceType } from "../../../ContextSource";
import type { EntrySorter } from "./index";

/**
 * Sorts sources by their underlying type.
 * 
 * Intended to be positioned before `naturalByPosition`.
 * 
 * NovelAI has a natural, deterministic order to entries that is likely
 * lost due to all the asynchronous activity.  This helps to restore it.
 */
const naturalByType: EntrySorter = () => {
  const byType = new Map<SourceType, number>(([
    "story", "memory", "an",
    "ephemeral", "lore", "unknown"
  ] as const).map((type, i) => [type, i] as const));

  // Default to "unknown", basically.
  const defaultOrder = Math.max(...byType.values());

  return (a, b) => {
    const aType = byType.get(a.type) ?? defaultOrder;
    const bType = byType.get(b.type) ?? defaultOrder;
    return aType - bType;
  };
};

export default naturalByType;