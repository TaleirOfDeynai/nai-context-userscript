import { isString, isIterable, TypePredicate } from "./is";

/** The primitive data-types. */
type Primitives = number | string | boolean | Function | {} | null | undefined;

type UnionToIntersection<T>
  = (T extends any ? (x: T) => any : never) extends
    (x: infer R) => any ? R : never;

type PartitionResult<KVP> = KVP extends [infer K, infer V] ? [K, V[]] : never;
type FromPairsResult<KVP>
  = KVP extends [infer K, infer V]
    ? K extends string | number ? { [Prop in K]: V } : never
  : never;

export type Flattenable<T>
  = T extends string ? string
  : T extends Iterable<infer TEl> ? TEl
  : T;
export type FlatElementOf<T> = T extends Iterable<infer TEl> ? Flattenable<TEl> : never;

export type ElementOf<T> = T extends Iterable<infer TEl> ? TEl : never;

export type TransformFn<TIn, TOut> = (value: TIn) => TOut;
export type TupleTransformFn<TIn, TOut extends readonly Primitives[]> = (value: TIn) => [...TOut];
export type CollectFn<TIn, TOut> = TransformFn<TIn, TOut | undefined>;
export type TupleCollectFn<TIn, TOut extends readonly Primitives[]> = (value: TIn) => [...TOut] | undefined;
export type PredicateFn<T> = (value: T) => boolean;
export type TapFn<TValue> = (value: TValue) => unknown;

export interface ChainComposition<TIterIn extends Iterable<unknown>> {
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

/**
 * Gets the first element of an iterable or `undefined` if it has none.
 */
export const first = <T>([v]: Iterable<T>): T | undefined => v;

/**
 * Gets the last element of an iterable or `undefined` if it has none.
 */
export const last = <T>(iter: Iterable<T>): T | undefined => {
  if (Array.isArray(iter)) {
    if (iter.length === 0) return undefined;
    return iter[iter.length - 1];
  }

  let result: T | undefined = undefined;
  for (const v of iter) result = v;
  return result;
};

/**
 * Creates an object from key-value-pairs.
 */
export const fromPairs = <KVP extends [string | number, any]>(
  kvps: Iterable<KVP>
): UnionToIntersection<FromPairsResult<KVP>> => {
  const result: any = {};
  for (const [k, v] of kvps) result[k] = v;
  return result;
};

/**
 * Creates an iterable that yields the key-value pairs of an object.
 */
export const toPairs = function*<TObj extends Record<string, any>>(
  obj: TObj | null | undefined
): Iterable<[keyof TObj, TObj[keyof TObj]]> {
  if (obj == null) return;
  for(const key of Object.keys(obj)) {
    // @ts-ignore - `Object.keys` is too dumb.
    yield tuple2(key, obj[key]);
  }
};

/**
 * Applies a transformation function to the values of an object.
 */
export const mapValues = function<TObj extends Record<string, any>, TOut>(
  obj: TObj | null | undefined,
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
export const flatten = function*<T extends Flattenable<any>>(
  iterable: Iterable<T>
): Iterable<Flattenable<T>> {
  for (const value of iterable) {
    // @ts-ignore - We pass out non-iterables, as they are.
    if (!isIterable(value)) yield value;
    // @ts-ignore - We don't flatten strings.
    else if (isString(value)) yield value;
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
  if (Array.isArray(iter)) {
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
  if (Array.isArray(iter)) {
    // Ensure `count` is between 0 and the number of items in the array.
    count = Math.max(0, Math.min(iter.length, count ?? iter.length));
    const lim = iter.length - count;
    for (let i = iter.length - 1; i >= lim; i--) yield iter[i];
  }
  else {
    // Either way we gotta cache the values so we can reverse them.
    yield* iterReverse([...iter], count);
  }
};

/**
 * Takes up to `count` elements from the beginning of the iterable.
 */
export const take = function*<T>(
  iterable: Iterable<T>,
  count: number
): Iterable<T> {
  if (Array.isArray(iterable)) {
    // Ensure `count` is between 0 and the number of items in the array.
    count = Math.max(0, Math.min(iterable.length, count ?? iterable.length));
    for (let i = 0; i < count; i++) yield iterable[i];
  }
  else {
    const iterator = iterable[Symbol.iterator]();
    let v = iterator.next();
    for (let i = 0; i < count && !v.done; i++) {
      yield v.value;
      v = iterator.next();
    }
  }
};

/**
 * Takes up to `count` elements from the end of the iterable.  The original order
 * will be preserved, unlike in `iterReverse`.
 */
export const takeRight = <T>(iterable: Iterable<T>, count: number): Array<T> =>
  [...iterReverse(iterable, count)].reverse();

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
export const filterIter = function*<T>(
   iterable: Iterable<T>,
   predicateFn: PredicateFn<T>
): Iterable<T> {
  for (const value of iterable)
    if (predicateFn(value))
      yield value;
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

const partitionKeys = <KVP extends [any, any]>([key]: KVP): KVP[0] => key;
const partitionValues = <KVP extends [any, any]>([, value]: KVP): KVP[1] => value;

/**
 * Creates an iterable that groups key-value-pairs when they share the same key.
 */
export const partition = function*<KVP extends [any, any]>(
  iterable: Iterable<KVP>
): Iterable<PartitionResult<KVP>> {
  for (const [key, values] of groupBy(iterable, partitionKeys)) {
    const group = values.map(partitionValues);
    // @ts-ignore - This is correct.
    yield [key, group];
  }
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
  value: T,
  iterable: Iterable<T>
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
 * Calls the given function on each element of `iterable` and yields the
 * values, unchanged.
 */
export const tapEach = function*<T>(
  iterable: Iterable<T>,
  tapFn: TapFn<T>
): Iterable<T> {
  // Clone an array in case the reference may be mutated by the `tapFn`.
  const safedIterable: Iterable<T> = Array.isArray(iterable) ? [...iterable] : iterable;
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
function chain(): ChainComposition<[]>;
function chain(iterable?: any) {
  iterable = iterable ?? [];
  return {
    map: (transformFn) => chain(mapIter(iterable, transformFn)),
    flatten: () => chain(flatten(iterable)),
    filter: (predicateFn) => chain(filterIter(iterable, predicateFn)),
    collect: (collectFn) => chain(collectIter(iterable, collectFn)),
    concat: (...others) => chain(concat(iterable, ...others)),
    thru: (transformFn) => chain(transformFn(iterable)),
    tap: (tapFn) => chain(tapEach(iterable, tapFn)),
    tapAll: (tapFn) => chain(tapAll(iterable, tapFn)),
    value: (xformFn?: TransformFn<any, any>) => xformFn ? xformFn(iterable) : iterable,
    toArray: () => [...iterable],
    exec: () => { for (const _ of iterable); }
  };
};

export { chain };