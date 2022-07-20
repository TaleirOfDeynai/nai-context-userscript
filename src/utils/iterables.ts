import _hasIn from "lodash/hasIn";
import { isIterable, isArray } from "./is";
import { isString, isObject, isNumber } from "./is";
import { assert } from "./assert";

import type { PredicateFn } from "./functions";
import type { AnyValueOf, Maybe, UndefOr } from "./utility-types";
import type { TypePredicate } from "./is";

/** Basic key-value pair, as a tuple. */
export type KVP<K = string | number, V = any> = readonly [K, V];

/** The primitive data-types. */
export type Primitives = number | string | boolean | Function | {} | null | undefined;

export type Flattenable<T = unknown>
  = T extends string ? string
  : T extends Iterable<infer TEl> ? TEl
  : T;
export type FlatElementOf<T> = T extends Iterable<infer TEl> ? Flattenable<TEl> : never;

export type ElementOf<T> = T extends Iterable<infer TEl> ? TEl : never;

export type ReduceFn<TIn, TOut, TInit = TOut> = (accumulator: TOut | TInit, currentValue: TIn) => TOut;
export type TransformFn<TIn, TOut> = (value: TIn) => TOut;
export type TupleTransformFn<TIn, TOut extends readonly Primitives[]> = (value: TIn) => [...TOut];
export type CollectFn<TIn, TOut> = TransformFn<TIn, UndefOr<TOut>>;
export type TupleCollectFn<TIn, TOut extends readonly Primitives[]> = (value: TIn) => UndefOr<[...TOut]>;
export type TapFn<TValue> = (value: TValue) => unknown;

/**
 * TypeScript sucks at inferring the return type of a function with
 * arguments piped into it.
 * 
 * It falters with functions that rely heavily on dependent types
 * to determine its return type, like `flatMap`, and when dealing
 * with overloaded functions.  So, `DumbPipeTransformFn` cannot
 * change the output type so dumb TypeScript can handle it.
 * 
 * Someday, if TypeScript gets serious about providing complete type
 * safety, maybe I will be able to have separate `TIn` and `TOut`.
 * I could not figure out how to massage things so it works with
 * any function.
 */
export type DumbPipeTransformFn<T, TArgs extends unknown[]>
  = (piped: Iterable<T>, ...args: TArgs) => Iterable<T>;

type UnionToIntersection<T>
  = (T extends any ? (x: T) => any : never) extends
    (x: infer R) => any ? R : never;

type PartitionResult<T extends KVP> = KVP<T[0], T[1][]>;
type FromPairsResult<T>
  = T extends KVP<infer K, infer V>
    ? K extends string | number | symbol ? { [Prop in K]: V } : never
  : never;

