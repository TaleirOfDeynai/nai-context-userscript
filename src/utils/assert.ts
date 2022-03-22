import { isInstance, TypePredicate } from "./is";

/**
 * Validates a basic assertion.  If it fails, an error with `msg` is thrown.
 */
const assert = (msg: string, check: boolean) => {
  if (check) return;
  throw new Error(msg);
};

/**
 * Validates that `value` passes the given type predicate.  If it fails, an error
 * with `msg` is thrown.
 */
const assertAs = <T>(msg: string, checkFn: TypePredicate<T>, value: any): T => {
  assert(msg, checkFn(value));
  return value;
};

/**
 * Validates that `value` is not `null` or `undefined`.
 */
const assertExists = <T>(msg: string, value: T): Exclude<T, undefined | null> =>
  assertAs(msg, isInstance, value);

export { assert, assertAs, assertExists };