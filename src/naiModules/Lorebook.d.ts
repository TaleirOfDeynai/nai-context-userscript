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

  /**
   * An experimental property.  Seems intended to allow control
   * over whether the context assembler can insert this entry into
   * other entries that are already inserted into the context.
   * 
   * If this is unset, it will insert if the other entry has its
   * {@link allowInsertionInside} property set to `true`.
   * 
   * Setting this to `false` will force the entry to be shunted out
   * of the target of the insert, even if that entry would have
   * allowed it.
   * 
   * Setting this to `true` is effectively the same as leaving it
   * unset, since the target of the insert has full control.
   */
  allowInnerInsertion?: boolean;

  /**
   * If this property is set to `true`, the context assembler will be
   * allowed to split this entry apart to insert another entry into
   * the middle of its text.
   * 
   * This property will veto the {@link allowInnerInsertion} property.
   * 
   * For the moment, the story content is assumed to have this set to
   * `true`, regardless of its config's actual setting.  Everything
   * else is defaulted to `false`.
   */
  allowInsertionInside?: boolean;
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
  export interface BaseCategory {
    name: string;
    enabled: boolean;

    id?: string;
    categoryBiasGroups?: PhraseBiasConfig[];
  }

  export interface WithSubcontext {
    createSubcontext: true;
    subcontextSettings: LoreEntry;
  }

  export interface WithoutSubContext {
    createSubcontext: false;
    subcontextSettings?: LoreEntry;
  }

  export interface WithCategoryDefaults {
    useCategoryDefaults: true;
    categoryDefaults: LoreEntry;
  }

  export interface WithoutCategoryDefaults {
    useCategoryDefaults: false;
    categoryDefaults?: LoreEntry;
  }

  export type Category
    = BaseCategory
    & (WithSubcontext | WithoutSubContext)
    & (WithCategoryDefaults | WithoutCategoryDefaults);
}

export interface Lorebook {
  lorebookVersion: number;
  settings: LorebookConfig;
  entries: LoreEntry[];
  categories: Categories.Category[];
}