export interface ChainComposition<TIterIn extends Iterable<unknown>> {
  /** Reduces the iterable to a single value. */
  reduce<TInit, TOut = TInit>(initialValue: TInit, reducer: ReduceFn<ElementOf<TIterIn>, TOut, TInit>): TInit | TOut;
  /** Transforms each element into a tuple. */
  map<TOut extends readonly Primitives[]>(xformFn: TupleTransformFn<ElementOf<TIterIn>, TOut>): ChainComposition<Iterable<TOut>>;
  /** Transforms each element. */
  map<TOut>(xformFn: TransformFn<ElementOf<TIterIn>, TOut>): ChainComposition<Iterable<TOut>>;
  /** Flattens an iterable of iterables by one level. */
  flatten(): ChainComposition<Iterable<FlatElementOf<TIterIn>>>;
  /** Removes falsey values from the iterable and refines the element's type to remove `undefined` and `null`. */
  filter(predicateFn: BooleanConstructor): ChainComposition<Iterable<Exclude<ElementOf<TIterIn>, null | undefined>>>;
  /** Filters to a specific type, as described by the type-guard predicate. */
  filter<TOut>(predicateFn: TypePredicate<TOut>): ChainComposition<Iterable<TOut>>;
  /** Filters to those elements that pass a predicate function. */
  filter(predicateFn: PredicateFn<ElementOf<TIterIn>>): ChainComposition<Iterable<ElementOf<TIterIn>>>;
  /** Collects each applicable element into a tuple. */
  collect<TOut extends readonly Primitives[]>(collectFn: TupleCollectFn<ElementOf<TIterIn>, TOut>): ChainComposition<Iterable<TOut>>;
  /** Collects each applicable element. */
  collect<TOut>(collectFn: CollectFn<ElementOf<TIterIn>, TOut>): ChainComposition<Iterable<TOut>>;
  /** Concatenates the given values and/or iterables after the current iterable. */
  concat<TEl>(...others: (TEl | Iterable<TEl>)[]): ChainComposition<Iterable<ElementOf<TIterIn> | TEl>>;
  /** Transforms the iterable into a different iterable. */
  thru<TIterOut extends Iterable<unknown>>(xformFn: TransformFn<TIterIn, TIterOut>): ChainComposition<TIterOut>;
  /**
   * Applies a transformation function, supplying the chained iterable and `args`
   * to `fn`.
   * 
   * This let's you supply additional arguments to any transformation function that
   * takes an iterable as its first argument without needing to instantiate a
   * function for `thru`.
   * 
   * As an example, `.pipe(skip, 10)` is equivalent to `.thru((iter) => skip(iter, 10))`.
   * 
   * Currently, this is limited to functions that do not change the type of
   * the elements in the iterable.
   */
  pipe<TArgs extends unknown[]>(fn: DumbPipeTransformFn<ElementOf<TIterIn>, TArgs>, ...args: TArgs): ChainComposition<Iterable<ElementOf<TIterIn>>>;
  /** Calls the given function with each value, but yields the values unchanged. */
  tap(tapFn: TapFn<ElementOf<TIterIn>>): ChainComposition<Iterable<ElementOf<TIterIn>>>;
  /** Calls the given function on a materialized array of the iterable, then yields the original values, unchanged. */
  tapAll(tapFn: TapFn<Array<ElementOf<TIterIn>>>): ChainComposition<Iterable<ElementOf<TIterIn>>>;
  /** Transforms the iterable into any kind of value, ending the chain. */
  value<TOut>(xformFn: TransformFn<TIterIn, TOut>): TOut;
  /** Ends the chain and produces the resulting iterable. */
  value(): TIterIn;
  /** Ends the chain and materializes the iterable as an array. */
  toArray(): Array<ElementOf<TIterIn>>;
  /** Materializes the iterable for side-effects.  Helpful if you just wanna `tap` that. */
  exec(): void;
}

declare global {
  interface Array<T> {
    // Fixes `filter` so it recognizes when the `Boolean` constructor is being used
    // as a predicate.  Supposedly, it was their intention it work like this, but it don't.
    // I know, TypeScript maintainers.  Types are hard, especially when you've built a
    // house-of-cards type-system.
    filter(predicate: BooleanConstructor): Exclude<T, null | undefined>[];
  }
}

/**
 * Converts the given iterable into a readonly array, if needed.
 */
export const toImmutable = <T>(iterable: Iterable<T>): readonly T[] => {
  if (!isArray(iterable)) return Object.freeze([...iterable]);
  if (Object.isFrozen(iterable)) return iterable;
  return Object.freeze(iterable.slice());
};

const hasSize = (value: unknown): value is { size: number } => {
  if (!isObject(value)) return false;
  if (value instanceof Map) return true;
  if (value instanceof Set) return true;
  // @ts-ignore - `_hasIn` does not actually narrow the type.
  if (_hasIn(value, "size")) return isNumber(value.size);
  return false;
};

/**
 * Determines if the given iterable is empty.
 * 
 * WARNING: this can invoke the iterator of the iterable; avoid
 * using with {@link IterableIterator} or any kind of lazy iterator.
 */
