// ==UserScript==
// @name        nai-context-userscript
// @description Userscript to inject a custom context builder into NovelAI.
// @namespace   github.com/TaleirOfDeynai
// @include     https://novelai.net
// @include     https://novelai.net/*
// @run-at      document-idle
// @version     0.0.1
// @homepage    https://github.com/TaleirOfDeynai/nai-context-userscript
// @author      TaleirOfDeynai
// @license     UNLICENSE
// @grant       unsafeWindow
// ==/UserScript==

/*
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org/>*/


(function () {
    'use strict';

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

})();
//# sourceMappingURL=bundle.user.js.map
