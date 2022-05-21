import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { createLogger } from "@utils/logging";
import EventModule from "@nai/EventModule";
import $ParamsService from "./ParamsService";
import $TextSplitterService from "./TextSplitterService";
import $TrimmingProviders from "./TrimmingProviders";
import $TrimmingService from "./TrimmingService";
import $ReactiveProcessing from "./rx";

import type { TokenCodec } from "@nai/TokenizerCodec";
import type { StoryContent, StoryState } from "@nai/EventModule";
import type { ContextParams } from "./ParamsService";

const logger = createLogger("ContextProcessor");

export default usModule((require, exports) => {
  const eventModule = require(EventModule);
  const providers = $TrimmingProviders(require);

  const { makeParams } = $ParamsService(require);
  const { mergeFragments } = $TextSplitterService(require);
  const { trimByLength, trimByTokens } = $TrimmingService(require);
  const processing = $ReactiveProcessing(require);

  async function getStoryText(
    contextParams: ContextParams,
    storyLength?: number
  ): Promise<string> {
    const { storyState, removeComments, contextSize, tokenCodec } = contextParams;
    const storyConfig = storyState.storyContent.storyContextConfig;
    const storyText = storyState.storyContent.story.getText();

    const sourceText = dew(() => {
      const ev = new eventModule.PreContextEvent(storyText);
      const handled = storyState.handleEvent(ev);
      return handled.event.contextText;
    });

    const dir = storyConfig.trimDirection;
    const provider
      = removeComments ? providers.removeComments[dir]
      : providers.basic[dir];

    const trimOptions = {
      provider,
      maximumTrimType: storyConfig.maximumTrimType,
      preserveEnds: true
    };

    if (storyLength) {
      const result = trimByLength(sourceText, storyLength, trimOptions);
      return result ? mergeFragments(result.fragments).content : "";
    }
    else {
      const result = await trimByTokens(sourceText, contextSize, contextParams, trimOptions);
      return result ? mergeFragments(result.fragments).content : "";
    }
  }

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

    // Defer getting the story text until after we've setup the pipeline.
    const deferredStoryText = rx
      .defer(() => getStoryText(contextParams, givenStoryLength))
      .pipe(rxop.share());

    // Figure out our sources for context content.
    const sourceResults = processing.source.phaseRunner(
      storyContent, deferredStoryText
    );

    // Figure out what to do with all this content.
    const activationResults = processing.activation.phaseRunner(
      storyContent, deferredStoryText, sourceResults
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