export const isEmpty = (iterable: Iterable<unknown>): boolean => {
  if (isArray(iterable)) return !iterable.length;
  if (isString(iterable)) return !iterable.length;
  if (hasSize(iterable)) return !iterable.size;
  return !iterable[Symbol.iterator]().next().done;
};

/**
 * Gets the first element of an iterable or `undefined` if it has none.
 */
export const first = <T>([v]: Iterable<T>): UndefOr<T> => v;

/**
 * Gets the last element of an iterable or `undefined` if it has none.
 */
export const last = <T>(iter: Iterable<T>): UndefOr<T> => {
  if (isArray(iter)) {
    if (iter.length === 0) return undefined;
    return iter[iter.length - 1];
  }

  let result: UndefOr<T> = undefined;
  for (const v of iter) result = v;
  return result;
};

/**
 * Counts the number of elements that pass a predicate.
 */
export const countBy = <T>(iter: Iterable<T>, predicateFn: PredicateFn<T>): number => {
  let count = 0;
  for (const item of iter)
    if (predicateFn(item)) count += 1;
  return count;
};

/**
 * Creates an object from key-value-pairs.
 */
export const fromPairs = <T extends KVP<string | number | symbol>>(
  kvps: Iterable<T>
): UnionToIntersection<FromPairsResult<T>> => {
  const result: any = {};
  for (const [k, v] of kvps) result[k] = v;
  return result;
};

/**
 * Creates an iterable that yields the key-value pairs of an object.
 */
export function toPairs(obj: null | undefined): Iterable<KVP<never, never>>;
export function toPairs<TObj extends {}>(obj: Maybe<TObj>): Iterable<KVP<keyof TObj, AnyValueOf<TObj>>>;
export function* toPairs(obj: any): Iterable<KVP<string | number | symbol, any>> {
  if (obj == null) return;
  for(const key of Object.keys(obj)) yield [key as any, obj[key]];
  for(const sym of Object.getOwnPropertySymbols(obj)) yield [sym as any, obj[sym]];
};

/**
 * Creates an iterable that yields each element with the element that
 * immediately follows it.
 * 
 * Will yield nothing if the iterable has less than 2 elements.
 */
export function scan<T, C extends number>(iter: Iterable<T>): Iterable<[T, T]>;
/**
 * Creates an iterable that yields each element with all the elements
 * after it in an array with a length of `count`.
 * 
 * Will yield nothing if the iterable has less than `count` elements.
 */
export function scan<T, C extends number>(iter: Iterable<T>, count: C): Iterable<T[] & { length: C }>;
export function* scan<T>(
  iter: Iterable<T>,
  count = 2
) {
  const buffer = new Array<T>(count);
  let i = 0;
  for (const v of iter) {
    buffer[i++] = v;
    if (i < count) continue;
    yield [...buffer] as any;
    buffer.copyWithin(0, 1);
    i = count - 1;
  }
}  

/**
 * Applies a transformation function to the values of an object.
 */
export const mapValues = function<TObj extends Record<string, any>, TOut>(
  obj: Maybe<TObj>,
  xformFn: (value: TObj[keyof TObj], key: keyof TObj) => TOut
): { [K in keyof TObj]: TOut } {
  const newObj: any = {};
  for (const [key, value] of toPairs(obj))
    newObj[key] = xformFn(value, key);

  return newObj;
};

/**
 * Transforms an iterable with the given function, yielding each result.
 */
export const flatMap = function*<T, U>(
  iterable: Iterable<T>,
  transformFn: TransformFn<T, Iterable<U>>
): Iterable<U> {
  for (const value of iterable) yield* transformFn(value);
};

/**
 * Flattens the given iterable.  If the iterable contains strings, which
 * are themselves iterable, they will be yielded as-is, without flattening them.
 */
export const flatten = function*<T>(
  iterable: Iterable<T>
): Iterable<Flattenable<T>> {
  // This is almost certainly an error.
  assert("Flattening strings is not allowed.", !isString(iterable));

  for (const value of iterable) {
    // @ts-ignore - We don't flatten strings.
    if (isString(value)) yield value;
    // @ts-ignore - We pass out non-iterables, as they are.
    else if (!isIterable(value)) yield value;
    // And now, do a flatten.
    else yield* value;
  }
};

