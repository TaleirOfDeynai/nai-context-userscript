declare namespace Webpack {
  type ExportsObject = { [exportKey: string]: any };

  interface ModuleInstance {
    id: string | number;
    loaded: boolean;
    exports: ExportsObject
  }

  interface WebpackRequireFn {
    <T extends ExportsObject = ExportsObject>(id: string | number): T;
    /** Obfuscated from `moduleFactories`. */
    m: Record<string | number, ModuleFactory>;
  }
  
  type ModuleFactory = (
    module: ModuleInstance,
    exports: ExportsObject,
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

// Fixing bad `conforms` module typings.
declare module "lodash/conforms" {
  import _ = require("lodash");
  export = _.conforms;
}

declare module "fast-levenshtein" {
  interface Options {
    /** Use `Intl.Collator` for locale-sensitive string comparison. */
    useCollator?: Intl.Collator;
  }

  const Levenshtein: {
    get: (
      /** The first string. */
      str1: string,
      /** The second string. */
      str2: string,
      /** Additional options. */
      options?: Options
    ) => number;
  };
  export = Levenshtein;
}