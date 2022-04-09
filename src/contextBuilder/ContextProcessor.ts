import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { createLogger } from "@utils/logging";
import ContextBuilder from "@nai/ContextBuilder";
import EventModule, { StoryContent, StoryState} from "@nai/EventModule";
import AppConstants from "@nai/AppConstants";
import TokenizerHelpers from "@nai/TokenizerHelpers";
import ContextModule from "@nai/ContextModule";
import TextSplitterService from "./TextSplitterService";
import TokenizerService from "./TokenizerService";
import TrimmingProviders from "./TrimmingProviders";
import TrimmingService from "./TrimmingService";
import ReactiveProcessing from "./rx";
import type { TokenCodec } from "@nai/TokenizerCodec";

const logger = createLogger("ContextProcessor");

export default usModule((require, exports) => {
  const contextBuilder = require(ContextBuilder);
  const eventModule = require(EventModule);
  const appConstants = require(AppConstants);
  const tokenizerHelpers = require(TokenizerHelpers);
  const contextModule = require(ContextModule);
  const splitter = TextSplitterService(require);
  const tokenizer = TokenizerService(require);
  const trimProviders = TrimmingProviders(require);
  const { trimByLength, trimByTokens } = TrimmingService(require);
  const processing = ReactiveProcessing(require);

  async function getStoryText(
    storyState: StoryState,
    tokenCodec: TokenCodec,
    tokenLimit: number,
    storyLength?: number,
    removeComments: boolean = true
  ): Promise<string> {
    const storyConfig = storyState.storyContent.storyContextConfig;
    const storyText = storyState.storyContent.story.getText();

    const sourceText = dew(() => {
      const ev = new eventModule.PreContextEvent(storyText);
      const handled = storyState.handleEvent(ev);
      return handled.event.contextText;
    });

    const dir = storyConfig.trimDirection;
    const provider
      = removeComments ? trimProviders.removeComments[dir]
      : trimProviders.basic[dir];

    const trimOptions = {
      provider,
      maximumTrimType: storyConfig.maximumTrimType,
      preserveEnds: true
    };

    if (storyLength) {
      const result = trimByLength(sourceText, storyLength, trimOptions);
      return result?.content ?? "";
    }
    else {
      const result = await trimByTokens(sourceText, tokenLimit, tokenCodec, trimOptions);
      return result?.fragment.content ?? "";
    }
  }

  async function processContext(
    storyContent: StoryContent,
    storyState: StoryState,
    givenTokenLimit: number,
    givenLength?: number,
    removeComments: boolean = true,
    tokenCodec?: TokenCodec
  ) {
    const maxTokens = givenTokenLimit - (storyContent.settings.prefix === "vanilla" ? 0 : 20);
    const tokenizerType = tokenizerHelpers.getTokenizerType(storyContent.settings.model)
    const resolvedCodec = tokenizer.codecFor(tokenizerType, tokenCodec);

    // Defer getting the story text until after we've setup the pipeline.
    const deferredStoryText = rx
      .defer(() => getStoryText(
        storyState, resolvedCodec,
        maxTokens, givenLength,
        removeComments
      ))
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