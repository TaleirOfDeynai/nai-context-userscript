import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import TokenizerHelpers from "@nai/TokenizerHelpers";
import ModelModule from "@nai/ModelModule";
import $TokenizerService from "./TokenizerService";

import type { StoryContent, StoryState } from "@nai/EventModule";
import type { TokenCodec } from "@nai/TokenizerCodec";
import type { PreambleData } from "@nai/ModelModule";
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
  /** Whether it was requested to prepend the preamble. */
  readonly prependPreamble: boolean;
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
  const modelModule = require(ModelModule);
  const tokenizerHelpers = require(TokenizerHelpers);
  const tokenizer = $TokenizerService(require);

  const getPreambleTokens = async (data: PreambleData, codec: TokenCodec) => {
    if (data.exactTokens?.length) return data.exactTokens.length;
    if (!data.str) return 0;
    return (await codec.encode(data.str)).length;
  };

  async function makeParams(
    storyContent: StoryContent,
    storyState: StoryState,
    givenTokenLimit: number,
    givenStoryLength?: number,
    prependPreamble: boolean = true,
    givenCodec?: TokenCodec
  ): Promise<ContextParams> {
    const contextName = "<Root>";
    const tokenizerType = tokenizerHelpers.getTokenizerType(storyContent.settings.model)
    const tokenCodec = tokenizer.codecFor(tokenizerType, givenCodec);
    const storyLength = givenStoryLength ?? 0;
    const orderByKeyLocations = storyContent.lorebook?.settings?.orderByKeyLocations === true;
    const allowGrouping = usConfig.subContext.groupedInsertion;

    const contextSize = await dew(async () => {
      let contextSize = givenTokenLimit;

      // A module (aka prefix) for a model claims a few tokens to pass
      // data to the model...  Or something like that!
      if (storyContent.settings.prefix !== "vanilla") contextSize -= 20;

      // The preamble's tokens are reserved ahead of time, even if it doesn't
      // end up being used in the end.
      const preambleData = modelModule.GetPreamble(
        storyContent.settings.model,
        prependPreamble,
        false,
        false,
        storyContent.settings.prefix
      );
      contextSize -= await getPreambleTokens(preambleData, tokenCodec);

      return contextSize;
    })

    return Object.freeze({
      contextName,
      storyContent,
      storyState,
      storyLength,
      contextSize,
      tokenCodec,
      prependPreamble,
      orderByKeyLocations,
      allowGrouping
    });
  }

  return Object.assign(exports, {
    makeParams
  });
});