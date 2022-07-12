import usConfig from "@config";

import type { WrappedRequireFn } from "../require";

export type UserScriptModuleFactory<T extends {}> =
  (require: WrappedRequireFn, exports: {}) => T;

export type UserScriptModule<T extends {}> =
  (require: WrappedRequireFn) => Readonly<T>;

/**
 * A utility to produce modules that rely on {@link WrappedRequireFn}.
 * 
 * You are required to return the `exports` object, so use {@link Object.assign}
 * to assign your exported values to it.
 */
export function usModule<T extends {}>(
  moduleFactory: UserScriptModuleFactory<T>
): UserScriptModule<T> {
  const exports = {} as any;
  let begunInit = false;
  const moduleBuilder = (wrappedRequire) => {
    // In order to avoid cyclical calls, we'll only call the factory once.
    // It is required to return the same `exports` object that is given, meaning
    // this object will eventually be populated.  This has all the same problems
    // that Node modules have, being unable to statically initialize a module.
    if (begunInit) return exports;

    begunInit = true;
    if (usConfig.inTestEnv) {
      // In test environments, mock functions can screw with the modules.
      const mocks = wrappedRequire._mocks?.get(moduleBuilder);
      const module = moduleFactory(wrappedRequire, exports);
      const result = mocks?.(module) ?? module;
      // Still needs to return the module, though.
      if (result === exports) return Object.freeze(result);
    }
    else {
      const result = moduleFactory(wrappedRequire, exports);
      if (result === exports) return Object.freeze(result);
    }

    throw new Error("A user-script module must return the given `exports` object.");
  };

  return moduleBuilder;
}