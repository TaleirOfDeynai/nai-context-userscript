import * as rx from "./rx";
import * as rxop from "rxjs/operators";
import { assert } from "./assert";

import type { UndefOr } from "./utility-types";

// Because this module is just going to export operators, instead of
// importing multiple things, just re-export all of RxJS's operators.
export * from "rxjs/operators";

const isDefined = <T>(value: T): value is Exclude<T, undefined> =>
  value !== undefined;

/** Operator that emits an `undefined` value when `source` completes. */
export const whenCompleted = () => (
  /** The source observable. */
  source: rx.Observable<unknown>
): rx.Observable<void> => new rx.Observable<void>((subscriber) => {
  return source.subscribe({
    complete: () => {
      subscriber.next();
      subscriber.complete();
    },
    error: (error) => {
      subscriber.error(error);
    }
  })
});

/**
 * Operator that applies a partial function to every element of the
 * observable then filters out any results that were `undefined`.
 */
export const collect = <T, U>(
  /** The collection function. */
  collectFn: (value: T, index: number) => UndefOr<U>
) => rx.pipe(rxop.map(collectFn), rxop.filter(isDefined));

/**
 * Operator that manages a concurrent task runner that prefers executing
 * the most recent tasks provided first.  Items streaming in from the
 * source observable represent tasks that the `executor` function can
 * convert into promises.  The promise representing the executing task
 * is piped to downstream observers.
 * 
 * Situation: You have a main thread and one or more worker threads.
 * The worker threads execute tasks in first-in-first-out order.
 * 
 * Problem: You want to keep all threads running as much as possible
 * and you want to prevent the main thread from having to wait for the
 * worker threads to clear out a bunch of low-priority jobs from their
 * queues before finally getting to the task blocking the main thread.
 * 
 * This provides a solution.  It tries to keep the workers busy with
 * at most `concurrent` jobs and when a worker clears out a job, it
 * will favor kicking off the most recently queued job first, assuming
 * that the main thread will only `await` once it can proceed no further.
 * 
 * The last job queued is most likely the one blocking the main thread,
 * so the main thread should be blocked for a minimum period of time
 * while the worker thread can still be saturated with tasks.
 * 
 * However, the main thread may still be blocked waiting for currently
 * running tasks to finish before the blocking task is started, but
 * there's only so much you can do...
 */
export const taskRunner = <T, U>(
  /** The function that kicks off the task. */
  executor: (value: T) => Promise<U>,
  /**
   * The number of concurrent tasks to run.  If more tasks than this
   * are provided, the excess tasks will be buffered and executed in
   * last-in-first-out order as running tasks finish.
   */
  concurrent: number = 2
) => (observed: rx.Observable<T>) => {
  // I mean, this could be allowed to be 0 or 1, but the way I'm using
  // it would mean I'm doing something wrong.
  assert("Expected a concurrency of at least 2.", concurrent >= 2);

  return observed.pipe(
    rxop.connect(
      (shared) => {
        const stack = new rx.StackSubject<T>(true);
        shared.subscribe(stack);
        let running = 0;

        return stack.pipe(
          // When something comes down the pipe, increment our running stat
          // and request the next task if we still have room.
          rxop.tap(() => {
            running += 1;
            if (running < concurrent) stack.pop();
          }),
          // Kick off each task.  Afterwards, prime the `StackSubject` for
          // the next value.
          rxop.map((task) => executor(task).finally(() => {
            running -= 1;
            // This shouldn't happen, but we'll check our sanity.
            assert("More tasks than expected are running.", running < concurrent);
            stack.pop();
          }))
        )
      }
    )
  );
};