/**
 * Yields iterables with a number representing their position.  For arrays,
 * this is very similar to a for loop, but you don't increment the index
 * yourself.
 */
export const iterPosition = function*<T>(
  iter: Iterable<T>
): Iterable<[number, T]> {
  if (isArray(iter)) {
    yield* iter.entries();
  }
  else {
    let i = 0;
    for (const item of iter) yield [i++, item];
  }
};

/**
 * Yields elements of an iterable in reverse order.  You can limit the
 * number of results yielded by providing `count`.
 */
export const iterReverse = function*<T>(
  iter: Iterable<T>,
  count?: number
): Iterable<T> {
  if (isArray(iter)) {
    // Ensure `count` is between 0 and the number of items in the array.
    count = Math.max(0, Math.min(iter.length, count ?? iter.length));
    const lim = iter.length - count;
    for (let i = iter.length - 1; i >= lim; i--) yield iter[i];
  }
  else {
    // We gotta materialize the values so we can reverse them.
    yield* iterReverse([...iter], count);
  }
};

/**
 * Yields up to `count` elements from the beginning of the given iterable.
 */
export const take = function*<T>(
  iter: Iterable<T>,
  count: number
): Iterable<T> {
  if (isArray(iter)) {
    // Ensure `count` is between 0 and the number of items in the array.
    count = Math.max(0, Math.min(iter.length, count ?? iter.length));
    for (let i = 0; i < count; i++) yield iter[i];
  }
  else {
    const iterator = iter[Symbol.iterator]();
    let v = iterator.next();
    for (let i = 0; i < count && !v.done; i++) {
      yield v.value;
      v = iterator.next();
    }
  }
};

/**
 * Yields items from the beginning of the iterable until the given predicate
 * function returns `true`.
 */
export const takeUntil = function*<T extends Iterable<any>>(
  iter: T,
  predicateFn: PredicateFn<ElementOf<T>>
): Iterable<ElementOf<T>> {
  for (const item of iter) {
    if (predicateFn(item)) return;
    yield item;
  }
};

/**
 * Yields up to `count` elements from the end of the iterable.  The original
 * order will be preserved, unlike in `iterReverse`.
 */
export const takeRight = <T>(iterable: Iterable<T>, count: number): Array<T> =>
  [...iterReverse(iterable, count)].reverse();

/**
 * Yields items from the end of the iterable until the given predicate
 * function returns `true`.  Although the predicate will work from the end
 * toward the beginning, the items will be yielded in their original order.
 */
export const takeRightUntil = <T extends Iterable<any>>(
  iter: T,
  predicateFn: PredicateFn<ElementOf<T>>
): Array<ElementOf<T>> => {
  const buffer: ElementOf<T>[] = [];
  for (const item of iterReverse(iter)) {
    if (predicateFn(item)) break;
    buffer.push(item);
  }

  return buffer.reverse();
};

/** Yields items after skipping the first `count` items. */
export const skip = function*<T>(
  iter: Iterable<T>,
  count: number
): Iterable<T> {
  if (count <= 0) return iter;

  if (isArray(iter)) {
    // Ensure `count` is between 0 and the number of items in the array.
    count = Math.max(0, Math.min(iter.length, count ?? iter.length));
    for (let i = count; i < iter.length; i++) yield iter[i];
  }
  else {
    let skipped = 0;
    for (const item of iter) {
      if (skipped >= count) yield item;
      else skipped += 1;
    }
  }
};

/** Yields items starting from the first to pass `predicateFn`. */
export const skipUntil = function*<T extends Iterable<any>>(
  iter: T,
  predicateFn: PredicateFn<ElementOf<T>>
): Iterable<ElementOf<T>> {
  let skipDone = false;
  for (const item of iter) {
    checks: {
      if (skipDone) break checks;
      if (!predicateFn(item)) continue;
      skipDone = true;
    }
    yield item;
  }
};

