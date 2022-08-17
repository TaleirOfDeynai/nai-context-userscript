/**
 * This handles the creation of empty context-groups, which the
 * assembler will recognize and use as insertion targets for entries
 * that belong to those groups.
 * 
 * Configuration that affects this module:
 * - Becomes a noop when `subContext.groupedInsertion` is `false`.
 */

import usConfig from "@config";
import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { lazyObject } from "@utils/object";
import { createLogger } from "@utils/logging";
import $Common from "../_common";
import $Category from "./category";

import type { ContextGroup } from "../../assemblies/ContextGroup";
import type { ContextParams } from "../../ParamsService";
import type { SelectionPhaseResult } from "../30-selection";
import type { InsertableSource, InsertableObservable } from "../_common/selection";

export interface ContextGroupPhaseResult {
  /** Produces the complete set of {@link ContextGroup} instances. */
  readonly contextGroups: rx.Observable<Set<ContextGroup>>;
  /** Produces the complete set of {@link InsertableSource} instances. */
  readonly selected: rx.Observable<Set<InsertableSource>>;
  /** The in-flight selected entries, including the context-groups. */
  readonly inFlight: InsertableObservable;
}

export default usModule((require, exports) => {
  const { sorting } = $Common(require);

  const subContexts = {
    category: $Category(require).createStream
  } as const;

  function contextGroupPhase(
    /** The context builder parameters. */
    contextParams: ContextParams,
    /** The selected set of sources. */
    inFlightSelected: SelectionPhaseResult["inFlight"]
  ): ContextGroupPhaseResult {
    // This phase becomes a noop if context-groups are disabled or
    // we're working with a sub-context.
    if (!usConfig.subContext.groupedInsertion || contextParams.forSubContext) {
      return lazyObject({
        contextGroups: () => rx.of(new Set<ContextGroup>()),
        selected: () => inFlightSelected.pipe(
          rxop.toArray(),
          rxop.map((sources) => new Set(sources)),
          rxop.shareReplay(1)
        ),
        inFlight: () => inFlightSelected
      });
    }

    const logger = createLogger(`Context Group Phase: ${contextParams.contextName}`);

    const categoryGroups = inFlightSelected.pipe(
      subContexts.category(contextParams),
      logger.measureStream("In-flight Category Groups"),
      rxop.shareReplay()
    );

    // We want to additionally emit the groups as sources, but we need to emit
    // them with the correct insertion ordering.
    const orderedEntries = rx.merge(inFlightSelected, categoryGroups).pipe(
      rxop.toArray(),
      rxop.map((sources) => sources.sort(sorting.forInsertion(contextParams))),
      rxop.shareReplay(1)
    );

    return lazyObject({
      contextGroups: () => categoryGroups.pipe(
        rxop.toArray(),
        rxop.map((sources) => new Set(sources)),
        rxop.shareReplay(1)
      ),
      selected: () => orderedEntries.pipe(
        rxop.map((sources) => new Set(sources)),
        rxop.shareReplay(1)
      ),
      inFlight: () => orderedEntries.pipe(
        rxop.mergeAll(),
        rxop.shareReplay()
      )
    });
  }

  return Object.assign(exports, subContexts, { phaseRunner: contextGroupPhase });
});