/**
 * Allows the given function to be called only once.  Only the first arguments
 * provided will be used; any further calls will always return the result of
 * the first call.
 */
export function callOnce<TFn extends (...args: any[]) => any>(fn: TFn): TFn {
  let result: ReturnType<TFn>;
  let didCall = false;

  // @ts-ignore - Dumb, shitty, stupid TS.  FFS, do your job properly.
  return (...args: Parameters<TFn>): ReturnType<TFn> => {
    if (didCall) return result;
    didCall = true;
    result = fn(...args);
    return result;
  };
}