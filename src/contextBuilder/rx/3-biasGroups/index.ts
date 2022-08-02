/**
 * The Bias-Groups Phase takes the activated and rejected entries
 * and determines which bias-groups should be activated to service
 * that feature.
 */

import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { lazyObject } from "@utils/object";
import { createLogger } from "@utils/logging";
import $BiasLore from "./lore";
import $BiasCategory from "./category";

import type { ResolvedBiasGroup } from "@nai/ContextBuilder";
import type { ContextParams } from "../../ParamsService";
import type { ActivationPhaseResult } from "../2-activation";

export interface BiasGroupPhaseResult {
  /** Produces the complete array of {@link ResolvedBiasGroup} instances. */
  readonly biasGroups: rx.Observable<ResolvedBiasGroup[]>;
  /** An {@link rx.Observable Observable} of {@link ResolvedBiasGroup} instances. */
  readonly inFlight: rx.Observable<ResolvedBiasGroup>;
}

const logger = createLogger("Bias Groups Phase");

export default usModule((require, exports) => {
  const biasGroups = {
    lore: $BiasLore(require).createStream,
    category: $BiasCategory(require).createStream
  } as const;

  function biasGroupPhase(
    /** The context builder parameters. */
    contextParams: ContextParams,
    /** The currently in-flight activations. */
    inFlightActivations: ActivationPhaseResult["inFlight"]
  ): BiasGroupPhaseResult {
    const inFlight = rx.merge(
      biasGroups.lore(inFlightActivations),
      biasGroups.category(contextParams.storyContent, inFlightActivations)
    ).pipe(
      logger.measureStream("In-flight Bias Groups"),
      rxop.shareReplay()
    );

    return lazyObject({
      biasGroups: () => inFlight.pipe(rxop.toArray(), rxop.shareReplay(1)),
      inFlight: () => inFlight
    });
  }

  return Object.assign(exports, biasGroups, { phaseRunner: biasGroupPhase });
});