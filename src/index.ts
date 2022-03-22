import { dew } from "./utils/dew";
import { enableLogging } from "./utils/logging";
import { makeWrappedRequire, notifyToConsole } from "./require";
import injectors, { Injector } from "./injectors";

enableLogging();

const injectorMap = dew(() => {
  const result = new Map<string | number, Set<Injector>>();
  for (const injector of injectors) {
    const injSet = result.get(injector.chunkId) ?? new Set();
    injSet.add(injector);
    result.set(injector.chunkId, injSet);
  }
  return result;
});

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
          const injSet = injectorMap.get(chunkId);
          if (!injSet) continue;

          for (const injector of injSet) {
            // For debug, we'll include Webpack IDs right into the identifier.
            const identity = `${injector.name}@${injector.chunkId}:${injector.moduleId}`;

            if (!(injector.moduleId in moreModules)) {
              notifyToConsole([
                `Failed to locate the module in expected chunk for ${identity};`,
                "the injection was aborted."
              ].join(" "));
              continue;
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
              try {
                module.exports = injector.inject(module.exports, module, wrappedRequire) ?? exports;
              }
              catch(error) {
                // In case of an error, abort injection so the app doesn't crash.
                notifyToConsole(
                  [
                    `An error was thrown while injecting ${identity};`,
                    "the injection was aborted."
                  ].join(" "),
                  error
                );
              }
            }

            // Insert the altered module factory in place of the original.
            moreModules[injector.moduleId] = injectedModule;
            // We really only want to inject once.
            injSet.delete(injector);

            console.log(`Injector \`${identity}\` applied its patch.`);
          }
        }

        return origPush.apply(webpackChunk_N_E, [chunkDef, ...restArgs]);
      }

      lastPushFn = wrappedPush;
      webpackChunk_N_E.push = wrappedPush;
    }

    _chunkStore = webpackChunk_N_E;
  }
});

// NovelAI uses Sentry.  Set a value on `window` that can be detected
// to disable Sentry or tag telemetry as coming from a modified client.
Object.defineProperty(unsafeWindow, "__USERSCRIPT_ACTIVE", {
  value: true,
  writable: true,
  configurable: true
});