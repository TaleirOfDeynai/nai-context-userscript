let _chunkStore = undefined;
let lastPushFn = undefined;

Object.defineProperty(unsafeWindow, "webpackChunk_N_E", {
  get() {
    return _chunkStore;
  },
  set(webpackChunk_N_E) {
    if (webpackChunk_N_E.push !== lastPushFn) {
      const origPush = webpackChunk_N_E.push;
      function wrappedPush(...args) {
        console.dir(args);
        return origPush.apply(webpackChunk_N_E, args);
      }

      lastPushFn = wrappedPush;
      webpackChunk_N_E.push = wrappedPush;
    }

    _chunkStore = webpackChunk_N_E;
  }
});