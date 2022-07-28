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

    // Figure out what content is actually to be used.
    const activationResults = processing.activation.phaseRunner(
      contextParams,
      sourceResults.storySource,
      sourceResults.enabledSources,
      sourceResults.disabledSources
    );

    // Grab the triggered bias groups as content activates.
    const biasGroupResults = processing.biasGroups.phaseRunner(
      contextParams,
      activationResults.inFlight
    );

    // Order the content based on importance.
    const selectionResults = processing.selection.phaseRunner(
      contextParams,
      sourceResults.storySource,
      rx.defer(() => activationResults.activated)
    );

    const assemblyResults = processing.assembly.phaseRunner(
      contextParams,
      rx.defer(() => selectionResults.totalReservedTokens),
      selectionResults.inFlight
    );

    // const recorder = Object.assign(new contextBuilder.ContextRecorder(), {
    //   tokenizerType, maxTokens,
    //   preContextText: await inFlightStoryText
    // });

    const [selected, unselected, rejected, disabled, biasGroups, assembly] = await Promise.all([
      selectionResults.selected,
      selectionResults.unselected,
      activationResults.rejected,
      activationResults.disabled,
      biasGroupResults.biasGroups,
      assemblyResults.assembly
    ]);

    for (const s of disabled) logger.info(`Disabled: ${s.identifier}`, s);
    for (const s of rejected) logger.info(`Rejected: ${s.identifier}`, s);
    for (const s of unselected) logger.info(`Unselected: ${s.identifier}`, s);
    for (const s of selected) logger.info(`Selected: ${s.identifier}`, s);
    for (const bg of biasGroups) logger.info(`Bias Group: ${bg.identifier}`, bg);

    const reserved = await selectionResults.totalReservedTokens;
    logger.info(`Total reserved tokens: ${reserved} out of ${contextParams.contextSize}`);
    logger.info("Final Result:\n", await assembly.toAssembly());
  }

  return Object.assign(exports, {
    processContext
  });
});