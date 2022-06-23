import { assert } from "./assert";
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
  // Using ` Object.create` on a function causes it to no longer
  // be callable for some reason.  I dunno.  I guess the hidden
  // `[[Call]]` property is not inheritable for some reason.
  assert("Cannot proto-extend a function.", typeof proto !== "function");

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