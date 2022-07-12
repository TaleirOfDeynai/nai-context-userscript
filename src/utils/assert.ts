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

const isLengthy = (value: any): value is Lengthy =>
  isString(value) || _hasIn(value, "length");
const isSized = (value: any): value is Sized =>
  _hasIn(value, "size");
const hasMin = (value: unknown): value is Pick<Ranged, "min"> =>
  _hasIn(value, "min");
const hasMax = (value: unknown): value is Pick<Ranged, "max"> =>
  _hasIn(value, "max");

const getMin = (value: unknown): number => {
  if (hasMin(value)) return value.min;
  return 0;
};

const getMax = (value: unknown): number => {
  if (isNumber(value)) return value;
  if (isLengthy(value)) return value.length;
  if (isSized(value)) return value.size;
  if (hasMax(value)) return value.max;
  throw new Error("Unsupported value type.");
};

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
  const min = getMin(ref);
  const max = getMax(ref);
  assert(msg, value >= min && (inclusive ? value <= max : value < max));
}

export { assert, assertAs, assertExists, assertInBounds };