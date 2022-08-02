import { assert } from "./assert";
import { callOnce } from "./callOnce";
import { chain, toPairs, fromPairs } from "./iterables";

type ExtendObj<T extends {}, U extends {}> = T & Readonly<{
  [K in keyof (T & U)]: K extends keyof U ? U[K] : K extends keyof T ? T[K] : never;
}>;

/**
 * A combination of {@link Object.create}, {@link Object.assign},
 * and {@link Object.freeze}.  Takes the `proto` object and instantiates
 * a new object with it as the prototype, assigns `extensions` to it,
 * freezes the new object to make it immutable, and returns it.
 */
export function protoExtend(proto: Function, extensions: any): unknown;
export function protoExtend<T extends {}, U extends {}>(proto: T, extensions: U): ExtendObj<T, U>;
export function protoExtend(proto: any, extensions: any): any {
  // Using `Object.create` on a function causes it to no longer
  // be callable for some reason.  I dunno.  I guess the hidden
  // `[[Call]]` property is not inheritable for some reason.
  assert("Cannot proto-extend a function.", typeof proto !== "function");

  // Why not just `Object.assign` after the `Object.create`?
  // Because if some property exists on `proto` and it's frozen
  // or not writable, the assign will prioritize that property
  // and fail.  But, since we're using it as a prototype, we can
  // override those properties with new properties on the object
  // instance.
  const propMap = chain(toPairs(extensions))
    .map(([k, v]) => {
      const descriptor: PropertyDescriptor = {
        value: v,
        enumerable: true,
        writable: false
      };
      return [k, descriptor] as const;
    })
    .value((iter) => fromPairs(iter));

  return Object.freeze(Object.create(proto, propMap));
};

type LazyRecord = Record<string, () => unknown>;
type LazyObject<T extends LazyRecord> = {
  [K in keyof T]: ReturnType<T[K]>;
};

/**
 * Given an object with properties that have an arity-0 function as their
 * value, returns a new object with those properties replaced with
 * the result of calling the function.
 * 
 * Each function of a property will only ever be called once.
 */
export const lazyObject = <T extends LazyRecord>(proto: T): LazyObject<T> => {
  const obj = {};
  for (const [k, v] of Object.entries(proto))
    Object.defineProperty(obj, k, { get: callOnce(v) });
  return Object.freeze(obj) as any;
};