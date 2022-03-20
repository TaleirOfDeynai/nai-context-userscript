import { makeWrappedRequire } from "./require";
import injectors, { Injector } from "./injectors";

const injectorMap: Map<string | number, Injector>
  = new Map(injectors.map((i) => [i.chunkId, i] as const));

let _chunkStore: Webpack.ChunkStore | undefined = undefined;
let lastPushFn: Webpack.ChunkStore["push"] | undefined = undefined;

// `unsafeWindow` is needed to properly intercept the Webpack chunk
// storage so its `push` method can be monkey-patched for injection.
// We want to manipulate the modules before they get a chance to be
// destructured into private variables of other modules.

Object.defineProperty(unsafeWindow, "webpackChunk_N_E", {
  get() {
    return _chunkStore;
  },
  set(webpackChunk_N_E: Webpack.ChunkStore) {
    if (webpackChunk_N_E.push !== lastPushFn) {
      // Webpack replaces `push` with a special version used by the chunks.
      const origPush = webpackChunk_N_E.push;

      function wrappedPush(chunkDef: Webpack.ChunkDef, ...restArgs) {
        const [chunkIds, moreModules] = chunkDef;

        for (const chunkId of chunkIds) {
          const injector = injectorMap.get(chunkId);
          if (!injector) continue;

          if (!(injector.moduleId in moreModules)) {
            console.warn(`Failed to locate module ${injector.moduleId} in chunk ${injector.chunkId}.`);
            break;
          }

          const moduleFactory = moreModules[injector.moduleId];
          function injectedModule(
            module: Webpack.ModuleInstance,
            exports: Webpack.ExportsObject,
            webpackRequire: Webpack.WebpackRequireFn
          ) {
            // Call the original factory to populate the vanilla module.
            moduleFactory.call(this, module, exports, webpackRequire);
            const wrappedRequire = makeWrappedRequire(webpackRequire);
            // @ts-ignore - It's assigned to a `const` and then checked to ensure
            // it isn't `undefined`.  IT CAN NEVER BE NOT DEFINED, TYPESCRIPT!
            // A CAPTURED CONSTANT VARIABLE IS NOT GOING TO CHANGE ITS VALUE
            // WITHOUT MEMORY CORRUPTION BEING INVOLVED!
            module.exports = injector.inject(module.exports, module, wrappedRequire) ?? exports;
          }

          // Insert the altered module factory in place of the original.
          moreModules[injector.moduleId] = injectedModule;
          // We really only want to inject once.
          injectorMap.delete(chunkId);

          console.log(`Injector \`${injector.name}\` patched \`${injector.chunkId}:${injector.moduleId}\` successfully!`)
          break;
        }

        return origPush.apply(webpackChunk_N_E, [chunkDef, ...restArgs]);
      }

      lastPushFn = wrappedPush;
      webpackChunk_N_E.push = wrappedPush;
    }

    _chunkStore = webpackChunk_N_E;
  }
});