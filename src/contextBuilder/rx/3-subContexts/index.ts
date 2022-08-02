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
import $Category from "./category";

import type { ContextParams } from "../../ParamsService";
import type { ActivationPhaseResult, ActivatedSource } from "../2-activation";
import type { SourcePhaseResult } from "../1-source";
import type { SubContextSource } from "../_shared";

export interface SubContextPhaseResult {
  /** Produces the complete set of {@link SubContextSource} instances. */
  readonly subContexts: rx.Observable<Set<SubContextSource>>;
  /**
   * Produces the complete set of {@link ActivatedSource} instances.
   * 
   * Some of these may be a {@link SubContextSource}.
   */
  readonly activated: rx.Observable<Set<ActivatedSource | SubContextSource>>;
}

const logger = createLogger("Sub-Contexts Phase");

export default usModule((require, exports) => {
  const subContexts = {
    category: $Category(require).createStream
  } as const;

  function subContextPhase(
    /** The context builder parameters. */
    contextParams: ContextParams,
    /** The story's source. */
    storySource: SourcePhaseResult["storySource"],
    /** The fully activated set of sources. */
    activatedSet: ActivationPhaseResult["activated"]
  ): SubContextPhaseResult {
    const inFlight = activatedSet.pipe(
      rxop.mergeAll(),
      subContexts.category(contextParams, storySource),
      logger.measureStream("In-flight Sub-Contexts"),
      rxop.shareReplay()
    );

    return lazyObject({
      subContexts: () => inFlight.pipe(
        rxop.filter((source): source is SubContextSource => "subContext" in source),
        rxop.toArray(),
        rxop.map((sources) => new Set(sources)),
        rxop.shareReplay(1)
      ),
      activated: () => inFlight.pipe(
        rxop.toArray(),
        rxop.map((sources) => new Set(sources)),
        rxop.shareReplay(1)
      )
    });
  }

  return Object.assign(exports, subContexts, { phaseRunner: subContextPhase });
});