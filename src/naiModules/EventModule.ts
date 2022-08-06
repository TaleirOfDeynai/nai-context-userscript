import { ModuleDef } from "../require";
import type * as Lorebook from "./Lorebook";
import type * as EphemeralHelpers from "./EphemeralHelpers";
import type { IContextField } from "./ContextModule";
import type { StoryController } from "./Story";
import type { AnyValueOf } from "@utils/utility-types";

export interface EventTypes {
  unknown: "unknown";
  storyInput: "input";
  preContext: "preContext";
  postContext: "postContext";
  generation: "generation";
}

export interface TextGenerationSettings {
  textGenerationSettingsVersion: number;

  bad_words_ids: unknown[];
  eos_token_id: unknown | undefined;
  logit_bias_groups: unknown | undefined;
  max_length: number;
  min_length: number;
  repetition_penalty: number;
  repetition_penalty_frequency: number;
  repetition_penalty_presence: number;
  repetition_penalty_range: number;
  repetition_penalty_slope: number;
  tail_free_sampling: number;
  temperature: number;
  top_a: number;
  top_k: number;
  top_p: number;
  typical_p: number;

  order: Array<{ id: Omit<keyof TextGenerationSettings, "order">, enabled: boolean }>;
}

export interface StorySettings {
  banBrackets: boolean;
  dynamicPenaltyRange: boolean;
  model: string;
  parameters: TextGenerationSettings;
  prefix: string;
  prefixMode: number;
  preset: string;
  trimResponses: boolean;
}

export interface StoryContent {
  storyContentVersion: number;

  bannedSequenceGroups: unknown[];
  changeIndex: number;
  context: IContextField[];
  contextDefaults: {
    ephemeralDefaults: unknown[];
    loreDefaults: unknown[];
  };
  didGenerate: boolean;
  document: unknown;
  eosSequences: unknown[];
  ephemeralContext: EphemeralHelpers.EphemeralEntry[];
  lorebook: Lorebook.Lorebook;
  phraseBiasGroups: unknown | undefined;
  settings: StorySettings;
  settingsDirty: boolean;
  story: StoryController;
  storyContextConfig: Lorebook.ContextConfig;
}

export interface StoryMetadata {
  storyMetadataVersion: number;
  id: string;
  title: string;

  changeIndex: number;
  createdAt: Date;
  description: string;
  favorite: boolean;
  isModified: boolean;
  lastSavedAt: Date;
  lastUpdatedAt: Date;
  remote: boolean;
  remoteId: string;
  remoteStoryId: string;
  tags: unknown[];
  textPreview: string;
}

type AnyEvent
    = Virtual.StoryInputEvent
    | Virtual.PreContextEvent
    | { eventType: AnyValueOf<EventTypes> };

export interface HandledEvent<T extends AnyEvent> {
  currentContext: string;
  remember: unknown;
  debugMessages: any[];
  event: T;
}

export namespace Virtual {
  export declare class StoryState {
    constructor(
      content: StoryContent,
      metadata: StoryMetadata,
      inputMode?: unknown,
      inputModes?: unknown[]
    );

    events: unknown[];
    inputMode: unknown;
    inputModes: unknown[];
    logging: boolean;
    remember: Map<unknown, unknown>;
    storyContent: StoryContent;
    storyMetadata: StoryMetadata;
  
    finalResult: Function;
    initialState: Function;
    isStoryEdit: Function;
    newStateLine: Function;
    pushState: Function;

    handleEvent<T extends AnyEvent>(event: T): HandledEvent<T>;
  }

  export declare class StoryInputEvent {
    constructor(storyText: string, inputText: string, generate: boolean)
    eventType: EventTypes["storyInput"];
    generate: boolean;
    storyText: string;
    inputText: string;
    originalInputText: string;
  }

  export declare class PreContextEvent {
    constructor(contextText: string);
    eventType: EventTypes["preContext"];
    contextText: string;
  }
}

export type StoryState = Virtual.StoryState;

export interface IEventModule {
  "bi": typeof Virtual.StoryState;
  "W7": typeof Virtual.StoryInputEvent;
  "ko": typeof Virtual.PreContextEvent;
}

class EventModule extends ModuleDef<IEventModule> {
  moduleId = 69485;
  expectedExports = 4;
  mapping = {
    "bi": ["StoryState", "function"],
    "W7": ["StoryInputEvent", "function"],
    "ko": ["PreContextEvent", "function"]
  } as const;
};

export default new EventModule();