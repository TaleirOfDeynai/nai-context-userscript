import * as rx from "rxjs";
import { isFunction } from "./is";

import type { UndefOr } from "./utility-types";

export type ReplaySource<T> = AsyncIterable<T> | (() => AsyncIterable<T>);

export interface ReplayWrapper<T> extends AsyncIterable<T> {
  /** Same as invoking the async iterator. */
  (): AsyncIterable<T>;
  /**
   * Clears the cache so the iterator will invoke the wrapped iterable again
   * from the start.  The wrapped iterable must be capable of multiple
   * iterations for this to be effective.
   */
  clear(): void;
}

/**
 * Wraps the given async-iterable or arity-0 async generator function in an
 * object that caches the yielded values so that multiple iterations do not
 * result in repeat work.
 * 
 * Unlike RxJS's `ReplaySubject`, this will only do as much work as asked to
 * do so by whatever is using the iterator, so aborting a `for-await-of` loop
 * early will prevent any additional work being done.
 */
export const toReplay = <T>(
  source: ReplaySource<T>
): ReplayWrapper<T> => {
  const getIterable = isFunction(source) ? source : () => source;
  let elements: T[] = [];
  let iterator: UndefOr<AsyncIterator<T>> = undefined;

  const wrapped = async function*() {
    yield* elements;

    // Start up the iterator if needed.  This is done only on demand
    // so as to prevent side-effects until the first actual invocation.
    iterator = iterator ?? getIterable()[Symbol.asyncIterator]();

    let n = await iterator.next();
    while (!n.done) {
      elements.push(n.value);
      yield n.value;
      n = await iterator.next();
    }
  };

  return Object.assign(wrapped, {
    [Symbol.asyncIterator]: wrapped,
    clear() {
      elements = [];
      iterator = undefined;
    }
  });
};

/**
 * Gets the last value from the given `source` async-iterable as
 * a promise.  This will run the source to the end, naturally.
 */
export const lastValueFrom = <T>(source: AsyncIterable<T>): Promise<T> =>
  rx.lastValueFrom(rx.from(source));

/**
 * Converts the given `source` async-iterable into a promise of
 * an array of its yielded values.  This will run the source to
 * the end.
 */
export const toArray = <T>(source: AsyncIterable<T>): Promise<T[]> =>
  rx.lastValueFrom(rx.from(source).pipe(rx.toArray()));