import { ModuleDef } from "../require";
import type * as Lorebook from "./Lorebook";
import type * as MatchResults from "./MatchResults";
import type * as EventModule from "./EventModule";
import type { TokenizerTypes } from "./TokenizerHelpers";
import type { TokenCodec } from "./TokenizerCodec";
import type { AnyValueOf } from "@utils/utility-types";

/** A generic interface for anything that can be provide content to the context. */
export interface ContextField {
  text: string;
  contextConfig: Lorebook.ContextConfig;
}

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
  KeyTriggeredNonStory: "key (non-story)";
  NoContextKey: "no key in context";
  NoKeyTriggered: "no key";
  NoSpace: "no space";
  NoText: "no text";
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
    removeComments?: boolean,
    storyLength?: number,
    tokenCodec?: TokenCodec
  ): Promise<ContextRecorder>;

  export declare class ContextStatus<T extends ContextField = ContextField> {
    included: boolean;
    identifier: string;
    /** Misspelled in NAI source. */
    unqiueId: string;
    state: AnyValueOf<TrimStates>;
    reason: AnyValueOf<ReportReasons>;
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

  export declare class ContextRecorder {
    maxTokens: number;
    preContextText: string;
    output: string;
    tokens: unknown[];
    contextStatuses: ContextStatus<ContextField>[];
    spacesTrimed: number;
    structuredOutput: unknown[];
    stageReports: unknown[];
    keyRejections: ContextStatus<ContextField>[];
    disabled: ContextStatus<ContextField>[];
    orderZeroPoint: number;
    biases: Array<{
      groups: Lorebook.PhraseBiasConfig[],
      identifier: ContextStatus<any>["identifier"]
    }>;
    allStoryIncluded: boolean;
    tokenizerType: TokenizerTypes;
  }
}

export type ContextRecorder = Virtual.ContextRecorder;

export interface IContextBuilder {
  "AB": ReportReasons;
  "Ie": typeof Virtual.ContextRecorder;
  "v$": unknown;
  "NV": typeof Virtual.ContextStatus;
  "rJ": typeof Virtual.buildContext;
  "eA": typeof Virtual.checkLorebook;
}

class ContextBuilder extends ModuleDef<IContextBuilder> {
  moduleId = 66642;
  expectedExports = 6;
  mapping = {
    "AB": ["REASONS", "object"],
    "Ie": ["ContextRecorder", "function"],
    "NV": ["ContextStatus", "function"],
    "rJ": ["buildContext", "function"],
    "eA": ["checkLorebook", "function"]
  } as const;
}

export default new ContextBuilder();