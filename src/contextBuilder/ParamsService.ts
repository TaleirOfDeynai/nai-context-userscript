import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import TokenizerHelpers from "@nai/TokenizerHelpers";
import $TokenizerService from "./TokenizerService";
import $NaiInternals from "./NaiInternals";

import type { StoryContent, StoryState } from "@nai/EventModule";
import type { TokenizerTypes } from "@nai/TokenizerHelpers";
import type { TokenCodec } from "@nai/TokenizerCodec";
import type { LorebookConfig } from "@nai/Lorebook";
import type { AugmentedTokenCodec } from "./TokenizerService";

export interface ContextParams {
  /** Used by loggers to indicate what context is being built. */
  readonly contextName: string;
  /**
   * Indicates if these params are for building a sub-context.
   * Some processes alter their behavior when this is set.
   */
  readonly forSubContext: boolean;

  /** The provided story content. */
  readonly storyContent: StoryContent;
  /** The provided story state. */
  readonly storyState: StoryState;

  /** If greater than zero, the story should be trimmed by length. */
  readonly storyLength: number;
  /** The maximum size of the context. */
  readonly contextSize: number;
  /** The probable type of the token codec. */
  readonly tokenizerType: TokenizerTypes;
  /** The {@link AugmentedTokenCodec} to use for token counting. */
  readonly tokenCodec: AugmentedTokenCodec;
  /** Whether it was requested to prepend the preamble. */
  readonly prependPreamble: boolean;
  /** Corresponds to the same value of the lorebook config. */
  readonly orderByKeyLocations: LorebookConfig["orderByKeyLocations"];
}

export default usModule((require, exports) => {
  const tokenizerHelpers = require(TokenizerHelpers);
  const tokenizer = $TokenizerService(require);
  const naiInternals = $NaiInternals(require);

  async function makeParams(
    storyContent: StoryContent,
    storyState: StoryState,
    givenTokenLimit: number,
    givenStoryLength?: number,
    prependPreamble: boolean = true,
    givenCodec?: TokenCodec
  ): Promise<ContextParams> {
    const contextName = "<Root>";
    const forSubContext = false;
    const tokenizerType = tokenizerHelpers.getTokenizerType(storyContent.settings.model)
    const tokenCodec = tokenizer.codecFor(tokenizerType, givenCodec);
    const storyLength = givenStoryLength ?? 0;
    const orderByKeyLocations = storyContent.lorebook?.settings?.orderByKeyLocations === true;

    const contextSize = await dew(async () => {
      let contextSize = givenTokenLimit;

      // A module (aka prefix) for a model claims a few tokens to pass
      // data to the model...  Or something like that!
      if (storyContent.settings.prefix !== "vanilla") contextSize -= 20;

      // The preamble's tokens are reserved ahead of time, even if it doesn't
      // end up being used in the end.
      const preamble = await naiInternals.getPreamble(
        tokenCodec,
        storyContent.settings.model,
        storyContent.settings.prefix,
        prependPreamble,
        false,
        false
      );
      contextSize -= preamble.tokens.length;

      return contextSize;
    })

    return Object.freeze({
      contextName,
      forSubContext,
      storyContent,
      storyState,
      storyLength,
      contextSize,
      tokenizerType,
      tokenCodec,
      prependPreamble,
      orderByKeyLocations
    });
  }

  return Object.assign(exports, {
    makeParams
  });
});