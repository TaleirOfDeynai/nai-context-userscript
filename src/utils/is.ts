import { dew } from "./dew";

export type TypePredicate<T> = (value: any) => value is T;

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
  const POJO_PROTOS = [Object.prototype, null];
  return (value: any): value is Object => {
    if (!isObject(value)) return false;
    return POJO_PROTOS.includes(Object.getPrototypeOf(value));
  };
});