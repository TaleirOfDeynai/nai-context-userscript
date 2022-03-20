import { ModuleDef } from "../require";
import type * as Lorebook from "./Lorebook";
import type * as MatchResults from "./MatchResults";
import type * as EventModule from "./EventModule";
import type { TokenizerTypes } from "./TokenizerHelpers";
import type { TokenCodec } from "./TokenizerCodec";

/** A generic interface for anything that can be provide content to the context. */
export interface ContextField {
  text: string;
  contextConfig: Lorebook.ContextConfig;
}

/** Interface for a private class of this module. */
export interface IContextStatus<T extends ContextField = ContextField> {
  included: boolean;
  identifier: string;
  uniqueId: unknown;
  state: unknown;
  reason: ReportReasons[keyof ReportReasons];
  triggeringKey: string;
  keyIndex: number;
  includedText: string;
  calculatedTokens: string;
  actualReservedTokens: string;
  keyRelative: boolean;
  trimMethod: unknown;
  type: string;
  contextField: T;
  settings: T;

  /** Assigned by external mutation as an own-property. */
  subContext?: Virtual.ContextRecorder;
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
    searchText: string,
    entries: Lorebook.LoreEntry[],
    orderByKeyLocations: boolean
  ): Map<string, MatchResults.LorebookResult>;

  export declare function buildContext(
    storyContent: EventModule.StoryContent,
    storyState: EventModule.Virtual.StoryState,
    tokenLimit: number,
    removeHeaderLine?: boolean,
    storyLength?: number,
    tokenCodec?: TokenCodec
  ): Promise<ContextRecorder>;

  export declare class ContextRecorder {
    maxTokens: number;
    preContextText: string;
    output: string;
    tokens: unknown[];
    contextStatuses: IContextStatus<ContextField>[];
    spacesTrimed: number;
    structuredOutput: unknown[];
    stageReports: unknown[];
    keyRejections: IContextStatus<ContextField>[];
    disabled: IContextStatus<ContextField>[];
    orderZeroPoint: number;
    biases: Array<{
      groups: Lorebook.PhraseBiasConfig[],
      identifier: IContextStatus<any>["identifier"]
    }>;
    allStoryIncluded: boolean;
    tokenizerType: TokenizerTypes;
  }
}

export interface IContextBuilder {
  "AB": ReportReasons;
  "Ie": typeof Virtual.ContextRecorder;
  "v$": unknown;
  "rJ": typeof Virtual.buildContext;
  "eA": typeof Virtual.checkLorebook;
}

class ContextBuilder extends ModuleDef<IContextBuilder> {
  moduleId = 91072;
  expectedExports = 5;
  mapping = {
    "AB": ["REASONS", "object"],
    "Ie": ["ContextRecorder", "function"],
    "rJ": ["buildContext", "function"],
    "eA": ["checkLorebook", "function"]
  } as const;
}

export default new ContextBuilder();