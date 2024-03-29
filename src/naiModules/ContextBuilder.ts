import { ModuleDef } from "../require";

import type { AnyValueOf } from "@utils/utility-types";
import type * as Lorebook from "./Lorebook";
import type * as MatchResults from "./MatchResults";
import type * as EventModule from "./EventModule";
import type { IContextField } from "./ContextModule";
import type { TokenizerTypes } from "./TokenizerHelpers";
import type { TokenCodec } from "./TokenizerCodec";

export interface TrimStates {
  Included: "included";
  NotIncluded: "not included";
  PartiallyIncluded: "partially included";
}

export interface TrimMethods {
  NoTrim: "no trim";
  Newline: "newline";
  Sentence: "sentence";
  Token: "token";
}

export interface ReportReasons {
  ActivationForced: "activation forced";
  Default: "default";
  Disabled: "disabled";
  EphemeralActive: "ephemeral active";
  EphemeralInactive: "ephemeral inactive";
  KeyTriggered: "key activated";
  KeyTriggeredNonStory: "key in: ";
  NoContextKey: "no key in context";
  NoKeyTriggered: "no key";
  NoSpace: "no space";
  NoText: "no text";
}

export interface StructuredOutput {
  identifier: ContextStatus["unqiueId"];
  type: ContextStatus["type"];
  text: string;
}

export interface ResolvedBiasGroup {
  groups: Lorebook.PhraseBiasConfig[];
  identifier: ContextStatus<any>["identifier"];
}

export interface ResolvedPreamble {
  str: string;
  tokens: number[];
}

export interface ContextStatus<T extends IContextField = IContextField> {
  included: boolean;
  identifier: string;
  /** Misspelled in NAI source. */
  unqiueId: string;
  state: AnyValueOf<TrimStates>;
  /** Expected to be one of the {@link ReportReasons}. */
  reason: string;
  triggeringKey: string;
  keyIndex: number;
  includedText: string;
  calculatedTokens: number;
  actualReservedTokens: number;
  keyRelative: boolean;
  trimMethod: AnyValueOf<TrimMethods>;
  type: string;
  contextField: T;
  settings: T;

  /** Assigned by external mutation as an own-property. */
  subContext?: ContextRecorder;
}

export namespace Virtual {
  export declare function checkLorebook(
    /** The text available to search for keyword matches. */
    searchText: string,
    /** The entries to check. */
    entries: Lorebook.LoreEntry[],
    /** Whether to favor the last keyword match.  Defaults to `false`. */
    orderByKeyLocations: boolean,
    /**
     * Forces entries that would force-activate to instead check their keys.
     * The entry must still be enabled.  Defaults to `false`.
     */
    forceKeyChecks?: boolean
  ): Map<string, MatchResults.LorebookResult>;

  export declare function buildContext(
    storyContent: EventModule.StoryContent,
    storyState: EventModule.StoryState,
    tokenLimit: number,
    prependPreamble?: boolean,
    storyLength?: number,
    tokenCodec?: TokenCodec
  ): Promise<ContextRecorder>;

  export declare function splitBySentence(
    entryText: string
  ): string[];

  // export declare class ContextStatus<T extends IContextField = IContextField> {
  //   constructor(entry: T);

  //   included: boolean;
  //   identifier: string;
  //   /** Misspelled in NAI source. */
  //   unqiueId: string;
  //   state: AnyValueOf<TrimStates>;
  //   /** Expected to be one of the {@link ReportReasons}. */
  //   reason: string;
  //   triggeringKey: string;
  //   keyIndex: number;
  //   includedText: string;
  //   calculatedTokens: number;
  //   actualReservedTokens: number;
  //   keyRelative: boolean;
  //   trimMethod: AnyValueOf<TrimMethods>;
  //   type: string;
  //   contextField: T;
  //   settings: T;
  
  //   /** Assigned by external mutation as an own-property. */
  //   subContext?: ContextRecorder;
  // }

  export declare class StageReport {
    constructor(
      /** Defaults to `[]`. */
      structuredOutput?: StructuredOutput[],
      /** Defaults to `0`. */
      reservedTokens?: number,
      /** Defaults to `0`. */
      remainingTokens?: number,
      /** Defaults to `0`. */
      usedTokens?: number,
      /** Defaults to `""`. */
      description?: string
    );

    structuredOutput: StructuredOutput[];
    reservedTokens: number;
    remainingTokens: number;
    usedTokens: number;
    description: string;
  }

  export declare class ContextRecorder {
    maxTokens: number;
    preContextText: string;
    output: string;
    tokens: number[];
    contextStatuses: ContextStatus<IContextField>[];
    spacesTrimmed: number;
    structuredOutput: StructuredOutput[];
    stageReports: StageReport[];
    keyRejections: ContextStatus<IContextField>[];
    disabled: ContextStatus<IContextField>[];
    /**
     * Seems to indicate the offset in the assembled text where the
     * the first entry with `budgetPriority <= 0` was inserted.
     * 
     * This is PROBABLY vestigial for an older version of their own
     * context assembler, but I can't know that for sure.
     */
    orderZeroPoint: number;
    biases: ResolvedBiasGroup[];
    storyTrimmed: boolean;
    tokenizerType: TokenizerTypes;
    preamble: ResolvedPreamble;
  }
}

// export type ContextStatus = Virtual.ContextStatus;
export type StageReport = Virtual.StageReport;
export type ContextRecorder = Virtual.ContextRecorder;

export interface IContextBuilder {
  "AB": ReportReasons;
  "Ie": typeof Virtual.ContextRecorder;
  // "NV": typeof Virtual.ContextStatus;
  "eA": typeof Virtual.checkLorebook;
  "jR": typeof Virtual.splitBySentence;
  "rJ": typeof Virtual.buildContext;
  "v$": typeof Virtual.StageReport;
}

class ContextBuilder extends ModuleDef<IContextBuilder> {
  moduleId = 32486;
  expectedExports = 6;
  mapping = {
    "AB": ["REASONS", "object"],
    "Ie": ["ContextRecorder", "function"],
    // "NV": ["ContextStatus", "function"],
    "eA": ["checkLorebook", "function"],
    "jR": ["splitBySentence", "function"],
    "rJ": ["buildContext", "function"],
    "v$": ["StageReport", "function"]
  } as const;
}

export default new ContextBuilder();