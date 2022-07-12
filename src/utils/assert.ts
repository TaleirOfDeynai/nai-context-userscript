import _hasIn from "lodash/hasIn";
import { isInstance, isNumber, isString } from "./is";

import type { TypePredicate } from "./is";

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

type Lengthy = { length: number };
type Sized = { size: number };
interface Ranged {
  /** The minimum value of the range. */
  min: number,
  /** The maximum value of the range. */
  max: number
};

const isLengthy = (value: any): value is Lengthy => _hasIn(value, "length");
const isSized = (value: any): value is Sized => _hasIn(value, "size");

/** Validates that `value` is between `0` and `max`. */
function assertInBounds(
  /** The message to use as the error. */
  msg: string,
  /** The value to be tested. */
  value: number,
  /** The maximum allowed value. */
  max: number,
  /**
   * By default, it allows between `0` and up-to-but-excluding `max`.
   * This is how you'd do it when checking against a `length` or `size`.
   * 
   * Set this to `true` to allow between `0` and up-to-and-including `max`.
   */
  inclusive?: boolean
): void;
/** Validates that `value` is in the bounds of the given sized collection. */
function assertInBounds(
  /** The message to use as the error. */
  msg: string,
  /** The value to be tested. */
  value: number,
  /** An object that provides the reference range. */
  ref: Lengthy | Sized | Ranged,
  /**
   * By default, it checks against the range inferred by `ref` exclusively.
   * This is how you'd do it when checking against a `length` or `size`.
   * 
   * Set this to `true` to check the range inclusively.
   */
  inclusive?: boolean
): void;
function assertInBounds(
  msg: string,
  value: number,
  ref: number | Lengthy | Sized | Ranged,
  inclusive = false
) {
  let min = 0;
  let max = 0;

  // Gotta be careful with strings, as you can't use the `in` operator
  // on them, since they're technically a value type.
  if (isNumber(ref)) max = ref;
  else if (isString(ref)) max = ref.length;
  else if (isLengthy(ref)) max = ref.length;
  else if (isSized(ref)) max = ref.size;
  else {
    min = ref.min;
    max = ref.max;
  }

  assert(msg, value >= min && (inclusive ? value <= max : value < max));
}

export { assert, assertAs, assertExists, assertInBounds };