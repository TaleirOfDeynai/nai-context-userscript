export type PredicateFn<T> = (value: T) => boolean;

/** Inverts a predicate function. */
export const invertPredicate = <T>(predicateFn: PredicateFn<T>) =>
  (value: T) => !predicateFn(value);