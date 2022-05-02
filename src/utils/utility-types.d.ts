/** May be a value, or may not be. */
export type Maybe<T> = T | null | undefined;

/** Either a value or `undefined`; when `null` is forbidden. */
export type UndefOr<T> = T | undefined;

/** Either a value or `null`; when `null` has some extra meaning. */
export type NullOr<T> = T | null;

/** Gets the types of all possible property values on an object. */
export type AnyValueOf<T extends {}> = T[keyof T];

/** Produces tuple types representing property key-value pairs for an object. */
export type KvpsOf<T extends {}>
  = (T extends any ? { [K in keyof T]: [K, T[K]] } : never) extends
    Record<any, infer KVP> ? KVP : never;

/**
 * A generic interface for a {@link Map} constrained by some interface being
 * used as a source for key-to-value type mappings.
 */
// @ts-ignore - TS will work it out correctly with a concrete `T`.
export interface ConstrainedMap<T extends {}>
extends Map<keyof T, AnyValueOf<T>> {
  get<K extends keyof T>(key: K): UndefOr<T[K]>;
  set<K extends keyof T>(key: K, value: T[K]): this;
  entries(): IterableIterator<KvpsOf<T>>;
  [Symbol.iterator](): IterableIterator<KvpsOf<T>>;
}