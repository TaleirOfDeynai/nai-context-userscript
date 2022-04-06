import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { createLogger } from "@utils/logging";
import ActCascade from "./cascade";
import ActEphemeral from "./ephemeral";
import ActForced from "./forced";
import ActKeyed from "./keyed";

import type { StoryContent } from "@nai/EventModule";
import type { ContextSource } from "../../ContextSource";
import type { SourcePhaseResult } from "../source";

export type ActivationState = "disabled" | "rejected" | "activated";

export interface ActivationResult extends ContextSource {
  activationState: ActivationState;
};

export type ActivationObservable = rx.Observable<ActivationResult>;

export interface ActivationPhaseResult {
  /** Resolves to a complete {@link Set} of disabled {@link ContextSource}. */
  readonly disabled: Promise<Set<ContextSource>>;
  /** Resolves to a complete {@link Set} of rejected {@link ContextSource}. */
  readonly rejected: Promise<Set<ContextSource>>;
  /**
   * Resolves to a complete {@link Set} of activated {@link ContextSource}.
   * All data in their {@link ContextSource.activations} property will be
   * available when the value is pulled.
   */
  readonly activated: Promise<Set<ContextSource>>;
  /**
   * An {@link rx.Observable Observable} of entries with their activation
   * state.  Entries are piped through here as soon as their final state
   * is knowable.
   * 
   * This observable may still be hot and while it is certain that
   * activated sources have activated, they may not have all data in their
   * {@link ContextSource.activations} property set.
   */
  readonly inFlight: ActivationObservable;
}

const logger = createLogger("Activation Phase");

export default usModule((require, exports) => {
  const activation = {
    cascade: ActCascade(require).checkActivation,
    ephemeral: ActEphemeral(require).checkActivation,
    forced: ActForced(require).checkActivation,
    keyed: ActKeyed(require).checkActivation
  };

  function activationPhase(
    storyContent: StoryContent,
    promisedStoryText: Promise<string>,
    sourceResults: SourcePhaseResult
  ): ActivationPhaseResult {
    const { enabledSources, disabledSources } = sourceResults;

    // Stream through the direct activations.
    const directActivated = rx.merge(
      enabledSources.pipe(activation.forced),
      enabledSources.pipe(activation.ephemeral(storyContent)),
      // Still cheating to get as much done while waiting on the story.
      rx.from(promisedStoryText).pipe(
        rxop.map(activation.keyed),
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
            activation.cascade(enabledSources)
          )
        ),
        // Use the replay subject, as the cascade can end up a bit delayed.
        { connector: () => new rx.ReplaySubject() }
      ),
      // And again, Only emit one activation per source.
      rxop.distinct(),
      logger.measureStream("In-flight Activations"),
      rxop.shareReplay()
    );

    // We can only get rejections after all activations have completed,
    // so we'll have to wait and then check the final activation data
    // to see who has no activations at all.
    const whenActivated = inFlightActivations.pipe(rxop.whenCompleted(), rxop.share());
    const inFlightRejections = enabledSources.pipe(
      rxop.delayWhen(() => whenActivated),
      rxop.filter((source) => source.activations.size === 0),
      logger.measureStream("In-flight Rejections"),
      rxop.shareReplay()
    );

    const inFlight = rx
      .merge(
        disabledSources.pipe(rxop.map((s) => Object.assign(s, { activationState: "disabled" as const }))),
        inFlightRejections.pipe(rxop.map((s) => Object.assign(s, { activationState: "rejected" as const }))),
        inFlightActivations.pipe(rxop.map((s) => Object.assign(s, { activationState: "activated" as const })))
      )
      .pipe(
        logger.measureStream("In-flight Results")
          .markItems((source) => `${source.identifier} (${source.activationState})`),
        rxop.shareReplay()
      );

    return {
      get disabled(): Promise<Set<ContextSource>> {
        return rx.firstValueFrom(disabledSources.pipe(
          rxop.toArray(),
          rxop.map((sources) => new Set(sources))
        ));
      },
      get rejected(): Promise<Set<ContextSource>> {
        return rx.firstValueFrom(inFlightRejections.pipe(
          rxop.toArray(),
          rxop.map((sources) => new Set(sources))
        ));
      },
      get activated(): Promise<Set<ContextSource>> {
        return rx.firstValueFrom(inFlightActivations.pipe(
          rxop.toArray(),
          rxop.map((sources) => new Set(sources))
        ));
      },
      get inFlight() {
        return inFlight;
      }
    };
  }

  return Object.assign(exports, activation, { phaseRunner: activationPhase });
});