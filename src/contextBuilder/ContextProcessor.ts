import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { createLogger } from "@utils/logging";
import $ParamsService from "./ParamsService";
import $ReactiveProcessing from "./rx";

import type { TokenCodec } from "@nai/TokenizerCodec";
import type { StoryContent, StoryState } from "@nai/EventModule";

const logger = createLogger("ContextProcessor");

export default usModule((require, exports) => {
  const { makeParams } = $ParamsService(require);
  const processing = $ReactiveProcessing(require);

  async function processContext(
    storyContent: StoryContent,
    storyState: StoryState,
    givenTokenLimit: number,
    givenStoryLength?: number,
    removeComments?: boolean,
    tokenCodec?: TokenCodec
  ) {
    const contextParams = makeParams(
      storyContent,
      storyState,
      givenTokenLimit,
      givenStoryLength,
      removeComments,
      tokenCodec
    );

    // Figure out our sources for context content.
    const sourceResults = processing.source.phaseRunner(contextParams);

    // Figure out what to do with all this content.
    const activationResults = processing.activation.phaseRunner(
      storyContent, sourceResults
    );

    // Grab the triggered bias groups as content activates.
    const biasGroupResults = processing.biasGroups.phaseRunner(
      storyContent, activationResults
    );

    // const recorder = Object.assign(new contextBuilder.ContextRecorder(), {
    //   tokenizerType, maxTokens,
    //   preContextText: await inFlightStoryText
    // });

    const [activated, rejected, disabled, biasGroups] = await Promise.all([
      activationResults.activated,
      activationResults.rejected,
      activationResults.disabled,
      biasGroupResults.biasGroups
    ]);

    for (const s of disabled) logger.info(`Disabled: ${s.identifier}`, s);
    for (const s of rejected) logger.info(`Rejected: ${s.identifier}`, s);
    for (const s of activated) logger.info(`Activated: ${s.identifier}`, s);
    for (const bg of biasGroups) logger.info(`Bias Group: ${bg.identifier}`, bg);
  }

  return Object.assign(exports, {
    processContext
  });
});