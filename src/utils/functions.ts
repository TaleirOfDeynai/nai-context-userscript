import { assert } from "./assert";

export { noop } from "./rx";
export { default as memoize } from "lodash/memoize";
export { default as flow } from "lodash/flow";

export type PredicateFn<T> = (value: T) => boolean;

/** A promise with its `resolve` and `reject` functions exposed. */
export interface Future<T> {
  /** Resolves the {@link Future.promise promise}. */
  resolve: (value: T) => void;
  /** Rejects the {@link Future.promise promise}. */
  reject: (err: any) => void;
  /** The promise. */
  readonly promise: Promise<T>;
  /** Whether the promise has been fulfilled. */
  readonly isFulfilled: boolean;
}

/** Represents a yet-to-be-executed task. */
export interface Deferred<T> {
  /** Starts the task when called. */
  execute: () => Promise<T>;
  /** The promise to be resolved once `execute` is called. */
  readonly promise: Promise<T>;
  /** Whether `execute` has been called. */
  readonly isStarted: boolean;
  /** Whether the task has completed. */
  readonly isFulfilled: boolean;
}

/**
 * Creates a {@link Future}, which is basically a promise that has been
 * turned inside out.  You will need to specify the `T` yourself.
 */
export const future = <T = unknown>(): Future<T> => {
  let didFulfill = false;
  let _resolve: (value: T) => void;
  let _reject: (err: any) => void;

  const promise = new Promise<T>((ok, fail) => {
    _resolve = ok;
    _reject = fail;
  });

  return {
    resolve: (value: T) => {
      assert("Already fulfilled.", !didFulfill);
      didFulfill = true;
      _resolve(value);
    },
    reject: (err: any) => {
      assert("Already fulfilled.", !didFulfill);
      didFulfill = true;
      _reject(err);
    },
    get isFulfilled() { return didFulfill; },
    get promise() { return promise; }
  };
};

/** Defers execution of an async function until `execute` is called. */
export const defer = <T>(taskFn: () => Promise<T>): Deferred<T> => {
  let started = false;
  const _future = future<T>();
  return {
    execute: () => {
      assert("Execution has already begun.", !started);
      started = true;
      taskFn().then(_future.resolve, _future.reject);
      // Return the future's promise instead.
      return _future.promise;
    },
    get isStarted() { return started; },
    get isFulfilled() { return _future.isFulfilled; },
    get promise() { return _future.promise; }
  };
};

/** The identity function. */
export const ident = <T>(value: T) => value;

/** Inverts a predicate function. */
export const invertPredicate = <T>(predicateFn: PredicateFn<T>) =>
  (value: T) => !predicateFn(value);