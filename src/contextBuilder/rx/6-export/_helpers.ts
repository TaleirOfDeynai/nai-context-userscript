import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import * as IterOps from "@utils/iterables";

import type { ContextStatus, StructuredOutput } from "@nai/ContextBuilder";
import type { Assembler } from "../5-assembly";

export default usModule((require, exports) => {
  /**
   * Determines if the context was empty.
   */
  function isContextEmpty(
    included: rx.Observable<ContextStatus>
  ): rx.Observable<boolean> {
    return included.pipe(rxop.isEmpty());
  }

  /**
   * Determining whether the story was trimmed is a bit involved, as the
   * story may just be empty, which means it technically was not trimmed.
   */
  function allStoryIncluded(
    excluded: rx.Observable<ContextStatus>,
    included: rx.Observable<ContextStatus>
  ): rx.Observable<boolean> {
    return rx.concat(
      included.pipe(
        rxop.filter((status) => status.type === "story"),
        rxop.map((inserted) => inserted.state === "included")
      ),
      excluded.pipe(
        rxop.filter((status) => status.type === "story"),
        rxop.map((inserted) => inserted.reason === "no text")
      ),
      // The default if both of these ended up empty.
      rx.of(false)
    ).pipe(rxop.first());
  }

  function orderZeroPoint(
    insertedResults: rx.Observable<Assembler.Inserted>
  ): rx.Observable<number> {
    const firstBelowZero = insertedResults.pipe(
      rxop.first((inserted) => inserted.source.entry.contextConfig.budgetPriority <= 0),
      rxop.catchError(() => rx.of(undefined)),
      rxop.map((inserted) => inserted?.source.uniqueId)
    );

    const lastOutput = insertedResults.pipe(
      rxop.last(),
      rxop.catchError(() => rx.of(undefined)),
      rxop.map((inserted) => inserted?.structuredOutput ?? [])
    );

    return rx.forkJoin([firstBelowZero, lastOutput]).pipe(
      rxop.map(([firstBelowZero, lastOutput]) => {
        // If there is nothing below zero, then it will be the length of
        // the concatenated output.
        if (firstBelowZero === undefined) {
          return lastOutput.reduce((a, b) => a + b.text.length, 0);
        }

        // Otherwise, its all the text up-to-but-excluding the first entry
        // inserted at the zero-point.
        return IterOps.chain(lastOutput)
          .pipe(IterOps.takeUntil, (o) => o.identifier === firstBelowZero)
          .reduce(0 as number, (a, b) => a + b.text.length);
      })
    );
  }

  return Object.assign(exports, {
    isContextEmpty,
    allStoryIncluded,
    orderZeroPoint
  });
});