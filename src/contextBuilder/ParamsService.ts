import userScriptConfig from "@config";
import { usModule } from "@utils/usModule";
import TokenizerHelpers from "@nai/TokenizerHelpers";
import $TokenizerService from "./TokenizerService";

import type { StoryContent, StoryState } from "@nai/EventModule";
import type { TokenCodec } from "@nai/TokenizerCodec";

export interface ContextParams {
  /** The provided story content. */
  readonly storyContent: StoryContent;
  /** The provided story state. */
  readonly storyState: StoryState;

  /** The maximum size of the context. */
  readonly contextSize: number;
  /** The {@link TokenCodec} to use for token counting. */
  readonly tokenCodec: TokenCodec;
  /** Whether comment removal was requested. */
  readonly removeComments: boolean;
}

export default usModule((require, exports) => {
  const tokenizerHelpers = require(TokenizerHelpers);
  const tokenizer = $TokenizerService(require);

  function makeParams(
    storyContent: StoryContent,
    storyState: StoryState,
    givenTokenLimit: number,
    removeComments: boolean = true,
    givenCodec?: TokenCodec
  ): ContextParams {
    const contextSize = givenTokenLimit - (storyContent.settings.prefix === "vanilla" ? 0 : 20);
    const tokenizerType = tokenizerHelpers.getTokenizerType(storyContent.settings.model)
    const tokenCodec = tokenizer.codecFor(tokenizerType, givenCodec);

    // Since I'm not sure when NovelAI would NOT request comments
    // be removed, you can just force it using the config.
    removeComments = userScriptConfig.comments.alwaysRemove || removeComments;

    return Object.freeze({
      storyContent,
      storyState,
      contextSize,
      tokenCodec,
      removeComments
    });
  }

  return Object.assign(exports, {
    makeParams
  });
});