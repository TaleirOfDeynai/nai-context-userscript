import * as rx from "rxjs";
import * as rxop from "rxjs/operators";

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
  collectFn: (value: T, index: number) => U | undefined
) => rx.pipe(rxop.map(collectFn), rxop.filter(isDefined));