/**
 * The Activation Phase takes all the content sources from the
 * Source Phase and determines which ones have qualified to be
 * inserted into the context.
 * 
 * In contrast to vanilla NovelAI, this is not a stop-fast process;
 * an entry does not leave the activation process as soon as it
 * finds the first keyword or what have you.  This phase is used to
 * do a bit of data gathering, which will help inform later phases
 * on how to best construct the context.
 */

import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { lazyObject } from "@utils/object";
import { createLogger } from "@utils/logging";
import $ActForced, { ForcedActivation } from "./forced";
import $ActKeyed, { KeyedActivation } from "./keyed";
import $ActEphemeral, { EphemeralActivation } from "./ephemeral";
import $ActCascade, { CascadeActivation } from "./cascade";

import type { ConstrainedMap } from "@utils/utility-types";
import type { ContextParams } from "../../ParamsService";
import type { SourcePhaseResult, EnabledSource, DisabledSource } from "../1-source";

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
  /** Produces the complete set of {@link RejectedSource rejected sources}. */
  readonly rejected: rx.Observable<Set<RejectedSource>>;
  /**
   * Produces the complete set of {@link ActivatedSource activated sources}.
   * All data in their {@link ActivatedSource.activations `activations`} property
   * will be available when the promise is fulfilled.
   */
  readonly activated: rx.Observable<Set<ActivatedSource>>;
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
    cascade: $ActCascade(require).checkActivation,
    ephemeral: $ActEphemeral(require).checkActivation,
    forced: $ActForced(require).checkActivation,
    keyed: $ActKeyed(require).checkActivation
  } as const;

  function activationPhase(
    /** The context builder parameters. */
    contextParams: ContextParams,
    /** The story's source. */
    storySource: SourcePhaseResult["storySource"],
    /** The in-flight enabled sources. */
    enabledSources: SourcePhaseResult["enabledSources"]
  ): ActivationPhaseResult {
    const activationStates = enabledSources.pipe(
      rxop.map((source): ActivationState => ({ source, activations: new Map() })),
      rxop.shareReplay()
    );

    // Stream through the direct activations.
    const directActivations = rx.merge(
      activationStates.pipe(activation.forced),
      activationStates.pipe(activation.ephemeral(contextParams.storyContent)),
      // Still cheating to get as much done while waiting on the story.
      storySource.pipe(
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

    const inFlightRejections = activationStates.pipe(
      rxop.rejectedBy(inFlightActivations, {
        source: ({ source }) => source.uniqueId,
        output: (source) => source.uniqueId
      }),
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
      }),
      rxop.shareReplay()
    );

    return lazyObject({
      rejected: () => inFlightRejections.pipe(
        rxop.toArray(),
        rxop.followUpAfter(inFlightActivations),
        rxop.map((sources) => new Set(sources)),
        rxop.shareReplay(1)
      ),
      activated: () => inFlightActivations.pipe(
        rxop.toArray(),
        rxop.followUpAfter(inFlightActivations),
        rxop.map((sources) => new Set(sources)),
        rxop.shareReplay(1)
      ),
      inFlight: () => inFlight
    });
  }

  return Object.assign(exports, activation, { phaseRunner: activationPhase });
});