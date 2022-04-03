import type { PhraseBiasConfig } from "@nai/Lorebook";

export interface TriggeredBiasGroup {
  groups: PhraseBiasConfig[];
  identifier: string;
}

export const whenActive = (biasGroup: PhraseBiasConfig) =>
  !biasGroup.whenInactive;

export const whenInactive = (biasGroup: PhraseBiasConfig) =>
  biasGroup.whenInactive;

export const hasValidPhrase = (biasGroup: PhraseBiasConfig) =>
  biasGroup.enabled && Boolean(biasGroup.phrases.length);