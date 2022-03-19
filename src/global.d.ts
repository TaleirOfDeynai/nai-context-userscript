declare namespace Webpack {
  interface ModuleInstance {
    id: string | number;
    loaded: boolean;
    exports: Object
  }

  interface WebpackRequireFn {
    <T = unknown>(id: string | number): T;
    /** Obfuscated from `moduleFactories`. */
    m: Record<string | number, ModuleFactory>;
  }
  
  type ModuleFactory = (
    module: ModuleInstance,
    exports: any,
    webpackRequire: WebpackRequireFn
  ) => any;

  type ChunkDef = [
    chunkIds: Array<string | number>,
    moreModules: Record<string | number, ModuleFactory>,
    runtime?: (webpackRequire: WebpackRequireFn) => any
  ];

  class ChunkStore extends Array<ChunkDef> {
    // Only allows one item at a time.
    push(def: ChunkDef): number;
  }
}

declare interface Window {
  webpackChunk_N_E: Webpack.ChunkStore;
}