/**
 * Provides helpers or work-alike implementations for NovelAI's internal
 * APIs.
 */

import { usModule } from "@utils/usModule";
import { isArray } from "@utils/is";
import ModelModule from "@nai/ModelModule";

import type { TokenCodec } from "@nai/TokenizerCodec";
import type { StorySettings } from "@nai/EventModule";
import type { PreambleData } from "@nai/ModelModule";

export default usModule((require, exports) => {
  const modelModule = require(ModelModule);

  const getPreambleTokens = async (codec: TokenCodec, data: PreambleData) => {
    if (isArray(data.exactTokens)) return data.exactTokens;
    if (!data.str) return [];
    return await codec.encode(data.str);
  };

  const getPreamble = async (
    codec: TokenCodec,
    model: StorySettings["model"],
    prefix: StorySettings["prefix"],
    prependPreamble: boolean,
    isContextEmpty: boolean,
    isStoryUntrimmed: boolean
  ) => {
    const preambleData = modelModule.GetPreamble(
      model,
      prependPreamble,
      isContextEmpty,
      isStoryUntrimmed,
      prefix
    );

    return {
      str: preambleData.str,
      tokens: await getPreambleTokens(codec, preambleData)
    };
  };

  return Object.assign(exports, {
    getPreamble
  });
});
