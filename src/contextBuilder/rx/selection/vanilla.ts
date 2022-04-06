import { usModule } from "@utils/usModule";
import * as rxop from "@utils/rxop";
import SearchService from "../../SearchService";

import type { ContextSource } from "../../ContextSource";
import type { ActivationObservable } from "../activation";

export default usModule((require, exports) => {
  const { findHighestIndex } = SearchService(require);

  const prioritySorter = (a: ContextSource, b: ContextSource) => {
    // Budget priority is king.
    const { budgetPriority: ap } = a.entry.contextConfig;
    const { budgetPriority: bp } = b.entry.contextConfig;
    const diff = bp - ap;
    if (diff !== 0) return diff;

    // Favor forced entries over other entries.
    const aForced = a.activations.has("forced");
    const bForced = b.activations.has("forced");
    if (aForced === bForced) return 0;
    if (aForced) return 1;
    return -1;
  };

  const keyOrderSorter = (a: ContextSource, b: ContextSource) => {
    const priorityDiff = prioritySorter(a, b);
    if (priorityDiff !== 0) return priorityDiff;

    // Keyed entries are higher priority than un-keyed entries.
    const aBest = findHighestIndex(a.activations.get("keyed"));
    const bBest = findHighestIndex(b.activations.get("keyed"));
    if (!aBest && !bBest) return 0;
    if (!aBest) return 1;
    if (!bBest) return -1;

    // We want to prefer the match with the highest index.
    const [, { index: aIndex }] = aBest;
    const [, { index: bIndex }] = bBest;
    return bIndex - aIndex;
  };

  /**
   * Sorts all inputs and emits them in order of their formalized insertion
   * priority.  This will also kick off a background task to calculate each
   * emitted element's base token count.
   * 
   * This will be used at the end to provide `actualReservedTokens` to the
   * user in the report, but it isn't really used for insertion or trimming.
   */
  const makeSelectorStream = (orderByKeyLocations: boolean) => {
    const sortingFn = orderByKeyLocations ? keyOrderSorter : prioritySorter;

    return (sources: ActivationObservable): ActivationObservable => sources.pipe(
      rxop.toArray(),
      rxop.tap((arr) => arr.sort(sortingFn)),
      rxop.mergeMap((arr) => arr)
    );
  };

  return Object.assign(exports, { createStream: makeSelectorStream });
});