import usConfig from "@config";
import { usModule } from "@utils/usModule";
import TokenizerHelpers from "@nai/TokenizerHelpers";
import $TokenizerService from "./TokenizerService";

import type { StoryContent, StoryState } from "@nai/EventModule";
import type { TokenCodec } from "@nai/TokenizerCodec";
import type { LorebookConfig } from "@nai/Lorebook";
import type { AugmentedTokenCodec } from "./TokenizerService";

export interface ContextParams {
  /** Used by loggers to indicate what context is being built. */
  readonly contextName: string;

  /** The provided story content. */
  readonly storyContent: StoryContent;
  /** The provided story state. */
  readonly storyState: StoryState;

  /** If greater than zero, the story should be trimmed by length. */
  readonly storyLength: number;
  /** The maximum size of the context. */
  readonly contextSize: number;
  /** The {@link AugmentedTokenCodec} to use for token counting. */
  readonly tokenCodec: AugmentedTokenCodec;
  /** Whether comment removal was requested. */
  readonly removeComments: boolean;
  /** Corresponds to the same value of the lorebook config. */
  readonly orderByKeyLocations: LorebookConfig["orderByKeyLocations"];
  /**
   * Corresponds to {@link usConfig.subContext.groupedInsertion}.
   * 
   * Is explicitly disabled during sub-context assembly.
   */
  readonly allowGrouping: boolean;
}

export default usModule((require, exports) => {
  const tokenizerHelpers = require(TokenizerHelpers);
  const tokenizer = $TokenizerService(require);

  function makeParams(
    storyContent: StoryContent,
    storyState: StoryState,
    givenTokenLimit: number,
    givenStoryLength?: number,
    removeComments: boolean = true,
    givenCodec?: TokenCodec
  ): ContextParams {
    const contextName = "<Root>";
    const contextSize = givenTokenLimit - (storyContent.settings.prefix === "vanilla" ? 0 : 20);
    const tokenizerType = tokenizerHelpers.getTokenizerType(storyContent.settings.model)
    const tokenCodec = tokenizer.codecFor(tokenizerType, givenCodec);
    const storyLength = givenStoryLength ?? 0;
    const orderByKeyLocations = storyContent.lorebook?.settings?.orderByKeyLocations === true;
    const allowGrouping = usConfig.subContext.groupedInsertion;

    // Since I'm not sure when NovelAI would NOT request comments
    // be removed, you can just force it using the config.
    removeComments = usConfig.comments.alwaysRemove || removeComments;

    return Object.freeze({
      contextName,
      storyContent,
      storyState,
      storyLength,
      contextSize,
      tokenCodec,
      removeComments,
      orderByKeyLocations,
      allowGrouping
    });
  }

  return Object.assign(exports, {
    makeParams
  });
});