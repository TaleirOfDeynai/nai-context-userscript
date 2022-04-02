import * as rx from "rxjs";
import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { createLogger } from "@utils/logging";
import * as rxop from "@utils/rxop";
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
import type { ContextSource } from "./ContextSource";

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

  function activationPhase(
    storyContent: StoryContent,
    promisedStoryText: Promise<string>
  ) {
    const inFlightStory = rx.from(promisedStoryText);
    // Gather our content sources.
    const allSources = rx.merge(
      // Stalling on getting the story text as much as possible.
      inFlightStory.pipe(
        rxop.map(process.source.content),
        rxop.mergeMap((contentSourcer) => contentSourcer(storyContent))
      ),
      // Meanwhile, we can still process these.
      process.source.lore(storyContent),
      process.source.ephemeral(storyContent)
    ).pipe(logger.measureStream("allSources"));

    // Figure out which are enabled or disabled.
    // We'll deal with the disabled ones later.
    const { enabledSources, disabledSources } = process.separateEnabled(allSources);

    // Stream through the direct activations.
    const directActivated = rx.merge(
      enabledSources.pipe(process.activation.forced),
      enabledSources.pipe(process.activation.ephemeral(storyContent)),
      // Still cheating to get as much done while waiting on the story.
      inFlightStory.pipe(
        rxop.map(process.activation.keyed),
        rxop.mergeMap((keyedActivator) => keyedActivator(enabledSources))
      )
    );

    // The stream of in-flight activations.  Be aware that when a source comes
    // down the pipeline, we only know it activated.  The information in its
    // `activations` should be assumed to be incomplete until this entire
    // observable completes.
    const inFlightActivations = directActivated.pipe(
      // Join in the cascade.
      rxop.connect(
        (sharedAct) => rx.merge(
          sharedAct,
          sharedAct.pipe(
            // Sources may directly activate more than once.  We're gathering as
            // much data on activation as possible, but the cascade wants
            // only one direct activation each.
            rxop.distinct(),
            process.activation.cascade(enabledSources)
          )
        ),
        // Use the replay subject, as the cascade can end up a bit delayed.
        { connector: () => new rx.ReplaySubject() }
      ),
      // And again, Only emit one activation per source.
      rxop.distinct(),
      logger.measureStream("inFlightActivations").markItems((i) => i.identifier),
      rxop.shareReplay()
    );

    // We can only get rejections after all activations have completed,
    // so we'll have to wait and then check the final activation data
    // to see who has no activations at all.
    const whenActivated = inFlightActivations.pipe(rxop.whenCompleted, rxop.share());
    const inFlightRejections = enabledSources.pipe(
      rxop.delayWhen(() => whenActivated),
      rxop.filter((source) => source.activations.size === 0),
      logger.measureStream("inFlightRejections"),
      rxop.shareReplay()
    );

    return {
      /** Resolves to a complete {@link Set} of disabled {@link ContextSource}. */
      get disabled(): Promise<Set<ContextSource>> {
        return rx.firstValueFrom(disabledSources.pipe(
          rxop.toArray(),
          rxop.map((sources) => new Set(sources))
        ));
      },
      /** Resolves to a complete {@link Set} of rejected {@link ContextSource}. */
      get rejected(): Promise<Set<ContextSource>> {
        return rx.firstValueFrom(inFlightRejections.pipe(
          rxop.toArray(),
          rxop.map((sources) => new Set(sources))
        ));
      },
      /**
       * Resolves to a complete {@link Set} of activated {@link ContextSource}.
       * All data in their {@link ContextSource.activations} property will be
       * available when the value is pulled.
       */
      get activated(): Promise<Set<ContextSource>> {
        return rx.firstValueFrom(inFlightActivations.pipe(
          rxop.toArray(),
          rxop.map((sources) => new Set(sources))
        ));
      },
      /**
       * An eager {@link rx.Observable Observable} of entries that were disabled
       * and cannot activate.
       */
      disabling: disabledSources as rx.Observable<ContextSource>,
      /**
       * An eager {@link rx.Observable Observable} of entries that have failed to
       * activate.
       */
      rejecting: inFlightRejections as rx.Observable<ContextSource>,
      /**
       * An eager {@link rx.Observable Observable} of entries that have activated.
       * Elements of this observable are definitely activated, but may not have
       * all data in their {@link ContextSource.activations} property set.
       * 
       * Use this observable to do things with an entry that has activated, but
       * the exact method of activation isn't important.
       */
      activating: inFlightActivations as rx.Observable<Omit<ContextSource, "activations">>
    };
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
    const promisedStoryText = getStoryText(
      storyState, resolvedCodec,
      maxTokens, givenLength,
      removeComments
    );

    const activations = activationPhase(storyContent, promisedStoryText);

    // const recorder = Object.assign(new contextBuilder.ContextRecorder(), {
    //   tokenizerType, maxTokens,
    //   preContextText: await inFlightStoryText
    // });

    const [disabled, rejected, activated] = await Promise.all([
      activations.disabled,
      activations.rejected,
      activations.activated
    ]);

    for (const s of disabled) logger.info(`Disabled: ${s.identifier}`, s);
    for (const s of rejected) logger.info(`Rejected: ${s.identifier}`, s);
    for (const s of activated) logger.info(`Activated: ${s.identifier}`, s);
  }

  return Object.assign(exports, {
    processContext
  });
});