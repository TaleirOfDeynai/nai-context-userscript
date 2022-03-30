export type PredicateFn<T> = (value: T) => boolean;

/** The identity function. */
export const ident = <T>(value: T) => value;

/** Inverts a predicate function. */
export const invertPredicate = <T>(predicateFn: PredicateFn<T>) =>
  (value: T) => !predicateFn(value);