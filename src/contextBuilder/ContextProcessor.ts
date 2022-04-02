import * as rx from "rxjs";
import * as rxop from "rxjs/operators";
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
import SearchService from "./SearchService";
import ReactiveProcessing from "./rx";
import type { TokenCodec } from "@nai/TokenizerCodec";
import type { TextOrFragment } from "./TextSplitterService";

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
  const process = ReactiveProcessing(require);

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
    const storyText = await getStoryText(
      storyState, resolvedCodec,
      maxTokens, givenLength,
      removeComments
    );

    const recorder = Object.assign(new contextBuilder.ContextRecorder(), {
      tokenizerType, maxTokens,
      preContextText: storyText
    });

    // Gather our content sources.
    const allSources = rx.merge(
      process.source.content(storyContent, storyText),
      process.source.lore(storyContent),
      process.source.ephemeral(storyContent)
    );

    // Figure out which are enabled or disabled.
    // We'll deal with the disabled ones later.
    const { enabledSources, disabledSources } = process.separateEnabled(allSources);

    // Stream through the activations.  Be aware that when a source comes
    // down the pipeline, we only know it activated.  The information in its
    // `activations` map can only be treated as incomplete until this entire
    // observable completes.
    const allActivations = enabledSources.pipe(
      // Perform direct activations.
      rxop.connect((sharedSrc) => {
        const directActivated = rx.merge(
          sharedSrc.pipe(process.activation.forced),
          sharedSrc.pipe(process.activation.keyed(storyText)),
          sharedSrc.pipe(process.activation.ephemeral(storyContent))
        );

        return directActivated.pipe(
          // They may directly activate more than once.  We're gathering as
          // much data on activation as possible.
          rxop.distinct(),
          // Join in the cascade.
          rxop.connect((sharedAct) => rx.merge(
            sharedAct,
            sharedAct.pipe(process.activation.cascade(sharedSrc))
          )),
          // And again, the cascade can emit activations more than once too.
          rxop.distinct()
        );
      }),
      rxop.shareReplay()
    );

    const dis = await rx.firstValueFrom(disabledSources.pipe(rxop.toArray()));
    const act = await rx.firstValueFrom(allActivations.pipe(rxop.toArray()));

    // for (const s of dis) logger.info(`Disabled: ${s.identifier}`, s);
    // for (const s of act) logger.info(`Activated: ${s.identifier}`, s);
  }

  return Object.assign(exports, {
    processContext
  });
});