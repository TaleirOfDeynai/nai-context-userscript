import * as ContextBuilder from "./contextBuilder";

export interface Injector {
  name: string;
  chunkId: number;
  moduleId: number;
  inject(
    exports: any,
    module: Webpack.ModuleInstance,
    wpRequire: Webpack.WebpackRequireFn
  ): any;
}

/** Add additional injectors here. */
const injectors: Injector[] = [
  ContextBuilder
];

export default injectors;