/** Yields all items except the last `count` items. */
export const skipRight = function*<T>(
  iter: Iterable<T>,
  count: number
): Iterable<T> {
  if (count <= 0) return iter;

  if (isArray(iter)) {
    // Ensure `count` is between 0 and the number of items in the array.
    count = Math.max(0, Math.min(iter.length, count ?? iter.length));
    for (let i = 0; i < iter.length - count; i++) yield iter[i];
  }
  else {
    const buffer: T[] = [];
    for (const item of iter) {
      buffer.push(item);
      if (buffer.length > count) yield buffer.shift() as T;
    }
  }
};

/**
 * Yields all items up-to-and-including the last element to pass the
 * given predicate.
 */
export const skipRightUntil = function*<T extends Iterable<any>>(
  iter: T,
  predicateFn: PredicateFn<ElementOf<T>>
): Iterable<ElementOf<T>> {
  if (isArray(iter)) {
    // Figure out where we're gonna stop.
    let cutOff = iter.length - 1;
    for (; cutOff >= 0; cutOff--)
      if (predicateFn(iter[cutOff])) break;
    // Iterate until we reach the cutoff.
    for (let i = 0; i <= cutOff; i++) yield iter[i];
  }
  else {
    // Not really sure how to do this with an unbounded iterable.
    // Just convert to an array and use the array version.
    return skipRightUntil([...iter] as any, predicateFn);
  }
};

/**
 * Creates an iterable that transforms values.
 */
export const mapIter = function*<TIn, TOut>(
  iterable: Iterable<TIn>,
  transformFn: TransformFn<TIn, TOut>
): Iterable<TOut> {
  for (const value of iterable)
    yield transformFn(value);
};

/**
 * Transforms the values of an iterable of {@link KVP}.
 */
export const mapValuesOf = <T extends KVP<any>, U>(
  iterable: Iterable<T>,
  transformFn: TransformFn<T[1], U>
): Iterable<KVP<T[0], U>> => {
  return mapIter(iterable, ([k, v]) => [k, transformFn(v)] as const);
};

/**
 * Creates an iterable that transforms values, and yields the result if it is
 * not `undefined`.
 */
export const collectIter = function*<TIn, TOut>(
  iterable: Iterable<TIn>,
  collectFn: CollectFn<TIn, TOut>
): Iterable<TOut> {
  for (const value of iterable) {
    const result = collectFn(value);
    if (typeof result !== "undefined") yield result;
  }
};

/**
 * Filters the given iterable to those values that pass a predicate.
 */
export const filterIter = function*<T extends Iterable<any>>(
   iterable: T,
   predicateFn: PredicateFn<ElementOf<T>>
): Iterable<ElementOf<T>> {
  for (const value of iterable)
    if (predicateFn(value))
      yield value;
};

export const reduceIter = function<TIter extends Iterable<any>, TInit, TOut = TInit>(
  iterable: TIter,
  initialValue: TInit,
  reducer: ReduceFn<ElementOf<TIter>, TOut, TInit>
): TInit | TOut {
  // Fast-path for array instances.  We do need to adapt the `reducer`,
  // since `Array#reduce` passes additional arguments to it that can
  // break things like `Math.min`.
  if (isArray(iterable))
    return iterable.reduce((p, v) => reducer(p, v), initialValue);

  let acc: TInit | TOut = initialValue;
  for (const value of iterable) acc = reducer(acc, value);
  return acc;
};

/**
 * Creates an iterable that groups values based on a transformation function.
 */
export const groupBy = function*<TValue, TKey>(
  iterable: Iterable<TValue>,
  transformFn: TransformFn<TValue, TKey>
): Iterable<[TKey, TValue[]]> {
  const groups = new Map<TKey, TValue[]>();
  for (const value of iterable) {
    const key = transformFn(value);
    if (key == null) continue;
    const theGroup = groups.get(key) ?? [];
    theGroup.push(value);
    groups.set(key, theGroup);
  }

  yield* groups;
};

