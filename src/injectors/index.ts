import type { WrappedRequireFn } from "../require";
import * as ContextBuilder from "./ContextBuilder";
import * as LoreEntryHelpers from "./LoreEntryHelpers";

export interface InjectFn {
  (
    /** The `exports` object for the module. */
    exports: any,
    /** The Webpack module instance, with additional data. */
    module: Webpack.ModuleInstance,
    /** A wrapped `require` function to import Webpack modules with. */
    require: WrappedRequireFn
  ): any;
}

export interface Injector {
  /** The name of the injector, for debug reports. */
  name: string;
  /** The chunk ID of containing the module. */
  chunkId: number;
  /** The ID of the module. */
  moduleId: number | string;
  /** The function to call to perform the injection. */
  inject: InjectFn;
}

/** Add additional injectors here. */
const injectors: Injector[] = [
  ContextBuilder,
  LoreEntryHelpers
];

export default injectors;