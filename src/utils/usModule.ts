import { callOnce } from "./callOnce";
import { WrappedRequireFn } from "../require";

type UserScriptModule<T> = (require: WrappedRequireFn) => T;

/**
 * A special variant of {@link callOnce} for user-script modules.
 * 
 * This just helps infer some types and tighten things up just a little.
 */
export function usModule<T>(moduleFactory: UserScriptModule<T>): UserScriptModule<T> {
  return callOnce(moduleFactory);
}