const partitionKeys = <T extends KVP<any>>(kvp: T): T[0] => kvp[0];
const partitionValues = <T extends KVP<any>>(kvp: T): T[1] => kvp[1];

/**
 * Creates an iterable that groups key-value-pairs when they share the same key.
 */
export const partition = function*<T extends KVP<any>>(
  iterable: Iterable<T>
): Iterable<PartitionResult<T>> {
  for (const [key, values] of groupBy(iterable, partitionKeys))
    yield [key, values.map(partitionValues)];
};

/**
 * Concatenates multiple values and/or iterables together.  Does not iterate
 * on strings, however.
 */
export const concat = function*<T>(
  ...others: Array<T | Iterable<T>>
): Iterable<T> {
  for (const value of others) {
    if (isString(value)) yield value as T;
    else if (isIterable(value)) yield* value;
    else yield value;
  }
};

/**
 * Inserts `value` between every element of `iterable`.
 */
export const interweave = function*<T>(
  iterable: Iterable<T>,
  value: T
): Iterable<T> {
  const iterator = iterable[Symbol.iterator]();
  let prevEl = iterator.next();
  while (!prevEl.done) {
    yield prevEl.value;
    prevEl = iterator.next();
    if (prevEl.done) return;
    yield value;
  }
};

/**
 * Yields values from an `iterable` that pass the predicate `waypointFn`
 * as well as all values in-between these waypoints.
 * 
 * This just trims the beginning and end of the iterable of values that
 * are not considered "useful", according to the predicate.
 */
export const journey = function*<T extends Iterable<any>>(
  iter: T,
  waypointFn: PredicateFn<ElementOf<T>>
): Iterable<ElementOf<T>> {
  let journeyBegun = false;
  const buffer: ElementOf<T>[] = [];

  // Any items still in the buffer after iteration completes will be
  // intentionally discarded, as they are not between two waypoints.
  for (const item of iter) {
    if (!waypointFn(item)) {
      if (!journeyBegun) continue;
      buffer.push(item);
    }
    else {
      journeyBegun = true;
      if (buffer.length) {
        yield* buffer;
        buffer.length = 0;
      }
      yield item;
    }
  }
}

/**
 * Buffers items until an item passes the given `predicateFn`.
 * - The item that satisfied the predicate is added to the buffer.
 * - The buffer is yielded.
 * - Then a new buffer is created.
 * 
 * If `finalize` is set to `false`, the final buffer will not be yielded if
 * the last item failed to pass the predicate.
 */
export const buffer = function*<T extends Iterable<any>>(
  iter: T,
  predicateFn: PredicateFn<ElementOf<T>>,
  finalize = true
): Iterable<ElementOf<T>[]> {
  let buffer: ElementOf<T>[] = [];
  for (const item of iter) {
    buffer.push(item);
    if (!predicateFn(item)) continue;
    yield buffer;
    buffer = [];
  }
  if (!finalize || !buffer.length) return;
  yield buffer;
};

/**
 * Buffers items until an item passes the given `predicateFn`.
 * - The buffer is yielded.
 * - A new buffer is created.
 * - The item that satisfied the predicate is added to it.
 * 
 * If `finalize` is set to `false`, the final buffer will not be yielded if
 * the last item failed to pass the predicate.
 */
export const bufferEagerly = function*<T extends Iterable<any>>(
  iter: T,
  predicateFn: PredicateFn<ElementOf<T>>,
  finalize = true
): Iterable<ElementOf<T>[]> {
  let buffer: ElementOf<T>[] = [];
  for (const item of iter) {
    if (predicateFn(item)) {
      if (buffer.length) yield buffer;
      buffer = [];
    }
    buffer.push(item);
  }
  if (!finalize || !buffer.length) return;
  yield buffer;
};

