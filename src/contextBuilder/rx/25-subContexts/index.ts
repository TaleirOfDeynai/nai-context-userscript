/**
 * The Sub-Context Phase handles the assembly of category sub-contexts
 * and the removal of entries that ended up incorporated into a
 * sub-context from the stream that will be fed into the selection
 * phase.
 * 
 * Configuration that affects this module:
 * - Becomes a noop when `subContext.groupedInsertion` is `true`.
 */

import usConfig from "@config";
import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { lazyObject } from "@utils/object";
import { createLogger } from "@utils/logging";
import $Category from "./category";

import type { ContextParams } from "../../ParamsService";
import type { ActivationPhaseResult, ActivatedSource } from "../20-activation";
import type { SourcePhaseResult } from "../10-source";
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
    // This phase becomes a noop if context-groups are enabled instead.
    if (usConfig.subContext.groupedInsertion) {
      return Object.freeze({
        subContexts: rx.of(new Set<SubContextSource>()),
        activated: activatedSet
      });
    }

    const logger = createLogger(`Sub-Context Phase: ${contextParams.contextName}`);

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