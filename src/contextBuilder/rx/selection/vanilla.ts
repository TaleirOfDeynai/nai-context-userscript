import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { isNumber } from "@utils/is";
import SearchService from "../../SearchService";

import type { ActivatedSource } from "../activation";

export default usModule((require, exports) => {
  const { findHighestIndex } = SearchService(require);

  /** Sorts sources with token reservations first. */
  const reservationSorter = (a: ActivatedSource, b: ActivatedSource) => {
    const { reservedTokens: ar } = a.entry.contextConfig;
    const { reservedTokens: br } = b.entry.contextConfig;
    const aReserved = isNumber(ar) && ar > 0;
    const bReserved = isNumber(br) && br > 0;
    if (aReserved === bReserved) return 0;
    if (aReserved) return -1;
    return 1;
  };

  /** Sorts sources by their budget priority, descending. */
  const prioritySorter = (a: ActivatedSource, b: ActivatedSource) => {
    const { budgetPriority: ap } = a.entry.contextConfig;
    const { budgetPriority: bp } = b.entry.contextConfig;
    return bp - ap;
  };

  /** Sorts sources that were force-activated first. */
  const forceActivationSorter = (a: ActivatedSource, b: ActivatedSource) => {
    const aForced = a.activations.has("forced");
    const bForced = b.activations.has("forced");
    if (aForced === bForced) return 0;
    if (aForced) return -1;
    return 1;
  };

  /**
   * Sorts sources that activated by keyword:
   * - Over those that did not.
   * - In the order of where the match was found, later in the story first.
   */
  const keyOrderSorter = (a: ActivatedSource, b: ActivatedSource) => {
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
    /** Sorting functions we're going to use. */
    const sorters = [
      reservationSorter,
      prioritySorter,
      forceActivationSorter,
      orderByKeyLocations ? keyOrderSorter : undefined
    ].filter(Boolean);

    const sortingFn = (a: ActivatedSource, b: ActivatedSource) => {
      for (let i = 0, len = sorters.length; i < len; i++) {
        const result = sorters[i](a, b);
        if (result !== 0) return result;
      }
      return 0;
    };

    return (sources: rx.Observable<ActivatedSource>) => sources.pipe(
      rxop.toArray(),
      rxop.tap((arr) => arr.sort(sortingFn)),
      rxop.mergeMap((arr) => arr)
    );
  };

  return Object.assign(exports, { createStream: makeSelectorStream });
});