export interface ContextConfig {
  prefix: string;
  suffix: string;
  tokenBudget: number;
  reservedTokens: number;
  budgetPriority: number;
  trimDirection: "trimBottom" | "trimTop" | "doNotTrim";
  insertionType: "newline" | "sentence" | "token";
  maximumTrimType: "newline" | "sentence" | "token";
  insertionPosition: number;
}

export interface TokenPhrase {
  sequences: number[][];
  /** I'm sure this is an `enum`, but I don't know what the values signify. */
  type: number;
}

export interface PhraseBiasConfig {
  phrases: TokenPhrase[];
  bias: number;
  ensure_sequence_finish: boolean;
  generate_once: boolean;
  enabled: boolean;
  whenInactive: boolean;
}

export interface LoreEntryConfig {
  searchRange: number;
  enabled: boolean;
  forceActivation: boolean;
  keyRelative: boolean;
  nonStoryActivatable: boolean;
  category: string;
  loreBiasGroups: PhraseBiasConfig[];
}

export interface LoreEntry extends LoreEntryConfig {
  text: string;
  displayName: string;
  keys: string[];
  contextConfig: ContextConfig;

  id?: string;
  lastUpdatedAt?: number;
}

export interface LorebookConfig {
  /**
   * When enabled, ties on `budgetPriority` are broken by key
   * match positions.  Keys found later have higher priority.
   */
  orderByKeyLocations: boolean;
}

export namespace Categories {
  interface BaseCategory {
    name: string;
    enabled: boolean;

    id?: string;
    categoryBiasGroups?: PhraseBiasConfig[];
  }

  interface WithSubcontext {
    createSubcontext: true;
    subcontextSettings: LoreEntry;
  }

  interface WithoutSubcontext {
    createSubcontext: false;
    subcontextSettings?: LoreEntry;
  }

  interface WithCategoryDefaults {
    useCategoryDefaults: true;
    categoryDefaults: LoreEntry;
  }

  interface WithoutCategoryDefaults {
    useCategoryDefaults: false;
    categoryDefaults?: LoreEntry;
  }

  type Category
    = BaseCategory
    & (WithSubcontext | WithoutSubcontext)
    & (WithCategoryDefaults | WithoutCategoryDefaults);
}

export interface Lorebook {
  lorebookVersion: number;
  settings: LorebookConfig;
  entries: LoreEntry[];
  categories: Categories.Category[];
}