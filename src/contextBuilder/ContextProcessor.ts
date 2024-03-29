/**
 * This module is essentially the entry-point of the whole context-builder.
 * 
 * It sets up the main processing pipeline which is built up of the
 * RxJS streams found in the `./rx` folder.  It makes sure that the
 * "phase runner" functions get all the data they need to set
 * themselves up.
 */

import { firstValueFrom } from "@utils/rx";
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
    prependPreamble?: boolean,
    tokenCodec?: TokenCodec
  ) {
    const contextParams = await makeParams(
      storyContent,
      storyState,
      givenTokenLimit,
      givenStoryLength,
      prependPreamble,
      tokenCodec
    );

    // Figure out our sources for context content.
    const sourceResults = processing.source.phaseRunner(contextParams);

    // Figure out what content is actually to be used.
    const activationResults = processing.activation.phaseRunner(
      contextParams,
      sourceResults.storySource,
      sourceResults.enabledSources
    );

    // Grab the triggered bias groups as content activates.
    const biasGroupResults = processing.biasGroups.phaseRunner(
      contextParams,
      activationResults.inFlight
    );

    // Remove sources that belong to a category with a sub-context and then
    // assemble and create the sources for each sub-context.  This may be
    // a noop depending on configuration.
    const subContexts = processing.subContexts.phaseRunner(
      contextParams,
      sourceResults.storySource,
      activationResults.activated
    );

    // Order the content based on importance.
    const selectionResults = processing.selection.phaseRunner(
      contextParams,
      sourceResults.storySource,
      subContexts.activated
    );

    const contextGroups = processing.contextGroups.phaseRunner(
      contextParams,
      selectionResults.inFlight
    );

    const assemblyResults = processing.assembly.phaseRunner(
      contextParams,
      selectionResults.totalReservedTokens,
      contextGroups.inFlight,
      contextGroups.contextGroups
    );

    const exportResults = processing.export.phaseRunner(
      contextParams,
      sourceResults.storySource,
      sourceResults.disabledSources,
      biasGroupResults.biasGroups,
      activationResults.rejected,
      selectionResults.unselected,
      assemblyResults.rejections,
      assemblyResults.insertions,
      assemblyResults.assembly
    );

    return await firstValueFrom(exportResults.contextRecorder);
  }

  return Object.assign(exports, {
    processContext
  });
});