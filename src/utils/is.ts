import { dew } from "./dew";

type MaybeIterable<T> = T extends Iterable<any> ? T : never;
type MaybeElement<T> = T extends Iterable<infer U> ? U : never;

declare global {
  interface ArrayConstructor {
    // Makes the standard `isArray` slightly more intelligent when it's
    // starting from some kind of iterable.
    isArray<T>(arg: Iterable<T>): arg is T[];
    // @ts-ignore - And this one deals with union types.
    isArray<T extends MaybeIterable<any>>(arg: T): arg is MaybeElement<T>[];
  }
}

export type TypePredicate<TOut extends TIn, TIn = unknown>
  = (value: TIn) => value is TOut;

export type TypePredicateOf<TOut>
  = <TIn>(value: TIn) => value is TIn & TOut;

export type Thenable<T> = Pick<Promise<T>, "then">;

export const isUndefined = (value: any): value is undefined =>
  typeof value === "undefined";

export const isInstance = <T>(value: T): value is Exclude<T, undefined | null> =>
  value != null;

export const isError = (value: any): value is Error =>
  value instanceof Error;

export const isFunction = (value: any): value is Function =>
  typeof value === "function";

export const isObject = (value: any): value is Object =>
  value && typeof value === "object";

export const isArray = Array.isArray;

/**
 * Tests if something is an iterable collection.
 * 
 * Even though strings are in-fact iterable, this function will return
 * `false` for them, as too often I would do something terrible with them.
 */
export const isIterable = (value: any): value is Iterable<any> =>
  isObject(value) && isFunction(value[Symbol.iterator]);

export const isString = (value: any): value is string =>
  typeof value === "string";

export const isNumber = (value: any): value is number =>
  typeof value === "number";

export const isBoolean = (value: any): value is boolean =>
  typeof value === "boolean";

export const isPojo = dew(() => {
  const POJO_PROTOS = Object.freeze([Object.prototype, null]);
  return (value: any): value is Object => {
    if (!isObject(value)) return false;
    return POJO_PROTOS.includes(Object.getPrototypeOf(value));
  };
});

export const isThenable = (value: any): value is Thenable<unknown> => {
  if (value instanceof Promise) return true;
  return isObject(value) && isFunction(value.then);
};