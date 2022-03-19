import type * as Lorebook from "./Lorebook";
import type * as ContextModule from "./ContextModule";
import type * as EphemeralHelpers from "./EphemeralHelpers";

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
  context: ContextModule.Virtual.ContextContent[];
  contextDefaults: {
    ephemeralDefaults: unknown[];
    loreDefaults: unknown[];
  }
  ephemeralContext: EphemeralHelpers.EphemeralEntry[];
  lorebook: Lorebook.Lorebook;
  phraseBiasGroups: unknown | undefined;
  settings: StorySettings;
  settingsDirty: boolean;
  story: StoryController;
  storyContextConfig: unknown;
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

export interface StoryState {
  events: unknown[];
  inputMode: unknown;
  inputModes: unknown[];
  logging: boolean;
  remember: Map<unknown, unknown>;
  storyContent: StoryContent;
  storyMetadata: StoryMetadata;

  finalResult: Function;
  handleEvent: Function;
  initialState: Function;
  isStoryEdit: Function;
  newStateLine: Function;
  pushState: Function;
}

export class StoryController {
  getText(): string;
  step: number;

  /** There are way more, but we only care about the above. */
  [k: string]: unknown;
}