/**
 * Takes a sequence of elements and batches them into groups based on
 * whether they're equal, according to `Object.is`.
 * 
 * Whenever the current value is found to not equal the previous, a new
 * group is started.  Each group will contain elements considered equal.
 */
 export function batch<T extends Iterable<any>>(
  iter: T
): Iterable<ElementOf<T>[]>;
/**
 * Takes a sequence of elements and batches them into groups based on
 * the results of a comparison function.
 * 
 * Whenever the current value is considered un-equal to the previous
 * according to the `compareFn`, a new group is started.  Each group
 * will contain elements that compare equitably.
 */
export function batch<T extends Iterable<any>>(
  iter: T,
  compareFn: (cur: ElementOf<T>, prev: ElementOf<T>) => boolean
): Iterable<ElementOf<T>[]>;
/**
 * Takes a sequence of elements and batches them into groups based on
 * the results of a comparison function.
 * 
 * Whenever the current value is considered un-equal to the previous
 * according to the `compareFn`, a new group is started.  Each group
 * will contain elements that compare equitably.
 */
export function batch<T extends Iterable<any>>(
  iter: T,
  compareFn: (cur: ElementOf<T>, prev: ElementOf<T>) => number
): Iterable<ElementOf<T>[]>;
export function* batch<T extends Iterable<any>>(
  iter: T,
  compareFn?: (cur: ElementOf<T>, prev: ElementOf<T>) => number | boolean
): Iterable<ElementOf<T>[]> {
  // By default, check if the current item is the same as the last item
  // in the buffer using `Object.is`.
  compareFn ??= Object.is;

  let buffer: ElementOf<T>[] = [];
  for (const item of iter) {
    checks: {
      if (buffer.length === 0) break checks;

      const result = compareFn(item, buffer[buffer.length - 1]);
      if (result === 0 || result === true) break checks;

      yield buffer;
      buffer = [];
    }

    buffer.push(item);
  }

  if (buffer.length) yield buffer;
}

/**
 * Calls the given function on each element of `iterable` and yields the
 * values, unchanged.
 */
export const tapEach = function*<T>(
  iterable: Iterable<T>,
  tapFn: TapFn<T>
): Iterable<T> {
  // Clone an array in case the reference may be mutated by the `tapFn`.
  const safedIterable: Iterable<T> = isArray(iterable) ? [...iterable] : iterable;
  for (const value of safedIterable) {
    tapFn(value);
    yield value;
  }
};

/**
 * Calls the given function on an array materialized from `iterable` and
 * yields the same values, unchanged.
 */
export const tapAll = function*<T>(
   iterable: Iterable<T>,
   tapFn: TapFn<T[]>
): Iterable<T> {
  // Materialize the iterable; we can't provide an iterable that is
  // currently being iterated.
  const materialized = [...iterable];
  tapFn(materialized);
  yield* materialized;
};

/** Creates a chain from the given iterable. */
function chain<TIter extends Iterable<unknown>>(iterable: TIter): ChainComposition<TIter>;
/** Creates an empty iterable chain. */
function chain<TIter extends Iterable<unknown> = []>(): ChainComposition<TIter>;
function chain(iterable?: any) {
  iterable = iterable ?? [];
  return {
    reduce: (init, reducer) => reduceIter(iterable, init, reducer),
    map: (transformFn) => chain(mapIter(iterable, transformFn)),
    flatten: () => chain(flatten(iterable)),
    filter: (predicateFn) => chain(filterIter(iterable, predicateFn)),
    collect: (collectFn) => chain(collectIter(iterable, collectFn)),
    concat: (...others) => chain(concat(iterable, ...others)),
    thru: (transformFn) => chain(transformFn(iterable)),
    pipe: (fn, ...args) => chain(fn(iterable, ...args)),
    tap: (tapFn) => chain(tapEach(iterable, tapFn)),
    tapAll: (tapFn) => chain(tapAll(iterable, tapFn)),
    value: (xformFn?: TransformFn<any, any>) => xformFn ? xformFn(iterable) : iterable,
    toArray: () => [...iterable],
    exec: () => { for (const _ of iterable); }
  };
};

export { chain };