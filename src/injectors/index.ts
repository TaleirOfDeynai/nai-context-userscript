import type { WrappedRequireFn } from "../require";
import * as ContextBuilder from "./ContextBuilder";

export interface Injector {
  name: string;
  chunkId: number;
  moduleId: number;
  inject(
    exports: any,
    module: Webpack.ModuleInstance,
    require: WrappedRequireFn
  ): any;
}

/** Add additional injectors here. */
const injectors: Injector[] = [
  ContextBuilder
];

export default injectors;