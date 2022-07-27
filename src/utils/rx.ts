import { Subject, Observable } from "rxjs";

/** Re-export everything so I only need to import once. */
export * from "rxjs";
/** And this too! */
export { eachValueFrom } from "rxjs-for-await";

export type DeferredOf<T>
  = T extends Promise<infer U> ? Observable<U>
  : never;

/**
 * A sort of stack buffer.  It emit elements only when something has called
 * {@link StackSubject.pop pop()}, allowing you to rate limit but also
 * prioritize the latest values.
 * 
 * Even though this will multicast by nature of being a {@link Subject},
 * anything can call {@link StackSubject.pop pop()} to trigger the next
 * emission.  It is recommended to limit ownership of this method to
 * properly implement rate-limiting.
 */
export class StackSubject<T> extends Subject<T> {
  /** When `true`, the stack should emit its next value. */
  #primed: boolean;
  /** The internal stack. */
  #stack: T[];

  constructor(primed: boolean = false) {
    super();

    this.#stack = [];
    this.#primed = primed;
  }

  /**
   * Provides a value to the stack.  If the subject is currently primed,
   * it will immediately emit the value and leave the primed state.
   */
  next(value: T) {
    if (this.#primed) {
      super.next(value);
      this.#primed = false;
      return;
    }
    this.#stack.push(value);
  }

  /** Just an alias of `next` with stack semantics. */
  push(value: T) {
    this.next(value);
  }

  /**
   * Tells this subject some consumer is ready to receive the latest
   * stack value.  If it has none to emit, it will transition to its
   * primed state and will immediately emit the next value it receives.
   */
  pop() {
    if (this.#stack.length === 0) this.#primed = true;
    else super.next(this.#stack.pop() as T);
  }
}