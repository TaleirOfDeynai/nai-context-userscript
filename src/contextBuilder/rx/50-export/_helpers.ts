import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import * as IterOps from "@utils/iterables";

import type { ContextStatus, StructuredOutput } from "@nai/ContextBuilder";
import type { Assembler } from "../40-assembly";

// For JSDoc links...
import type { ContextRecorder } from "@nai/ContextBuilder";

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
   * This doesn't make sense, as we're checking if the story is either
   * NOT trimmed or was trimmed INTO OBLIVION... but it's how NovelAI
   * defines the {@link ContextRecorder.storyTrimmed} property and the
   * output for the preamble relies on this specific behavior.
   */
  function isStoryTrimmedSortOfIDK(
    allStatuses: rx.Observable<ContextStatus>
  ): rx.Observable<boolean> {
    return allStatuses.pipe(
      rxop.firstOrEmpty((s) => s.type === "story"),
      rxop.map((s) => s.state !== "partially included"),
      rxop.defaultIfEmpty(false),
      rxop.share()
    );
  }

  function orderZeroPoint(
    insertedResults: rx.Observable<Assembler.Inserted>
  ): rx.Observable<number> {
    const firstBelowZero = insertedResults.pipe(
      rxop.firstOrEmpty((inserted) => inserted.source.entry.contextConfig.budgetPriority <= 0),
      rxop.map((inserted) => inserted.source.uniqueId),
      rxop.defaultIfEmpty(undefined)
    );

    const lastOutput = insertedResults.pipe(
      rxop.lastOrEmpty(),
      rxop.map((inserted) => inserted.structuredOutput),
      rxop.defaultIfEmpty([] as StructuredOutput[])
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
    isStoryTrimmedSortOfIDK,
    orderZeroPoint
  });
});