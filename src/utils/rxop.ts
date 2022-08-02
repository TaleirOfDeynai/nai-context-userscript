import * as rx from "./rx";
import * as rxop from "rxjs/operators";
import { dew } from "./dew";
import { assert } from "./assert";
import { isFunction } from "./is";
import { ident } from "./functions";

import type { UndefOr } from "./utility-types";
import type { PredicateFn } from "./functions";
import type { TypePredicate } from "./is";

// Because this module is just going to export operators, instead of
// importing multiple things, just re-export all of RxJS's operators.
export * from "rxjs/operators";

const isDefined = <T>(value: T): value is Exclude<T, undefined> =>
  value !== undefined;

/** Operator that emits an `undefined` value when `source` completes. */
export const whenCompleted = () => (
  /** The source observable. */
  source: rx.Observable<unknown>
): rx.Observable<void> => source.pipe(
  rxop.ignoreElements(),
  rxop.defaultIfEmpty(undefined)
);

/** Operator that delays the source until `toComplete` completes. */
export const followUpAfter = <T>(
  toComplete: rx.Observable<unknown>
): rx.OperatorFunction<T, T> => rx.pipe(
  rxop.delayWhen(() => toComplete.pipe(whenCompleted()))
);

/**
 * Operator that applies a partial function to every element of the
 * observable then filters out any results that were `undefined`.
 */
export const collect = <T, U>(
  /** The collection function. */
  collectFn: (value: T, index: number) => UndefOr<U>
) => rx.pipe(rxop.map(collectFn), rxop.filter(isDefined));

/**
 * Locates the first element to pass the given type predicate or
 * produces an empty observable if no element is found.
 */
function firstOrEmpty<T, U extends T>(predicate: TypePredicate<U, T>): rx.OperatorFunction<T, U>;
/**
 * Locates the first element to pass the given predicate or
 * produces an empty observable if no element is found.
 */
function firstOrEmpty<T>(predicate: PredicateFn<T>): rx.OperatorFunction<T, T>;
/** Gets the first element, if the observable is not empty. */
function firstOrEmpty<T>(): rx.OperatorFunction<T, T>;
function firstOrEmpty(predicate?: PredicateFn<any>) {
  if (!isFunction(predicate)) return rx.pipe(rxop.take(1));
  return rx.pipe(rxop.filter(predicate), rxop.take(1));
}
export { firstOrEmpty };

/**
 * Locates the last element to pass the given type predicate or
 * produces an empty observable if no element is found.
 */
function lastOrEmpty<T, U extends T>(predicate: TypePredicate<U, T>): rx.OperatorFunction<T, U>;
/**
 * Locates the last element to pass the given predicate or
 * produces an empty observable if no element is found.
 */
function lastOrEmpty<T>(predicate: PredicateFn<T>): rx.OperatorFunction<T, T>;
/** Gets the last element, if the observable is not empty. */
function lastOrEmpty<T>(): rx.OperatorFunction<T, T>;
function lastOrEmpty(predicate?: PredicateFn<any>) {
  if (!isFunction(predicate)) return rx.pipe(rxop.takeLast(1));
  return rx.pipe(rxop.filter(predicate), rxop.takeLast(1));
}
export { lastOrEmpty };

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

type KeyFn<T, K> = (value: T) => K;
type KeyObject<T, U, K> = { source: KeyFn<T, K>, output: KeyFn<U, K> };
const defaultKeyObject: KeyObject<unknown, unknown, any> = { source: ident, output: ident };

/**
 * Finds values that were emitted in the source observable, but not emitted
 * by `output`.  When `output` is a stream forked from the source, this can
 * be used to figure out what the `output` stream filtered out from the
 * source.
 * 
 * A function can be provided to convert each item into a shared key to
 * identify each item, in case the items in each observable are differing
 * instances.  These keys are compared using the semantics of {@link Set sets}
 * and {@link Map maps}.
 * 
 * By default, the {@link ident identity} function is used, comparing
 * emitted references or primitive values.
 * 
 * Both observables must be able to complete and each unique item will
 * only be emitted once in the resulting observable.
 */
function rejectedBy<T>(output: rx.Observable<T>): rx.MonoTypeOperatorFunction<T>;
function rejectedBy<T, K>(output: rx.Observable<T>, keyFn: KeyFn<T, K>): rx.MonoTypeOperatorFunction<T>;
function rejectedBy<T, U, K>(output: rx.Observable<U>, keyFn: KeyFn<T | U, K>): rx.MonoTypeOperatorFunction<T>;
function rejectedBy<T, U, K>(output: rx.Observable<U>, keyBy: KeyObject<T, U, K>): rx.MonoTypeOperatorFunction<T>;
function rejectedBy<T, U, K>(output: rx.Observable<U>, keyBy: KeyFn<T, K> | KeyObject<T, U, K> = defaultKeyObject) {
  const { source: sKeyFn, output: oKeyFn } = dew(() => {
    if (!isFunction(keyBy)) return keyBy;
    // @ts-ignore - Overloads will error if this does not hold.
    return { source: keyBy, output: keyBy as KeyFn<U, K> };
  });

  return (input: rx.Observable<T>) => {
    const keysOfOutput = output.pipe(
      rxop.reduce((a, v) => a.add(oKeyFn(v)), new Set<K>())
    );
    const mapOfSource = input.pipe(
      rxop.reduce((a, v) => a.set(sKeyFn(v), v), new Map<K, T>())
    );

    return rx.forkJoin([mapOfSource, keysOfOutput]).pipe(
      rx.mergeMap(([sources, outputs]) => {
        for (const key of outputs) sources.delete(key);
        return sources.values();
      })
    );
  };
}
export { rejectedBy };