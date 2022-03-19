import type { LoreEntry } from "./Lorebook";

export interface Disabled {
  key: "";
  index: -1;
  length: 0;
}

export interface Forced {
  key: "";
  index: number;
  length: 0;
}

export interface Matched {
  key: string;
  index: number;
  length: number;
}

export type AnyResult = Disabled | Forced | Matched;
export type LorebookResult = AnyResult & { entry: LoreEntry };