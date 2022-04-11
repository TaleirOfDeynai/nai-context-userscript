import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { createLogger } from "@utils/logging";
import ActForced, { ForcedActivation } from "./forced";
import ActKeyed, { KeyedActivation } from "./keyed";
import ActEphemeral, { EphemeralActivation } from "./ephemeral";
import ActCascade, { CascadeActivation } from "./cascade";

import type { ConstrainedMap } from "@utils/utility-types";
import type { StoryContent } from "@nai/EventModule";
import type { SourcePhaseResult, EnabledSource, DisabledSource } from "../source";

/** Just provides a source of types for {@link ActivationMap}. */
interface ActivationMapping {
  forced: ForcedActivation;
  keyed: KeyedActivation;
  ephemeral: EphemeralActivation;
  cascade: CascadeActivation;
}

/** A {@link Map} for types of activations. */
export type ActivationMap = ConstrainedMap<ActivationMapping>;

/** Shared state for activators. */
export type ActivationState<T extends EnabledSource = EnabledSource> = {
  source: T,
  activations: ActivationMap
};

export interface ActivatedSource extends EnabledSource {
  activated: true;
  activations: ActivationMap;
};

export interface RejectedSource extends EnabledSource {
  activated: false;
  activations: ActivationMap;
};

export type ActivationSource = ActivatedSource | RejectedSource;

export type ActivationObservable = rx.Observable<ActivationSource>;

export interface ActivationPhaseResult {
  /** Resolves to a complete {@link Set} of {@link DisabledSource disabled sources}. */
  readonly disabled: Promise<Set<DisabledSource>>;
  /** Resolves to a complete {@link Set} of {@link RejectedSource rejected sources}. */
  readonly rejected: Promise<Set<RejectedSource>>;
  /**
   * Resolves to a complete {@link Set} of {@link ActivatedSource activated sources}.
   * All data in their {@link ActivatedSource.activations `activations`} property
   * will be available when the promise is fulfilled.
   */
  readonly activated: Promise<Set<ActivatedSource>>;
  /**
   * An {@link rx.Observable Observable} of entries with their activation
   * state.  Entries are piped through here as soon as their final state
   * is knowable.
   * 
   * This observable may still be hot and while it is certain that
   * activated sources have activated, they may not have all data in their
   * {@link ActivatedSource.activations `activations`} property set.
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
    deferredStoryText: rx.Observable<string>,
    sourceResults: SourcePhaseResult
  ): ActivationPhaseResult {
    const { enabledSources, disabledSources } = sourceResults;

    const activationStates = enabledSources.pipe(
      rxop.map((source): ActivationState => ({ source, activations: new Map() })),
      rxop.shareReplay()
    );

    // Stream through the direct activations.
    const directActivations = rx.merge(
      activationStates.pipe(activation.forced),
      activationStates.pipe(activation.ephemeral(storyContent)),
      // Still cheating to get as much done while waiting on the story.
      deferredStoryText.pipe(
        rxop.map(activation.keyed),
        rxop.mergeMap((keyedActivator) => keyedActivator(activationStates))
      )
    );
    
    // The stream of in-flight activations.  Be aware that when a source comes
    // down the pipeline, we only know it activated.  The information in its
    // `activations` should be assumed to be incomplete until this entire
    // observable completes.
    const inFlightActivations = directActivations.pipe(
      // Sources may directly activate more than once.  We're gathering as
      // much data on activation as possible, but the cascade wants
      // only one direct activation each.
      rxop.distinct(),
      // Join in the cascade.
      rxop.connect((directActivations) => rx.merge(
        directActivations,
        directActivations.pipe(activation.cascade(activationStates))
      )),
      // Again, only emit one activation per source; the cascade may now have
      // added some duplicates.
      rxop.distinct(),
      rxop.map(({ source, activations }): ActivatedSource => Object.assign(source, {
        activated: true as const,
        activations
      })),
      logger.measureStream("In-flight Activations"),
      rxop.shareReplay()
    );

    // We can only get rejections after all activations have completed,
    // so we'll have to wait and then check the final activation data
    // to see who has no activations at all.
    const whenActivated = inFlightActivations.pipe(rxop.whenCompleted(), rxop.share());
    const inFlightRejections = activationStates.pipe(
      rxop.delayWhen(() => whenActivated),
      rxop.filter((state) => state.activations.size === 0),
      rxop.map(({ source, activations }): RejectedSource => Object.assign(source, {
        activated: false as const,
        activations
      })),
      logger.measureStream("In-flight Rejections"),
      rxop.shareReplay()
    );

    const inFlight = rx.merge(inFlightRejections, inFlightActivations).pipe(
      logger.measureStream("In-flight Results").markItems((source) => {
        const state = source.activations.size ? "activated" : "rejected";
        return `${source.identifier} (${state})`
      })
    );

    return {
      get disabled() {
        return rx.firstValueFrom(disabledSources.pipe(
          rxop.toArray(),
          // This prevents observables from going hot in an order dependent
          // on the when these promises were obtained.
          rxop.delayWhen(() => inFlightActivations.pipe(rxop.whenCompleted())),
          rxop.map((sources) => new Set(sources))
        ));
      },
      get rejected() {
        return rx.firstValueFrom(inFlightRejections.pipe(
          rxop.toArray(),
          rxop.map((sources) => new Set(sources))
        ));
      },
      get activated() {
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