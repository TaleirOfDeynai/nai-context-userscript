import * as rx from "rxjs";

// Because this module is just going to export operators, instead of
// importing multiple things, just re-export all of RxJS's operators.
export * from "rxjs/operators";

/** Emits an `undefined` value when `source` completes. */
export function whenCompleted(source: rx.Observable<unknown>): rx.Observable<void> {
  return new rx.Observable<void>((subscriber) => {
    return source.subscribe({
      complete: () => {
        subscriber.next();
        subscriber.complete();
      },
      error: (error) => {
        subscriber.error(error);
      }
    })
  })
}