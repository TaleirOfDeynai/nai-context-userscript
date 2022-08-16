import { dew } from "@utils/dew";
import { makeWrappedRequire, notifyToConsole } from "./require";
import injectors, { Injector } from "./injectors";

import type { UndefOr } from "@utils/utility-types";

const injectorMap = dew(() => {
  const result = new Map<string | number, Set<Injector>>();
  for (const injector of injectors) {
    const injSet = result.get(injector.chunkId) ?? new Set();
    injSet.add(injector);
    result.set(injector.chunkId, injSet);
  }
  return result;
});

let _chunkStore: UndefOr<Webpack.ChunkStore> = undefined;
let lastPushFn: UndefOr<Webpack.ChunkStore["push"]> = undefined;

// `unsafeWindow` is needed to properly intercept the Webpack chunk
// storage so its `push` method can be monkey-patched for injection.
// We want to manipulate the modules before they get a chance to be
// destructured into private variables of other modules.

// In case Webpack already loaded, store the current value.
const initChunk = unsafeWindow.webpackChunk_N_E as UndefOr<Webpack.ChunkStore>;

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

// If Webpack beat us to the punch, set the old value back to the property
// to perform the bootstrap and hope for the best.  In some soft-refresh
// scenarios, Webpack can beat the user-script, but we have so-far managed
// to catch all the modules as they load so we can inject.  This feels
// a bit like a roll-of-the-dice, though...
if (initChunk) unsafeWindow.webpackChunk_N_E = initChunk;

// NovelAI uses Sentry.  Set a value on `window` that can be detected
// to disable Sentry or tag telemetry as coming from a modified client.
Object.defineProperty(unsafeWindow, "__USERSCRIPT_ACTIVE", {
  value: true,
  writable: true,
  configurable: true
});