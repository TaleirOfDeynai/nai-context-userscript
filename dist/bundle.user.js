// ==UserScript==
// @name        nai-context-userscript
// @description Userscript to inject a custom context builder into NovelAI.
// @namespace   github.com/TaleirOfDeynai
// @include     https://novelai.net
// @include     https://novelai.net/*
// @run-at      document-start
// @version     1.0.0
// @homepage    https://github.com/TaleirOfDeynai/nai-context-userscript
// @author      TaleirOfDeynai
// @license     MIT
// @grant       unsafeWindow
// @grant       GM.notification
// ==/UserScript==

/*
MIT License

Copyright (c) 2022 TaleirOfDeynai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/


(function () {
    'use strict';

    /** IIFE helper. */
    const dew = (fn) => fn();

    const DEFAULT_CHECK = () => true;
    const cache = new Map();
    class ModuleDef {
        /** A readable name given to this module. */
        get name() {
            return this.constructor.name;
        }
    }
    function makeWrappedRequire(webpackRequire) {
        function wrappedRequire(moduleDef) {
            const { name, moduleId, expectedExports, mapping } = moduleDef;
            const identifier = `${name}@${moduleId}`;
            const fromCache = cache.get(moduleId);
            if (fromCache)
                return fromCache;
            const theModule = webpackRequire(moduleId);
            if (typeof theModule !== "object") {
                throw new Error([
                    `Module \`${identifier}\` was requested via a wrapped module definition,`,
                    "but the module could not be resolved through Webpack."
                ].join(" "));
            }
            const passthruKeys = new Set(Object.getOwnPropertyNames(theModule));
            if (passthruKeys.size !== expectedExports) {
                throw new Error([
                    `Expected module \`${identifier}\` to have ${expectedExports} exports,`,
                    `but the actual count was ${passthruKeys.size}.`
                ].join(" "));
            }
            const wrappedModule = {};
            for (const [kSrc, v] of Object.entries(mapping)) {
                if (!v)
                    continue;
                const [kTrg, checkVal = DEFAULT_CHECK] = v;
                passthruKeys.delete(kSrc);
                // Normalize the safety check into a function.
                const checkFn = typeof checkVal === "function" ? checkVal
                    : (val) => typeof val === checkVal;
                // Sanity check; the export exists, right?
                if (!(kSrc in theModule)) {
                    throw new Error([
                        `Expected export \`${kSrc}\` to be mappable to \`${kTrg}\``,
                        `in module \`${identifier}\`, but the export was not found;`,
                        "were the chunks updated?"
                    ].join(" "));
                }
                // If we have a safety checker, do the check.
                if (!checkFn(theModule[kSrc], kSrc)) {
                    throw new Error([
                        `Expected export \`${kSrc}\` to be mappable to \`${kTrg}\``,
                        `in module \`${identifier}\`, but the export failed`,
                        "its safety check."
                    ].join(" "));
                }
                Object.defineProperty(wrappedModule, kTrg, {
                    get() { return theModule[kSrc]; }
                });
            }
            // Any unmapped exports are passed through transparently.
            for (const kSrc of passthruKeys) {
                Object.defineProperty(wrappedModule, kSrc, {
                    get() { return theModule[kSrc]; }
                });
            }
            cache.set(moduleId, wrappedModule);
            return wrappedModule;
        }
        return Object.assign(wrappedRequire, { raw: webpackRequire });
    }
    const problemDefaults = {
        message: "An error occurred that may prevent the user-script from working.",
        title: "Context User-Script Problem",
        logToConsole: []
    };
    const asIterable = (value) => {
        if (value == null)
            return [];
        if (typeof value === "string")
            return [value];
        if (typeof value[Symbol.iterator] === "function")
            return value;
        return [value];
    };
    let didNotifyOfProblem = false;
    /**
     * Call whenever there's an issue that likely means the user-script is in
     * a bad state; lets the user know it is probably not working correctly.
     *
     * In order to ensure spam does not occur, only one notification will ever
     * be sent.  It will still log out anything given in
     * {@link ProblemStruct.logToConsole}.
     */
    function notifyOfProblem(problem) {
        // Normalize the problem struct.
        const theProblem = (() => {
            if (typeof problem !== "string")
                return problem;
            return { message: problem };
        })();
        const { message, title, logToConsole } = Object.assign({}, problemDefaults, theProblem);
        if (!didNotifyOfProblem) {
            didNotifyOfProblem = true;
            GM.notification([message, "Check the dev console for more information."].join("\n\n"), title);
        }
        console.warn(message);
        for (const item of asIterable(logToConsole))
            console.error(item);
    }
    /**
     * A shorthand version of {@link notifyOfProblem} that logs technical details
     * to console and notifies with a generic "it broke" message to the user.
     */
    function notifyToConsole(...logToConsole) {
        notifyOfProblem({ logToConsole });
    }

    /** Configuration options affecting activation. */
    const activation = {
        /**
         * The vanilla activation checker can be replaced with one that
         * uses the same cache as the custom context-builder.  In cases
         * where NovelAI does its own checks outside of the context-builder,
         * this can be used to avoid the overhead of re-parsing the matcher
         * and can even use the cached results from previous runs when
         * possible.
         */
        vanillaIntegration: true,
        /**
         * Vanilla NovelAI removes comments before keyword searching is
         * performed.  If lorebook keywords could match text in comments,
         * they could be used to gain more control over cascade activation
         * by matching unusual text that you wouldn't want inserted into
         * the story.
         *
         * If this is set to `true`, comments will be retained during the
         * activation phase and removed during the assembly phase.
         *
         * Note that this won't work well with key-relative insertion,
         * since the key-relative entries need to be able to find a keyword
         * match in the partially assembled context; if it was in a removed
         * comment, that will be impossible.
         */
        searchComments: true
    };
    /** Configuration options affecting the story entry. */
    const story = {
        /**
         * Vanilla NovelAI includes the prefix and suffix of entries
         * for keyword searches during cascade activation, but during
         * story activation, the prefix and suffix are not included.
         *
         * If this is set to `true`, the story entry will be treated like
         * any other entry and its prefix and suffix will be searched.
         *
         * Note: this is a little more complicated, since NovelAI
         * (accidentally?) includes the story in cascade activation, so in
         * the end, cascading entries would have activated off its prefix
         * and suffix if they failed to activate off the story text alone.
         *
         * This is probably somewhat of a heisenbug waiting to happen.
         */
        standardizeHandling: true
    };
    /** Configuration options affecting lorebook features. */
    const lorebook = {
    /** Nothing here at the moment. */
    };
    /** Configuration options relating to the selection phase, in general. */
    const selection = {
        /**
         * Defines how to sort entries into formal insertion order.
         *
         * Due to all the concurrency in this user-script, entries quickly get
         * rearranged and shuffled, sometimes in non-deterministic ways.  In
         * order to restore determinism, the entries get sorted prior to the
         * assembly phase.
         *
         * This array allows you to configure how the entries are to be sorted
         * back into a stable order.  The order you provide sorter keys in is
         * the order of priority, so if `"budgetPriority"` comes before
         * `"reservation"`, when two entries are equal by their budget priority,
         * the tie will then be broken by sorting on whether the entry has a
         * reservation or not.
         *
         * The allowed sorters are found {@link SorterKey here}.
         *
         * To have vanilla style ordering, you should structure as so:
         * - `"budgetPriority"`
         * - `"contextGroup"`
         * - `"reservation"`
         * - ...then any other sorters you'd like to apply.
         *
         * The context builder will still work, regardless of what you throw
         * at it, but it won't work as expected unless you follow the above.
         *
         * Note: the `"storyKeyOrder"` sorter mimics a secret vanilla feature
         * when {@link LC.orderByKeyLocations orderByKeyLocations} is enabled
         * in the lorebook config, which will order entries by the position
         * of the latest keyword match in the story.  This currently can only
         * be enabled by exporting the lorebook, adding the setting, and
         * re-importing it.
         *
         * For proper NovelAI behavior, you should make sure this sorter is
         * included in the array as well.
         *
         * Note: the sorters of `"naturalByType"` and `"naturalByPosition"` are
         * special and will be ignored if used here.  These are the fail-safe
         * sorters and help to make this user-script behave as NovelAI does.
         */
        insertionOrdering: [
            "budgetPriority",
            "selectionIndex",
            "contextGroup",
            "reservation",
            "activationEphemeral",
            "activationForced",
            "activationStory",
            "storyKeyOrder",
            "cascadeFinalDegree",
            "cascadeInitDegree"
        ]
    };
    /** Configuration options relating to sub-context assembly. */
    const subContext = {
        /**
         * Vanilla NovelAI pre-processes sub-contexts prior to final assembly,
         * which involves separating all the lorebook entries of a category
         * from the root context and assembling them into a new mega-entry,
         * which is then inserted into the root context.
         *
         * If this is set to `true`, a different strategy will be used where
         * all entries of a category will not be separated from other entries
         * and will be inserted into the root context according to their
         * insertion order (AKA `budgetPriority`), but they will be anchored
         * to a group positioned according to the sub-context's settings.
         *
         * This can allow for more flexibility in budgeting the context;
         * entries of the sub-context will only be inserted if entries that
         * do not belong to the sub-context have left room for it at insertion
         * time.
         *
         * Additionally, this makes entries work more consistently; insertion
         * priority works the same for all entries and only how the entry is
         * positioned changes.  You don't need to consider which "insertion
         * priority" is important when comparing two entries.
         *
         * This has performance implications that will vary depending on how
         * the lorebook is designed.
         * - This option can be faster if you have a lot of sub-contexts
         *   and the majority of their pre-assembled text would end up trimmed
         *   out when inserted into the root context.  That is, time is not
         *   wasted trimming down text of the sub-context which would
         *   ultimately be discarded anyways.
         * - This option can be slower if the lorebook is budgeted with these
         *   sub-contexts in mind.  The vanilla behavior of assembling the
         *   sub-contexts in isolation can be done concurrently, which results
         *   in better background worker utilization.
         */
        groupedInsertion: true
    };
    /**
     * These options enable different entry selection strategies that affect
     * what entries are ultimately included in the context.
     *
     * Vanilla NovelAI follows {@link CC.budgetPriority insertion priority},
     * inserting as many entries as possible in this order.  While simple and
     * easy to understand, larger lorebooks have an extremely difficult time
     * budgeting the context such that a good spread of information is
     * provided to the AI.  When too many entries activate, it is hard to stop
     * the context from being saturated with a single dominant topic.
     *
     * But, all the other stuff that activated related to other topics are
     * important too; you want those to still get representation.  Unfortunately,
     * NovelAI doesn't have any options available for dealing with entry
     * over-selection besides sub-contexts, and they don't really solve the
     * problem (as a sub-context can itself be over-selected).
     *
     * These options enable weighted-random selection, which groups entries
     * into small pools and then randomly picks from them based on how fitting
     * the entry appears to be for the current story.
     *
     * Weighted-randomness is not applied in the following cases:
     * - Entries that are {@link LEC.forceActivation always enabled}.
     * - Ephemeral entries.
     *
     * These entries will always be selected first, before any random selection
     * is applied within a group.
     *
     * Please note, selection order does not correspond to insertion order.
     * Entries can be selected in any order but they must be inserted in
     * the order specified by {@link CC.budgetPriority insertion priority}.
     */
    const weightedRandom = {
        /**
         * Enables the weighted-random selection strategy.
         */
        enabled: true,
        /**
         * The weighting function to use in scoring each entry.
         *
         * The weighting functions are applied in order, so multipliers will
         * affect only the score up to that point.  You can group weighting
         * functions together in sub-arrays:
         *
         * ```json
         * [
         *   ["storyCount", "searchRange"],
         *   "cascadeCount"
         * ]
         * ```
         *
         * The result of the group will be added to any previous score.
         *
         * The allowed weighers are found {@link WeigherKey here}.
         */
        weighting: [
            ["storyCount", "searchRange"],
            "cascadeCount"
        ],
        /**
         * Defines the the criteria for ordering and grouping entries into
         * selection groups.  All entries that are found to be equal to one
         * another will be grouped.
         *
         * These groups are then selected from until exhausted.
         *
         * This uses the same sorters as {@link selection.insertionOrdering}
         * and the allowed sorters are found {@link SorterKey here}.
         */
        selectionOrdering: [
            "budgetPriority"
        ]
    };
    /** Configuration options relating to context assembly. */
    const assembly = {
        /**
         * When one entry wants to insert into another, but that just isn't
         * going to happen for some reason or another, the alternative is
         * to shunt the entry either before or after the entry that is
         * rejecting it.
         *
         * One of these options determines how that shunting happens:
         * - `"inDirection"` - If the entry to insert had a positive insertion
         *   position, it will place it after the entry.  If it was negative,
         *   it will be placed before it.
         * - `"nearest"` - Always shunts the entry to the nearest end.
         */
        shuntingMode: "inDirection"
    };
    /** Configuration options relating to context post-processing. */
    const postProcess = {
        /**
         * When `true`, after all entries have been inserted into the context,
         * all key-activated and cascade-activated entries that were inserted
         * adjacent to each other will be formed into a group.
         *
         * Within each group, information about cascade activation will be used
         * to rearrange the group such that entries that matched other entries
         * in the group through cascade will appear after those other entries.
         *
         * The intention is to increase coherency of the context without having
         * to be concerned as much with insertion order.  Entries that introduce
         * a topic should appear before entries that elaborate on that topic
         * (assuming that the keywords identify topics).
         *
         * - Fragments from always-enabled, ephemeral, and content (story, A/N,
         *   memory) entries will break up groups.
         * - Sub-contexts will behave as a composite entry that has the aggregate
         *   activation data of all entries that make up its content.
         *   - However, entries within the sub-context may still be rearranged,
         *     in isolation from the root context.
         */
        reorderUsingCascade: false
    };
    const config$1 = {
        /** Enables debug logging for the user-script. */
        debugLogging: true,
        /**
         * When `true`, both the new and vanilla context builder will run,
         * measuring the performance of both for comparison.  This will
         * happen and the results will be reported to console even when
         * `debugLogging` is `false`.
         *
         * When `false`, the vanilla context builder will only be invoked if
         * the new one fails.
         */
        debugTimeTrial: true,
        /**
         * Whether we're in a test environment.
         *
         * See `spec-resources/_setup.cts` to see where this gets overridden.
         * This is set to `false` here rather than sniffing out for
         * `"production"` so the bundler can optimize out certain
         * branches.
         */
        inTestEnv: false,
        /** Configuration options affecting activation. */
        activation,
        /** Configuration options affecting the story entry. */
        story,
        /** Configuration options affecting lorebook features. */
        lorebook,
        /** Configuration options relating to selection. */
        selection,
        /** Configuration options relating to sub-context assembly. */
        subContext,
        /** Configuration options relating to weighted-random selection. */
        weightedRandom,
        /** Configuration options relating to context assembly. */
        assembly,
        /** Configuration options relating to context post-processing. */
        postProcess
    };

    class ContextBuilder$1 extends ModuleDef {
        constructor() {
            super(...arguments);
            this.moduleId = 47819;
            this.expectedExports = 7;
            this.mapping = {
                "AB": ["REASONS", "object"],
                "Ie": ["ContextRecorder", "function"],
                "NV": ["ContextStatus", "function"],
                "eA": ["checkLorebook", "function"],
                "jR": ["splitBySentence", "function"],
                "rJ": ["buildContext", "function"],
                "v$": ["StageReport", "function"]
            };
        }
    }
    var ContextBuilder$2 = new ContextBuilder$1();

    /******************************************************************************
    Copyright (c) Microsoft Corporation.

    Permission to use, copy, modify, and/or distribute this software for any
    purpose with or without fee is hereby granted.

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
    REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
    AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
    INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
    LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
    OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
    PERFORMANCE OF THIS SOFTWARE.
    ***************************************************************************** */

    /* global Reflect, Promise */
    var extendStatics = function (d, b) {
      extendStatics = Object.setPrototypeOf || {
        __proto__: []
      } instanceof Array && function (d, b) {
        d.__proto__ = b;
      } || function (d, b) {
        for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
      };

      return extendStatics(d, b);
    };

    function __extends(d, b) {
      if (typeof b !== "function" && b !== null) throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
      extendStatics(d, b);

      function __() {
        this.constructor = d;
      }

      d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    }
    function __awaiter(thisArg, _arguments, P, generator) {
      function adopt(value) {
        return value instanceof P ? value : new P(function (resolve) {
          resolve(value);
        });
      }

      return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }

        function rejected(value) {
          try {
            step(generator["throw"](value));
          } catch (e) {
            reject(e);
          }
        }

        function step(result) {
          result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
        }

        step((generator = generator.apply(thisArg, _arguments || [])).next());
      });
    }
    function __generator(thisArg, body) {
      var _ = {
        label: 0,
        sent: function () {
          if (t[0] & 1) throw t[1];
          return t[1];
        },
        trys: [],
        ops: []
      },
          f,
          y,
          t,
          g;
      return g = {
        next: verb(0),
        "throw": verb(1),
        "return": verb(2)
      }, typeof Symbol === "function" && (g[Symbol.iterator] = function () {
        return this;
      }), g;

      function verb(n) {
        return function (v) {
          return step([n, v]);
        };
      }

      function step(op) {
        if (f) throw new TypeError("Generator is already executing.");

        while (_) try {
          if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
          if (y = 0, t) op = [op[0] & 2, t.value];

          switch (op[0]) {
            case 0:
            case 1:
              t = op;
              break;

            case 4:
              _.label++;
              return {
                value: op[1],
                done: false
              };

            case 5:
              _.label++;
              y = op[1];
              op = [0];
              continue;

            case 7:
              op = _.ops.pop();

              _.trys.pop();

              continue;

            default:
              if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
                _ = 0;
                continue;
              }

              if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
                _.label = op[1];
                break;
              }

              if (op[0] === 6 && _.label < t[1]) {
                _.label = t[1];
                t = op;
                break;
              }

              if (t && _.label < t[2]) {
                _.label = t[2];

                _.ops.push(op);

                break;
              }

              if (t[2]) _.ops.pop();

              _.trys.pop();

              continue;
          }

          op = body.call(thisArg, _);
        } catch (e) {
          op = [6, e];
          y = 0;
        } finally {
          f = t = 0;
        }

        if (op[0] & 5) throw op[1];
        return {
          value: op[0] ? op[1] : void 0,
          done: true
        };
      }
    }
    function __values(o) {
      var s = typeof Symbol === "function" && Symbol.iterator,
          m = s && o[s],
          i = 0;
      if (m) return m.call(o);
      if (o && typeof o.length === "number") return {
        next: function () {
          if (o && i >= o.length) o = void 0;
          return {
            value: o && o[i++],
            done: !o
          };
        }
      };
      throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
    }
    function __read(o, n) {
      var m = typeof Symbol === "function" && o[Symbol.iterator];
      if (!m) return o;
      var i = m.call(o),
          r,
          ar = [],
          e;

      try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
      } catch (error) {
        e = {
          error: error
        };
      } finally {
        try {
          if (r && !r.done && (m = i["return"])) m.call(i);
        } finally {
          if (e) throw e.error;
        }
      }

      return ar;
    }
    function __spreadArray(to, from, pack) {
      if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
          if (!ar) ar = Array.prototype.slice.call(from, 0, i);
          ar[i] = from[i];
        }
      }
      return to.concat(ar || Array.prototype.slice.call(from));
    }
    function __await(v) {
      return this instanceof __await ? (this.v = v, this) : new __await(v);
    }
    function __asyncGenerator(thisArg, _arguments, generator) {
      if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
      var g = generator.apply(thisArg, _arguments || []),
          i,
          q = [];
      return i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () {
        return this;
      }, i;

      function verb(n) {
        if (g[n]) i[n] = function (v) {
          return new Promise(function (a, b) {
            q.push([n, v, a, b]) > 1 || resume(n, v);
          });
        };
      }

      function resume(n, v) {
        try {
          step(g[n](v));
        } catch (e) {
          settle(q[0][3], e);
        }
      }

      function step(r) {
        r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r);
      }

      function fulfill(value) {
        resume("next", value);
      }

      function reject(value) {
        resume("throw", value);
      }

      function settle(f, v) {
        if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]);
      }
    }
    function __asyncValues(o) {
      if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
      var m = o[Symbol.asyncIterator],
          i;
      return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () {
        return this;
      }, i);

      function verb(n) {
        i[n] = o[n] && function (v) {
          return new Promise(function (resolve, reject) {
            v = o[n](v), settle(resolve, reject, v.done, v.value);
          });
        };
      }

      function settle(resolve, reject, d, v) {
        Promise.resolve(v).then(function (v) {
          resolve({
            value: v,
            done: d
          });
        }, reject);
      }
    }
    function __classPrivateFieldGet(receiver, state, kind, f) {
      if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
      if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
      return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
    }
    function __classPrivateFieldSet(receiver, state, value, kind, f) {
      if (kind === "m") throw new TypeError("Private method is not writable");
      if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
      if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
      return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
    }

    function isFunction$4(value) {
      return typeof value === 'function';
    }

    function createErrorClass(createImpl) {
      var _super = function (instance) {
        Error.call(instance);
        instance.stack = new Error().stack;
      };

      var ctorFunc = createImpl(_super);
      ctorFunc.prototype = Object.create(Error.prototype);
      ctorFunc.prototype.constructor = ctorFunc;
      return ctorFunc;
    }

    var UnsubscriptionError = createErrorClass(function (_super) {
      return function UnsubscriptionErrorImpl(errors) {
        _super(this);

        this.message = errors ? errors.length + " errors occurred during unsubscription:\n" + errors.map(function (err, i) {
          return i + 1 + ") " + err.toString();
        }).join('\n  ') : '';
        this.name = 'UnsubscriptionError';
        this.errors = errors;
      };
    });

    function arrRemove(arr, item) {
      if (arr) {
        var index = arr.indexOf(item);
        0 <= index && arr.splice(index, 1);
      }
    }

    var Subscription = function () {
      function Subscription(initialTeardown) {
        this.initialTeardown = initialTeardown;
        this.closed = false;
        this._parentage = null;
        this._finalizers = null;
      }

      Subscription.prototype.unsubscribe = function () {
        var e_1, _a, e_2, _b;

        var errors;

        if (!this.closed) {
          this.closed = true;
          var _parentage = this._parentage;

          if (_parentage) {
            this._parentage = null;

            if (Array.isArray(_parentage)) {
              try {
                for (var _parentage_1 = __values(_parentage), _parentage_1_1 = _parentage_1.next(); !_parentage_1_1.done; _parentage_1_1 = _parentage_1.next()) {
                  var parent_1 = _parentage_1_1.value;
                  parent_1.remove(this);
                }
              } catch (e_1_1) {
                e_1 = {
                  error: e_1_1
                };
              } finally {
                try {
                  if (_parentage_1_1 && !_parentage_1_1.done && (_a = _parentage_1.return)) _a.call(_parentage_1);
                } finally {
                  if (e_1) throw e_1.error;
                }
              }
            } else {
              _parentage.remove(this);
            }
          }

          var initialFinalizer = this.initialTeardown;

          if (isFunction$4(initialFinalizer)) {
            try {
              initialFinalizer();
            } catch (e) {
              errors = e instanceof UnsubscriptionError ? e.errors : [e];
            }
          }

          var _finalizers = this._finalizers;

          if (_finalizers) {
            this._finalizers = null;

            try {
              for (var _finalizers_1 = __values(_finalizers), _finalizers_1_1 = _finalizers_1.next(); !_finalizers_1_1.done; _finalizers_1_1 = _finalizers_1.next()) {
                var finalizer = _finalizers_1_1.value;

                try {
                  execFinalizer(finalizer);
                } catch (err) {
                  errors = errors !== null && errors !== void 0 ? errors : [];

                  if (err instanceof UnsubscriptionError) {
                    errors = __spreadArray(__spreadArray([], __read(errors)), __read(err.errors));
                  } else {
                    errors.push(err);
                  }
                }
              }
            } catch (e_2_1) {
              e_2 = {
                error: e_2_1
              };
            } finally {
              try {
                if (_finalizers_1_1 && !_finalizers_1_1.done && (_b = _finalizers_1.return)) _b.call(_finalizers_1);
              } finally {
                if (e_2) throw e_2.error;
              }
            }
          }

          if (errors) {
            throw new UnsubscriptionError(errors);
          }
        }
      };

      Subscription.prototype.add = function (teardown) {
        var _a;

        if (teardown && teardown !== this) {
          if (this.closed) {
            execFinalizer(teardown);
          } else {
            if (teardown instanceof Subscription) {
              if (teardown.closed || teardown._hasParent(this)) {
                return;
              }

              teardown._addParent(this);
            }

            (this._finalizers = (_a = this._finalizers) !== null && _a !== void 0 ? _a : []).push(teardown);
          }
        }
      };

      Subscription.prototype._hasParent = function (parent) {
        var _parentage = this._parentage;
        return _parentage === parent || Array.isArray(_parentage) && _parentage.includes(parent);
      };

      Subscription.prototype._addParent = function (parent) {
        var _parentage = this._parentage;
        this._parentage = Array.isArray(_parentage) ? (_parentage.push(parent), _parentage) : _parentage ? [_parentage, parent] : parent;
      };

      Subscription.prototype._removeParent = function (parent) {
        var _parentage = this._parentage;

        if (_parentage === parent) {
          this._parentage = null;
        } else if (Array.isArray(_parentage)) {
          arrRemove(_parentage, parent);
        }
      };

      Subscription.prototype.remove = function (teardown) {
        var _finalizers = this._finalizers;
        _finalizers && arrRemove(_finalizers, teardown);

        if (teardown instanceof Subscription) {
          teardown._removeParent(this);
        }
      };

      Subscription.EMPTY = function () {
        var empty = new Subscription();
        empty.closed = true;
        return empty;
      }();

      return Subscription;
    }();
    var EMPTY_SUBSCRIPTION = Subscription.EMPTY;
    function isSubscription(value) {
      return value instanceof Subscription || value && 'closed' in value && isFunction$4(value.remove) && isFunction$4(value.add) && isFunction$4(value.unsubscribe);
    }

    function execFinalizer(finalizer) {
      if (isFunction$4(finalizer)) {
        finalizer();
      } else {
        finalizer.unsubscribe();
      }
    }

    var config = {
      onUnhandledError: null,
      onStoppedNotification: null,
      Promise: undefined,
      useDeprecatedSynchronousErrorHandling: false,
      useDeprecatedNextContext: false
    };

    var timeoutProvider = {
      setTimeout: function (handler, timeout) {
        var args = [];

        for (var _i = 2; _i < arguments.length; _i++) {
          args[_i - 2] = arguments[_i];
        }

        return setTimeout.apply(void 0, __spreadArray([handler, timeout], __read(args)));
      },
      clearTimeout: function (handle) {
        return (clearTimeout)(handle);
      },
      delegate: undefined
    };

    function reportUnhandledError(err) {
      timeoutProvider.setTimeout(function () {

        {
          throw err;
        }
      });
    }

    function noop() {}

    function errorContext(cb) {
      {
        cb();
      }
    }

    var Subscriber = function (_super) {
      __extends(Subscriber, _super);

      function Subscriber(destination) {
        var _this = _super.call(this) || this;

        _this.isStopped = false;

        if (destination) {
          _this.destination = destination;

          if (isSubscription(destination)) {
            destination.add(_this);
          }
        } else {
          _this.destination = EMPTY_OBSERVER;
        }

        return _this;
      }

      Subscriber.create = function (next, error, complete) {
        return new SafeSubscriber(next, error, complete);
      };

      Subscriber.prototype.next = function (value) {
        if (this.isStopped) ; else {
          this._next(value);
        }
      };

      Subscriber.prototype.error = function (err) {
        if (this.isStopped) ; else {
          this.isStopped = true;

          this._error(err);
        }
      };

      Subscriber.prototype.complete = function () {
        if (this.isStopped) ; else {
          this.isStopped = true;

          this._complete();
        }
      };

      Subscriber.prototype.unsubscribe = function () {
        if (!this.closed) {
          this.isStopped = true;

          _super.prototype.unsubscribe.call(this);

          this.destination = null;
        }
      };

      Subscriber.prototype._next = function (value) {
        this.destination.next(value);
      };

      Subscriber.prototype._error = function (err) {
        try {
          this.destination.error(err);
        } finally {
          this.unsubscribe();
        }
      };

      Subscriber.prototype._complete = function () {
        try {
          this.destination.complete();
        } finally {
          this.unsubscribe();
        }
      };

      return Subscriber;
    }(Subscription);
    var _bind = Function.prototype.bind;

    function bind(fn, thisArg) {
      return _bind.call(fn, thisArg);
    }

    var ConsumerObserver = function () {
      function ConsumerObserver(partialObserver) {
        this.partialObserver = partialObserver;
      }

      ConsumerObserver.prototype.next = function (value) {
        var partialObserver = this.partialObserver;

        if (partialObserver.next) {
          try {
            partialObserver.next(value);
          } catch (error) {
            handleUnhandledError(error);
          }
        }
      };

      ConsumerObserver.prototype.error = function (err) {
        var partialObserver = this.partialObserver;

        if (partialObserver.error) {
          try {
            partialObserver.error(err);
          } catch (error) {
            handleUnhandledError(error);
          }
        } else {
          handleUnhandledError(err);
        }
      };

      ConsumerObserver.prototype.complete = function () {
        var partialObserver = this.partialObserver;

        if (partialObserver.complete) {
          try {
            partialObserver.complete();
          } catch (error) {
            handleUnhandledError(error);
          }
        }
      };

      return ConsumerObserver;
    }();

    var SafeSubscriber = function (_super) {
      __extends(SafeSubscriber, _super);

      function SafeSubscriber(observerOrNext, error, complete) {
        var _this = _super.call(this) || this;

        var partialObserver;

        if (isFunction$4(observerOrNext) || !observerOrNext) {
          partialObserver = {
            next: observerOrNext !== null && observerOrNext !== void 0 ? observerOrNext : undefined,
            error: error !== null && error !== void 0 ? error : undefined,
            complete: complete !== null && complete !== void 0 ? complete : undefined
          };
        } else {
          var context_1;

          if (_this && config.useDeprecatedNextContext) {
            context_1 = Object.create(observerOrNext);

            context_1.unsubscribe = function () {
              return _this.unsubscribe();
            };

            partialObserver = {
              next: observerOrNext.next && bind(observerOrNext.next, context_1),
              error: observerOrNext.error && bind(observerOrNext.error, context_1),
              complete: observerOrNext.complete && bind(observerOrNext.complete, context_1)
            };
          } else {
            partialObserver = observerOrNext;
          }
        }

        _this.destination = new ConsumerObserver(partialObserver);
        return _this;
      }

      return SafeSubscriber;
    }(Subscriber);

    function handleUnhandledError(error) {
      {
        reportUnhandledError(error);
      }
    }

    function defaultErrorHandler(err) {
      throw err;
    }

    var EMPTY_OBSERVER = {
      closed: true,
      next: noop,
      error: defaultErrorHandler,
      complete: noop
    };

    var observable = function () {
      return typeof Symbol === 'function' && Symbol.observable || '@@observable';
    }();

    function identity(x) {
      return x;
    }

    function pipe() {
      var fns = [];

      for (var _i = 0; _i < arguments.length; _i++) {
        fns[_i] = arguments[_i];
      }

      return pipeFromArray(fns);
    }
    function pipeFromArray(fns) {
      if (fns.length === 0) {
        return identity;
      }

      if (fns.length === 1) {
        return fns[0];
      }

      return function piped(input) {
        return fns.reduce(function (prev, fn) {
          return fn(prev);
        }, input);
      };
    }

    var Observable = function () {
      function Observable(subscribe) {
        if (subscribe) {
          this._subscribe = subscribe;
        }
      }

      Observable.prototype.lift = function (operator) {
        var observable = new Observable();
        observable.source = this;
        observable.operator = operator;
        return observable;
      };

      Observable.prototype.subscribe = function (observerOrNext, error, complete) {
        var _this = this;

        var subscriber = isSubscriber(observerOrNext) ? observerOrNext : new SafeSubscriber(observerOrNext, error, complete);
        errorContext(function () {
          var _a = _this,
              operator = _a.operator,
              source = _a.source;
          subscriber.add(operator ? operator.call(subscriber, source) : source ? _this._subscribe(subscriber) : _this._trySubscribe(subscriber));
        });
        return subscriber;
      };

      Observable.prototype._trySubscribe = function (sink) {
        try {
          return this._subscribe(sink);
        } catch (err) {
          sink.error(err);
        }
      };

      Observable.prototype.forEach = function (next, promiseCtor) {
        var _this = this;

        promiseCtor = getPromiseCtor(promiseCtor);
        return new promiseCtor(function (resolve, reject) {
          var subscriber = new SafeSubscriber({
            next: function (value) {
              try {
                next(value);
              } catch (err) {
                reject(err);
                subscriber.unsubscribe();
              }
            },
            error: reject,
            complete: resolve
          });

          _this.subscribe(subscriber);
        });
      };

      Observable.prototype._subscribe = function (subscriber) {
        var _a;

        return (_a = this.source) === null || _a === void 0 ? void 0 : _a.subscribe(subscriber);
      };

      Observable.prototype[observable] = function () {
        return this;
      };

      Observable.prototype.pipe = function () {
        var operations = [];

        for (var _i = 0; _i < arguments.length; _i++) {
          operations[_i] = arguments[_i];
        }

        return pipeFromArray(operations)(this);
      };

      Observable.prototype.toPromise = function (promiseCtor) {
        var _this = this;

        promiseCtor = getPromiseCtor(promiseCtor);
        return new promiseCtor(function (resolve, reject) {
          var value;

          _this.subscribe(function (x) {
            return value = x;
          }, function (err) {
            return reject(err);
          }, function () {
            return resolve(value);
          });
        });
      };

      Observable.create = function (subscribe) {
        return new Observable(subscribe);
      };

      return Observable;
    }();

    function getPromiseCtor(promiseCtor) {
      var _a;

      return (_a = promiseCtor !== null && promiseCtor !== void 0 ? promiseCtor : config.Promise) !== null && _a !== void 0 ? _a : Promise;
    }

    function isObserver(value) {
      return value && isFunction$4(value.next) && isFunction$4(value.error) && isFunction$4(value.complete);
    }

    function isSubscriber(value) {
      return value && value instanceof Subscriber || isObserver(value) && isSubscription(value);
    }

    function hasLift(source) {
      return isFunction$4(source === null || source === void 0 ? void 0 : source.lift);
    }
    function operate(init) {
      return function (source) {
        if (hasLift(source)) {
          return source.lift(function (liftedSource) {
            try {
              return init(liftedSource, this);
            } catch (err) {
              this.error(err);
            }
          });
        }

        throw new TypeError('Unable to lift unknown Observable type');
      };
    }

    function createOperatorSubscriber(destination, onNext, onComplete, onError, onFinalize) {
      return new OperatorSubscriber(destination, onNext, onComplete, onError, onFinalize);
    }

    var OperatorSubscriber = function (_super) {
      __extends(OperatorSubscriber, _super);

      function OperatorSubscriber(destination, onNext, onComplete, onError, onFinalize, shouldUnsubscribe) {
        var _this = _super.call(this, destination) || this;

        _this.onFinalize = onFinalize;
        _this.shouldUnsubscribe = shouldUnsubscribe;
        _this._next = onNext ? function (value) {
          try {
            onNext(value);
          } catch (err) {
            destination.error(err);
          }
        } : _super.prototype._next;
        _this._error = onError ? function (err) {
          try {
            onError(err);
          } catch (err) {
            destination.error(err);
          } finally {
            this.unsubscribe();
          }
        } : _super.prototype._error;
        _this._complete = onComplete ? function () {
          try {
            onComplete();
          } catch (err) {
            destination.error(err);
          } finally {
            this.unsubscribe();
          }
        } : _super.prototype._complete;
        return _this;
      }

      OperatorSubscriber.prototype.unsubscribe = function () {
        var _a;

        if (!this.shouldUnsubscribe || this.shouldUnsubscribe()) {
          var closed_1 = this.closed;

          _super.prototype.unsubscribe.call(this);

          !closed_1 && ((_a = this.onFinalize) === null || _a === void 0 ? void 0 : _a.call(this));
        }
      };

      return OperatorSubscriber;
    }(Subscriber);

    function refCount() {
      return operate(function (source, subscriber) {
        var connection = null;
        source._refCount++;
        var refCounter = createOperatorSubscriber(subscriber, undefined, undefined, undefined, function () {
          if (!source || source._refCount <= 0 || 0 < --source._refCount) {
            connection = null;
            return;
          }

          var sharedConnection = source._connection;
          var conn = connection;
          connection = null;

          if (sharedConnection && (!conn || sharedConnection === conn)) {
            sharedConnection.unsubscribe();
          }

          subscriber.unsubscribe();
        });
        source.subscribe(refCounter);

        if (!refCounter.closed) {
          connection = source.connect();
        }
      });
    }

    (function (_super) {
      __extends(ConnectableObservable, _super);

      function ConnectableObservable(source, subjectFactory) {
        var _this = _super.call(this) || this;

        _this.source = source;
        _this.subjectFactory = subjectFactory;
        _this._subject = null;
        _this._refCount = 0;
        _this._connection = null;

        if (hasLift(source)) {
          _this.lift = source.lift;
        }

        return _this;
      }

      ConnectableObservable.prototype._subscribe = function (subscriber) {
        return this.getSubject().subscribe(subscriber);
      };

      ConnectableObservable.prototype.getSubject = function () {
        var subject = this._subject;

        if (!subject || subject.isStopped) {
          this._subject = this.subjectFactory();
        }

        return this._subject;
      };

      ConnectableObservable.prototype._teardown = function () {
        this._refCount = 0;
        var _connection = this._connection;
        this._subject = this._connection = null;
        _connection === null || _connection === void 0 ? void 0 : _connection.unsubscribe();
      };

      ConnectableObservable.prototype.connect = function () {
        var _this = this;

        var connection = this._connection;

        if (!connection) {
          connection = this._connection = new Subscription();
          var subject_1 = this.getSubject();
          connection.add(this.source.subscribe(createOperatorSubscriber(subject_1, undefined, function () {
            _this._teardown();

            subject_1.complete();
          }, function (err) {
            _this._teardown();

            subject_1.error(err);
          }, function () {
            return _this._teardown();
          })));

          if (connection.closed) {
            this._connection = null;
            connection = Subscription.EMPTY;
          }
        }

        return connection;
      };

      ConnectableObservable.prototype.refCount = function () {
        return refCount()(this);
      };

      return ConnectableObservable;
    })(Observable);

    var performanceTimestampProvider = {
      now: function () {
        return (performanceTimestampProvider.delegate || performance).now();
      },
      delegate: undefined
    };

    var animationFrameProvider = {
      schedule: function (callback) {
        var request = requestAnimationFrame;
        var cancel = cancelAnimationFrame;

        var handle = request(function (timestamp) {
          cancel = undefined;
          callback(timestamp);
        });
        return new Subscription(function () {
          return cancel === null || cancel === void 0 ? void 0 : cancel(handle);
        });
      },
      requestAnimationFrame: function () {
        var args = [];

        for (var _i = 0; _i < arguments.length; _i++) {
          args[_i] = arguments[_i];
        }

        var delegate = animationFrameProvider.delegate;
        return ((delegate === null || delegate === void 0 ? void 0 : delegate.requestAnimationFrame) || requestAnimationFrame).apply(void 0, __spreadArray([], __read(args)));
      },
      cancelAnimationFrame: function () {
        var args = [];

        for (var _i = 0; _i < arguments.length; _i++) {
          args[_i] = arguments[_i];
        }
        return (cancelAnimationFrame).apply(void 0, __spreadArray([], __read(args)));
      },
      delegate: undefined
    };

    function animationFramesFactory(timestampProvider) {
      var schedule = animationFrameProvider.schedule;
      return new Observable(function (subscriber) {
        var subscription = new Subscription();
        var provider = timestampProvider || performanceTimestampProvider;
        var start = provider.now();

        var run = function (timestamp) {
          var now = provider.now();
          subscriber.next({
            timestamp: timestampProvider ? now : timestamp,
            elapsed: now - start
          });

          if (!subscriber.closed) {
            subscription.add(schedule(run));
          }
        };

        subscription.add(schedule(run));
        return subscription;
      });
    }

    animationFramesFactory();

    var ObjectUnsubscribedError = createErrorClass(function (_super) {
      return function ObjectUnsubscribedErrorImpl() {
        _super(this);

        this.name = 'ObjectUnsubscribedError';
        this.message = 'object unsubscribed';
      };
    });

    var Subject = function (_super) {
      __extends(Subject, _super);

      function Subject() {
        var _this = _super.call(this) || this;

        _this.closed = false;
        _this.currentObservers = null;
        _this.observers = [];
        _this.isStopped = false;
        _this.hasError = false;
        _this.thrownError = null;
        return _this;
      }

      Subject.prototype.lift = function (operator) {
        var subject = new AnonymousSubject(this, this);
        subject.operator = operator;
        return subject;
      };

      Subject.prototype._throwIfClosed = function () {
        if (this.closed) {
          throw new ObjectUnsubscribedError();
        }
      };

      Subject.prototype.next = function (value) {
        var _this = this;

        errorContext(function () {
          var e_1, _a;

          _this._throwIfClosed();

          if (!_this.isStopped) {
            if (!_this.currentObservers) {
              _this.currentObservers = Array.from(_this.observers);
            }

            try {
              for (var _b = __values(_this.currentObservers), _c = _b.next(); !_c.done; _c = _b.next()) {
                var observer = _c.value;
                observer.next(value);
              }
            } catch (e_1_1) {
              e_1 = {
                error: e_1_1
              };
            } finally {
              try {
                if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
              } finally {
                if (e_1) throw e_1.error;
              }
            }
          }
        });
      };

      Subject.prototype.error = function (err) {
        var _this = this;

        errorContext(function () {
          _this._throwIfClosed();

          if (!_this.isStopped) {
            _this.hasError = _this.isStopped = true;
            _this.thrownError = err;
            var observers = _this.observers;

            while (observers.length) {
              observers.shift().error(err);
            }
          }
        });
      };

      Subject.prototype.complete = function () {
        var _this = this;

        errorContext(function () {
          _this._throwIfClosed();

          if (!_this.isStopped) {
            _this.isStopped = true;
            var observers = _this.observers;

            while (observers.length) {
              observers.shift().complete();
            }
          }
        });
      };

      Subject.prototype.unsubscribe = function () {
        this.isStopped = this.closed = true;
        this.observers = this.currentObservers = null;
      };

      Object.defineProperty(Subject.prototype, "observed", {
        get: function () {
          var _a;

          return ((_a = this.observers) === null || _a === void 0 ? void 0 : _a.length) > 0;
        },
        enumerable: false,
        configurable: true
      });

      Subject.prototype._trySubscribe = function (subscriber) {
        this._throwIfClosed();

        return _super.prototype._trySubscribe.call(this, subscriber);
      };

      Subject.prototype._subscribe = function (subscriber) {
        this._throwIfClosed();

        this._checkFinalizedStatuses(subscriber);

        return this._innerSubscribe(subscriber);
      };

      Subject.prototype._innerSubscribe = function (subscriber) {
        var _this = this;

        var _a = this,
            hasError = _a.hasError,
            isStopped = _a.isStopped,
            observers = _a.observers;

        if (hasError || isStopped) {
          return EMPTY_SUBSCRIPTION;
        }

        this.currentObservers = null;
        observers.push(subscriber);
        return new Subscription(function () {
          _this.currentObservers = null;
          arrRemove(observers, subscriber);
        });
      };

      Subject.prototype._checkFinalizedStatuses = function (subscriber) {
        var _a = this,
            hasError = _a.hasError,
            thrownError = _a.thrownError,
            isStopped = _a.isStopped;

        if (hasError) {
          subscriber.error(thrownError);
        } else if (isStopped) {
          subscriber.complete();
        }
      };

      Subject.prototype.asObservable = function () {
        var observable = new Observable();
        observable.source = this;
        return observable;
      };

      Subject.create = function (destination, source) {
        return new AnonymousSubject(destination, source);
      };

      return Subject;
    }(Observable);

    var AnonymousSubject = function (_super) {
      __extends(AnonymousSubject, _super);

      function AnonymousSubject(destination, source) {
        var _this = _super.call(this) || this;

        _this.destination = destination;
        _this.source = source;
        return _this;
      }

      AnonymousSubject.prototype.next = function (value) {
        var _a, _b;

        (_b = (_a = this.destination) === null || _a === void 0 ? void 0 : _a.next) === null || _b === void 0 ? void 0 : _b.call(_a, value);
      };

      AnonymousSubject.prototype.error = function (err) {
        var _a, _b;

        (_b = (_a = this.destination) === null || _a === void 0 ? void 0 : _a.error) === null || _b === void 0 ? void 0 : _b.call(_a, err);
      };

      AnonymousSubject.prototype.complete = function () {
        var _a, _b;

        (_b = (_a = this.destination) === null || _a === void 0 ? void 0 : _a.complete) === null || _b === void 0 ? void 0 : _b.call(_a);
      };

      AnonymousSubject.prototype._subscribe = function (subscriber) {
        var _a, _b;

        return (_b = (_a = this.source) === null || _a === void 0 ? void 0 : _a.subscribe(subscriber)) !== null && _b !== void 0 ? _b : EMPTY_SUBSCRIPTION;
      };

      return AnonymousSubject;
    }(Subject);

    (function (_super) {
      __extends(BehaviorSubject, _super);

      function BehaviorSubject(_value) {
        var _this = _super.call(this) || this;

        _this._value = _value;
        return _this;
      }

      Object.defineProperty(BehaviorSubject.prototype, "value", {
        get: function () {
          return this.getValue();
        },
        enumerable: false,
        configurable: true
      });

      BehaviorSubject.prototype._subscribe = function (subscriber) {
        var subscription = _super.prototype._subscribe.call(this, subscriber);

        !subscription.closed && subscriber.next(this._value);
        return subscription;
      };

      BehaviorSubject.prototype.getValue = function () {
        var _a = this,
            hasError = _a.hasError,
            thrownError = _a.thrownError,
            _value = _a._value;

        if (hasError) {
          throw thrownError;
        }

        this._throwIfClosed();

        return _value;
      };

      BehaviorSubject.prototype.next = function (value) {
        _super.prototype.next.call(this, this._value = value);
      };

      return BehaviorSubject;
    })(Subject);

    var dateTimestampProvider = {
      now: function () {
        return (dateTimestampProvider.delegate || Date).now();
      },
      delegate: undefined
    };

    var ReplaySubject = function (_super) {
      __extends(ReplaySubject, _super);

      function ReplaySubject(_bufferSize, _windowTime, _timestampProvider) {
        if (_bufferSize === void 0) {
          _bufferSize = Infinity;
        }

        if (_windowTime === void 0) {
          _windowTime = Infinity;
        }

        if (_timestampProvider === void 0) {
          _timestampProvider = dateTimestampProvider;
        }

        var _this = _super.call(this) || this;

        _this._bufferSize = _bufferSize;
        _this._windowTime = _windowTime;
        _this._timestampProvider = _timestampProvider;
        _this._buffer = [];
        _this._infiniteTimeWindow = true;
        _this._infiniteTimeWindow = _windowTime === Infinity;
        _this._bufferSize = Math.max(1, _bufferSize);
        _this._windowTime = Math.max(1, _windowTime);
        return _this;
      }

      ReplaySubject.prototype.next = function (value) {
        var _a = this,
            isStopped = _a.isStopped,
            _buffer = _a._buffer,
            _infiniteTimeWindow = _a._infiniteTimeWindow,
            _timestampProvider = _a._timestampProvider,
            _windowTime = _a._windowTime;

        if (!isStopped) {
          _buffer.push(value);

          !_infiniteTimeWindow && _buffer.push(_timestampProvider.now() + _windowTime);
        }

        this._trimBuffer();

        _super.prototype.next.call(this, value);
      };

      ReplaySubject.prototype._subscribe = function (subscriber) {
        this._throwIfClosed();

        this._trimBuffer();

        var subscription = this._innerSubscribe(subscriber);

        var _a = this,
            _infiniteTimeWindow = _a._infiniteTimeWindow,
            _buffer = _a._buffer;

        var copy = _buffer.slice();

        for (var i = 0; i < copy.length && !subscriber.closed; i += _infiniteTimeWindow ? 1 : 2) {
          subscriber.next(copy[i]);
        }

        this._checkFinalizedStatuses(subscriber);

        return subscription;
      };

      ReplaySubject.prototype._trimBuffer = function () {
        var _a = this,
            _bufferSize = _a._bufferSize,
            _timestampProvider = _a._timestampProvider,
            _buffer = _a._buffer,
            _infiniteTimeWindow = _a._infiniteTimeWindow;

        var adjustedBufferSize = (_infiniteTimeWindow ? 1 : 2) * _bufferSize;
        _bufferSize < Infinity && adjustedBufferSize < _buffer.length && _buffer.splice(0, _buffer.length - adjustedBufferSize);

        if (!_infiniteTimeWindow) {
          var now = _timestampProvider.now();

          var last = 0;

          for (var i = 1; i < _buffer.length && _buffer[i] <= now; i += 2) {
            last = i;
          }

          last && _buffer.splice(0, last + 1);
        }
      };

      return ReplaySubject;
    }(Subject);

    (function (_super) {
      __extends(AsyncSubject, _super);

      function AsyncSubject() {
        var _this = _super !== null && _super.apply(this, arguments) || this;

        _this._value = null;
        _this._hasValue = false;
        _this._isComplete = false;
        return _this;
      }

      AsyncSubject.prototype._checkFinalizedStatuses = function (subscriber) {
        var _a = this,
            hasError = _a.hasError,
            _hasValue = _a._hasValue,
            _value = _a._value,
            thrownError = _a.thrownError,
            isStopped = _a.isStopped,
            _isComplete = _a._isComplete;

        if (hasError) {
          subscriber.error(thrownError);
        } else if (isStopped || _isComplete) {
          _hasValue && subscriber.next(_value);
          subscriber.complete();
        }
      };

      AsyncSubject.prototype.next = function (value) {
        if (!this.isStopped) {
          this._value = value;
          this._hasValue = true;
        }
      };

      AsyncSubject.prototype.complete = function () {
        var _a = this,
            _hasValue = _a._hasValue,
            _value = _a._value,
            _isComplete = _a._isComplete;

        if (!_isComplete) {
          this._isComplete = true;
          _hasValue && _super.prototype.next.call(this, _value);

          _super.prototype.complete.call(this);
        }
      };

      return AsyncSubject;
    })(Subject);

    var Action = function (_super) {
      __extends(Action, _super);

      function Action(scheduler, work) {
        return _super.call(this) || this;
      }

      Action.prototype.schedule = function (state, delay) {

        return this;
      };

      return Action;
    }(Subscription);

    var intervalProvider = {
      setInterval: function (handler, timeout) {
        var args = [];

        for (var _i = 2; _i < arguments.length; _i++) {
          args[_i - 2] = arguments[_i];
        }

        return setInterval.apply(void 0, __spreadArray([handler, timeout], __read(args)));
      },
      clearInterval: function (handle) {
        return (clearInterval)(handle);
      },
      delegate: undefined
    };

    var AsyncAction = function (_super) {
      __extends(AsyncAction, _super);

      function AsyncAction(scheduler, work) {
        var _this = _super.call(this, scheduler, work) || this;

        _this.scheduler = scheduler;
        _this.work = work;
        _this.pending = false;
        return _this;
      }

      AsyncAction.prototype.schedule = function (state, delay) {
        if (delay === void 0) {
          delay = 0;
        }

        if (this.closed) {
          return this;
        }

        this.state = state;
        var id = this.id;
        var scheduler = this.scheduler;

        if (id != null) {
          this.id = this.recycleAsyncId(scheduler, id, delay);
        }

        this.pending = true;
        this.delay = delay;
        this.id = this.id || this.requestAsyncId(scheduler, this.id, delay);
        return this;
      };

      AsyncAction.prototype.requestAsyncId = function (scheduler, _id, delay) {
        if (delay === void 0) {
          delay = 0;
        }

        return intervalProvider.setInterval(scheduler.flush.bind(scheduler, this), delay);
      };

      AsyncAction.prototype.recycleAsyncId = function (_scheduler, id, delay) {
        if (delay === void 0) {
          delay = 0;
        }

        if (delay != null && this.delay === delay && this.pending === false) {
          return id;
        }

        intervalProvider.clearInterval(id);
        return undefined;
      };

      AsyncAction.prototype.execute = function (state, delay) {
        if (this.closed) {
          return new Error('executing a cancelled action');
        }

        this.pending = false;

        var error = this._execute(state, delay);

        if (error) {
          return error;
        } else if (this.pending === false && this.id != null) {
          this.id = this.recycleAsyncId(this.scheduler, this.id, null);
        }
      };

      AsyncAction.prototype._execute = function (state, _delay) {
        var errored = false;
        var errorValue;

        try {
          this.work(state);
        } catch (e) {
          errored = true;
          errorValue = e ? e : new Error('Scheduled action threw falsy error');
        }

        if (errored) {
          this.unsubscribe();
          return errorValue;
        }
      };

      AsyncAction.prototype.unsubscribe = function () {
        if (!this.closed) {
          var _a = this,
              id = _a.id,
              scheduler = _a.scheduler;

          var actions = scheduler.actions;
          this.work = this.state = this.scheduler = null;
          this.pending = false;
          arrRemove(actions, this);

          if (id != null) {
            this.id = this.recycleAsyncId(scheduler, id, null);
          }

          this.delay = null;

          _super.prototype.unsubscribe.call(this);
        }
      };

      return AsyncAction;
    }(Action);

    var nextHandle = 1;
    var resolved;
    var activeHandles = {};

    function findAndClearHandle(handle) {
      if (handle in activeHandles) {
        delete activeHandles[handle];
        return true;
      }

      return false;
    }

    var Immediate = {
      setImmediate: function (cb) {
        var handle = nextHandle++;
        activeHandles[handle] = true;

        if (!resolved) {
          resolved = Promise.resolve();
        }

        resolved.then(function () {
          return findAndClearHandle(handle) && cb();
        });
        return handle;
      },
      clearImmediate: function (handle) {
        findAndClearHandle(handle);
      }
    };

    var setImmediate = Immediate.setImmediate,
        clearImmediate = Immediate.clearImmediate;
    var immediateProvider = {
      setImmediate: function () {
        var args = [];

        for (var _i = 0; _i < arguments.length; _i++) {
          args[_i] = arguments[_i];
        }

        var delegate = immediateProvider.delegate;
        return ((delegate === null || delegate === void 0 ? void 0 : delegate.setImmediate) || setImmediate).apply(void 0, __spreadArray([], __read(args)));
      },
      clearImmediate: function (handle) {
        return (clearImmediate)(handle);
      },
      delegate: undefined
    };

    var AsapAction = function (_super) {
      __extends(AsapAction, _super);

      function AsapAction(scheduler, work) {
        var _this = _super.call(this, scheduler, work) || this;

        _this.scheduler = scheduler;
        _this.work = work;
        return _this;
      }

      AsapAction.prototype.requestAsyncId = function (scheduler, id, delay) {
        if (delay === void 0) {
          delay = 0;
        }

        if (delay !== null && delay > 0) {
          return _super.prototype.requestAsyncId.call(this, scheduler, id, delay);
        }

        scheduler.actions.push(this);
        return scheduler._scheduled || (scheduler._scheduled = immediateProvider.setImmediate(scheduler.flush.bind(scheduler, undefined)));
      };

      AsapAction.prototype.recycleAsyncId = function (scheduler, id, delay) {
        if (delay === void 0) {
          delay = 0;
        }

        if (delay != null && delay > 0 || delay == null && this.delay > 0) {
          return _super.prototype.recycleAsyncId.call(this, scheduler, id, delay);
        }

        if (!scheduler.actions.some(function (action) {
          return action.id === id;
        })) {
          immediateProvider.clearImmediate(id);
          scheduler._scheduled = undefined;
        }

        return undefined;
      };

      return AsapAction;
    }(AsyncAction);

    var Scheduler = function () {
      function Scheduler(schedulerActionCtor, now) {
        if (now === void 0) {
          now = Scheduler.now;
        }

        this.schedulerActionCtor = schedulerActionCtor;
        this.now = now;
      }

      Scheduler.prototype.schedule = function (work, delay, state) {
        if (delay === void 0) {
          delay = 0;
        }

        return new this.schedulerActionCtor(this, work).schedule(state, delay);
      };

      Scheduler.now = dateTimestampProvider.now;
      return Scheduler;
    }();

    var AsyncScheduler = function (_super) {
      __extends(AsyncScheduler, _super);

      function AsyncScheduler(SchedulerAction, now) {
        if (now === void 0) {
          now = Scheduler.now;
        }

        var _this = _super.call(this, SchedulerAction, now) || this;

        _this.actions = [];
        _this._active = false;
        _this._scheduled = undefined;
        return _this;
      }

      AsyncScheduler.prototype.flush = function (action) {
        var actions = this.actions;

        if (this._active) {
          actions.push(action);
          return;
        }

        var error;
        this._active = true;

        do {
          if (error = action.execute(action.state, action.delay)) {
            break;
          }
        } while (action = actions.shift());

        this._active = false;

        if (error) {
          while (action = actions.shift()) {
            action.unsubscribe();
          }

          throw error;
        }
      };

      return AsyncScheduler;
    }(Scheduler);

    var AsapScheduler = function (_super) {
      __extends(AsapScheduler, _super);

      function AsapScheduler() {
        return _super !== null && _super.apply(this, arguments) || this;
      }

      AsapScheduler.prototype.flush = function (action) {
        this._active = true;
        var flushId = this._scheduled;
        this._scheduled = undefined;
        var actions = this.actions;
        var error;
        action = action || actions.shift();

        do {
          if (error = action.execute(action.state, action.delay)) {
            break;
          }
        } while ((action = actions[0]) && action.id === flushId && actions.shift());

        this._active = false;

        if (error) {
          while ((action = actions[0]) && action.id === flushId && actions.shift()) {
            action.unsubscribe();
          }

          throw error;
        }
      };

      return AsapScheduler;
    }(AsyncScheduler);

    new AsapScheduler(AsapAction);

    var asyncScheduler = new AsyncScheduler(AsyncAction);

    var QueueAction = function (_super) {
      __extends(QueueAction, _super);

      function QueueAction(scheduler, work) {
        var _this = _super.call(this, scheduler, work) || this;

        _this.scheduler = scheduler;
        _this.work = work;
        return _this;
      }

      QueueAction.prototype.schedule = function (state, delay) {
        if (delay === void 0) {
          delay = 0;
        }

        if (delay > 0) {
          return _super.prototype.schedule.call(this, state, delay);
        }

        this.delay = delay;
        this.state = state;
        this.scheduler.flush(this);
        return this;
      };

      QueueAction.prototype.execute = function (state, delay) {
        return delay > 0 || this.closed ? _super.prototype.execute.call(this, state, delay) : this._execute(state, delay);
      };

      QueueAction.prototype.requestAsyncId = function (scheduler, id, delay) {
        if (delay === void 0) {
          delay = 0;
        }

        if (delay != null && delay > 0 || delay == null && this.delay > 0) {
          return _super.prototype.requestAsyncId.call(this, scheduler, id, delay);
        }

        return scheduler.flush(this);
      };

      return QueueAction;
    }(AsyncAction);

    var QueueScheduler = function (_super) {
      __extends(QueueScheduler, _super);

      function QueueScheduler() {
        return _super !== null && _super.apply(this, arguments) || this;
      }

      return QueueScheduler;
    }(AsyncScheduler);

    new QueueScheduler(QueueAction);

    var AnimationFrameAction = function (_super) {
      __extends(AnimationFrameAction, _super);

      function AnimationFrameAction(scheduler, work) {
        var _this = _super.call(this, scheduler, work) || this;

        _this.scheduler = scheduler;
        _this.work = work;
        return _this;
      }

      AnimationFrameAction.prototype.requestAsyncId = function (scheduler, id, delay) {
        if (delay === void 0) {
          delay = 0;
        }

        if (delay !== null && delay > 0) {
          return _super.prototype.requestAsyncId.call(this, scheduler, id, delay);
        }

        scheduler.actions.push(this);
        return scheduler._scheduled || (scheduler._scheduled = animationFrameProvider.requestAnimationFrame(function () {
          return scheduler.flush(undefined);
        }));
      };

      AnimationFrameAction.prototype.recycleAsyncId = function (scheduler, id, delay) {
        if (delay === void 0) {
          delay = 0;
        }

        if (delay != null && delay > 0 || delay == null && this.delay > 0) {
          return _super.prototype.recycleAsyncId.call(this, scheduler, id, delay);
        }

        if (!scheduler.actions.some(function (action) {
          return action.id === id;
        })) {
          animationFrameProvider.cancelAnimationFrame(id);
          scheduler._scheduled = undefined;
        }

        return undefined;
      };

      return AnimationFrameAction;
    }(AsyncAction);

    var AnimationFrameScheduler = function (_super) {
      __extends(AnimationFrameScheduler, _super);

      function AnimationFrameScheduler() {
        return _super !== null && _super.apply(this, arguments) || this;
      }

      AnimationFrameScheduler.prototype.flush = function (action) {
        this._active = true;
        var flushId = this._scheduled;
        this._scheduled = undefined;
        var actions = this.actions;
        var error;
        action = action || actions.shift();

        do {
          if (error = action.execute(action.state, action.delay)) {
            break;
          }
        } while ((action = actions[0]) && action.id === flushId && actions.shift());

        this._active = false;

        if (error) {
          while ((action = actions[0]) && action.id === flushId && actions.shift()) {
            action.unsubscribe();
          }

          throw error;
        }
      };

      return AnimationFrameScheduler;
    }(AsyncScheduler);

    new AnimationFrameScheduler(AnimationFrameAction);

    (function (_super) {
      __extends(VirtualTimeScheduler, _super);

      function VirtualTimeScheduler(schedulerActionCtor, maxFrames) {
        if (schedulerActionCtor === void 0) {
          schedulerActionCtor = VirtualAction;
        }

        if (maxFrames === void 0) {
          maxFrames = Infinity;
        }

        var _this = _super.call(this, schedulerActionCtor, function () {
          return _this.frame;
        }) || this;

        _this.maxFrames = maxFrames;
        _this.frame = 0;
        _this.index = -1;
        return _this;
      }

      VirtualTimeScheduler.prototype.flush = function () {
        var _a = this,
            actions = _a.actions,
            maxFrames = _a.maxFrames;

        var error;
        var action;

        while ((action = actions[0]) && action.delay <= maxFrames) {
          actions.shift();
          this.frame = action.delay;

          if (error = action.execute(action.state, action.delay)) {
            break;
          }
        }

        if (error) {
          while (action = actions.shift()) {
            action.unsubscribe();
          }

          throw error;
        }
      };

      VirtualTimeScheduler.frameTimeFactor = 10;
      return VirtualTimeScheduler;
    })(AsyncScheduler);

    var VirtualAction = function (_super) {
      __extends(VirtualAction, _super);

      function VirtualAction(scheduler, work, index) {
        if (index === void 0) {
          index = scheduler.index += 1;
        }

        var _this = _super.call(this, scheduler, work) || this;

        _this.scheduler = scheduler;
        _this.work = work;
        _this.index = index;
        _this.active = true;
        _this.index = scheduler.index = index;
        return _this;
      }

      VirtualAction.prototype.schedule = function (state, delay) {
        if (delay === void 0) {
          delay = 0;
        }

        if (Number.isFinite(delay)) {
          if (!this.id) {
            return _super.prototype.schedule.call(this, state, delay);
          }

          this.active = false;
          var action = new VirtualAction(this.scheduler, this.work);
          this.add(action);
          return action.schedule(state, delay);
        } else {
          return Subscription.EMPTY;
        }
      };

      VirtualAction.prototype.requestAsyncId = function (scheduler, id, delay) {
        if (delay === void 0) {
          delay = 0;
        }

        this.delay = scheduler.frame + delay;
        var actions = scheduler.actions;
        actions.push(this);
        actions.sort(VirtualAction.sortActions);
        return true;
      };

      VirtualAction.prototype.recycleAsyncId = function (scheduler, id, delay) {

        return undefined;
      };

      VirtualAction.prototype._execute = function (state, delay) {
        if (this.active === true) {
          return _super.prototype._execute.call(this, state, delay);
        }
      };

      VirtualAction.sortActions = function (a, b) {
        if (a.delay === b.delay) {
          if (a.index === b.index) {
            return 0;
          } else if (a.index > b.index) {
            return 1;
          } else {
            return -1;
          }
        } else if (a.delay > b.delay) {
          return 1;
        } else {
          return -1;
        }
      };

      return VirtualAction;
    }(AsyncAction);

    var EMPTY$1 = new Observable(function (subscriber) {
      return subscriber.complete();
    });

    function isScheduler(value) {
      return value && isFunction$4(value.schedule);
    }

    function last$1(arr) {
      return arr[arr.length - 1];
    }

    function popResultSelector(args) {
      return isFunction$4(last$1(args)) ? args.pop() : undefined;
    }
    function popScheduler(args) {
      return isScheduler(last$1(args)) ? args.pop() : undefined;
    }
    function popNumber(args, defaultValue) {
      return typeof last$1(args) === 'number' ? args.pop() : defaultValue;
    }

    var isArrayLike$3 = function (x) {
      return x && typeof x.length === 'number' && typeof x !== 'function';
    };

    function isPromise(value) {
      return isFunction$4(value === null || value === void 0 ? void 0 : value.then);
    }

    function isInteropObservable(input) {
      return isFunction$4(input[observable]);
    }

    function isAsyncIterable(obj) {
      return Symbol.asyncIterator && isFunction$4(obj === null || obj === void 0 ? void 0 : obj[Symbol.asyncIterator]);
    }

    function createInvalidObservableTypeError(input) {
      return new TypeError("You provided " + (input !== null && typeof input === 'object' ? 'an invalid object' : "'" + input + "'") + " where a stream was expected. You can provide an Observable, Promise, ReadableStream, Array, AsyncIterable, or Iterable.");
    }

    function getSymbolIterator() {
      if (typeof Symbol !== 'function' || !Symbol.iterator) {
        return '@@iterator';
      }

      return Symbol.iterator;
    }
    var iterator = getSymbolIterator();

    function isIterable$1(input) {
      return isFunction$4(input === null || input === void 0 ? void 0 : input[iterator]);
    }

    function readableStreamLikeToAsyncGenerator(readableStream) {
      return __asyncGenerator(this, arguments, function readableStreamLikeToAsyncGenerator_1() {
        var reader, _a, value, done;

        return __generator(this, function (_b) {
          switch (_b.label) {
            case 0:
              reader = readableStream.getReader();
              _b.label = 1;

            case 1:
              _b.trys.push([1,, 9, 10]);

              _b.label = 2;

            case 2:
              return [4, __await(reader.read())];

            case 3:
              _a = _b.sent(), value = _a.value, done = _a.done;
              if (!done) return [3, 5];
              return [4, __await(void 0)];

            case 4:
              return [2, _b.sent()];

            case 5:
              return [4, __await(value)];

            case 6:
              return [4, _b.sent()];

            case 7:
              _b.sent();

              return [3, 2];

            case 8:
              return [3, 10];

            case 9:
              reader.releaseLock();
              return [7];

            case 10:
              return [2];
          }
        });
      });
    }
    function isReadableStreamLike(obj) {
      return isFunction$4(obj === null || obj === void 0 ? void 0 : obj.getReader);
    }

    function innerFrom(input) {
      if (input instanceof Observable) {
        return input;
      }

      if (input != null) {
        if (isInteropObservable(input)) {
          return fromInteropObservable(input);
        }

        if (isArrayLike$3(input)) {
          return fromArrayLike(input);
        }

        if (isPromise(input)) {
          return fromPromise(input);
        }

        if (isAsyncIterable(input)) {
          return fromAsyncIterable(input);
        }

        if (isIterable$1(input)) {
          return fromIterable(input);
        }

        if (isReadableStreamLike(input)) {
          return fromReadableStreamLike(input);
        }
      }

      throw createInvalidObservableTypeError(input);
    }
    function fromInteropObservable(obj) {
      return new Observable(function (subscriber) {
        var obs = obj[observable]();

        if (isFunction$4(obs.subscribe)) {
          return obs.subscribe(subscriber);
        }

        throw new TypeError('Provided object does not correctly implement Symbol.observable');
      });
    }
    function fromArrayLike(array) {
      return new Observable(function (subscriber) {
        for (var i = 0; i < array.length && !subscriber.closed; i++) {
          subscriber.next(array[i]);
        }

        subscriber.complete();
      });
    }
    function fromPromise(promise) {
      return new Observable(function (subscriber) {
        promise.then(function (value) {
          if (!subscriber.closed) {
            subscriber.next(value);
            subscriber.complete();
          }
        }, function (err) {
          return subscriber.error(err);
        }).then(null, reportUnhandledError);
      });
    }
    function fromIterable(iterable) {
      return new Observable(function (subscriber) {
        var e_1, _a;

        try {
          for (var iterable_1 = __values(iterable), iterable_1_1 = iterable_1.next(); !iterable_1_1.done; iterable_1_1 = iterable_1.next()) {
            var value = iterable_1_1.value;
            subscriber.next(value);

            if (subscriber.closed) {
              return;
            }
          }
        } catch (e_1_1) {
          e_1 = {
            error: e_1_1
          };
        } finally {
          try {
            if (iterable_1_1 && !iterable_1_1.done && (_a = iterable_1.return)) _a.call(iterable_1);
          } finally {
            if (e_1) throw e_1.error;
          }
        }

        subscriber.complete();
      });
    }
    function fromAsyncIterable(asyncIterable) {
      return new Observable(function (subscriber) {
        process(asyncIterable, subscriber).catch(function (err) {
          return subscriber.error(err);
        });
      });
    }
    function fromReadableStreamLike(readableStream) {
      return fromAsyncIterable(readableStreamLikeToAsyncGenerator(readableStream));
    }

    function process(asyncIterable, subscriber) {
      var asyncIterable_1, asyncIterable_1_1;

      var e_2, _a;

      return __awaiter(this, void 0, void 0, function () {
        var value, e_2_1;
        return __generator(this, function (_b) {
          switch (_b.label) {
            case 0:
              _b.trys.push([0, 5, 6, 11]);

              asyncIterable_1 = __asyncValues(asyncIterable);
              _b.label = 1;

            case 1:
              return [4, asyncIterable_1.next()];

            case 2:
              if (!(asyncIterable_1_1 = _b.sent(), !asyncIterable_1_1.done)) return [3, 4];
              value = asyncIterable_1_1.value;
              subscriber.next(value);

              if (subscriber.closed) {
                return [2];
              }

              _b.label = 3;

            case 3:
              return [3, 1];

            case 4:
              return [3, 11];

            case 5:
              e_2_1 = _b.sent();
              e_2 = {
                error: e_2_1
              };
              return [3, 11];

            case 6:
              _b.trys.push([6,, 9, 10]);

              if (!(asyncIterable_1_1 && !asyncIterable_1_1.done && (_a = asyncIterable_1.return))) return [3, 8];
              return [4, _a.call(asyncIterable_1)];

            case 7:
              _b.sent();

              _b.label = 8;

            case 8:
              return [3, 10];

            case 9:
              if (e_2) throw e_2.error;
              return [7];

            case 10:
              return [7];

            case 11:
              subscriber.complete();
              return [2];
          }
        });
      });
    }

    function executeSchedule(parentSubscription, scheduler, work, delay, repeat) {
      if (delay === void 0) {
        delay = 0;
      }

      if (repeat === void 0) {
        repeat = false;
      }

      var scheduleSubscription = scheduler.schedule(function () {
        work();

        if (repeat) {
          parentSubscription.add(this.schedule(null, delay));
        } else {
          this.unsubscribe();
        }
      }, delay);
      parentSubscription.add(scheduleSubscription);

      if (!repeat) {
        return scheduleSubscription;
      }
    }

    function observeOn(scheduler, delay) {
      if (delay === void 0) {
        delay = 0;
      }

      return operate(function (source, subscriber) {
        source.subscribe(createOperatorSubscriber(subscriber, function (value) {
          return executeSchedule(subscriber, scheduler, function () {
            return subscriber.next(value);
          }, delay);
        }, function () {
          return executeSchedule(subscriber, scheduler, function () {
            return subscriber.complete();
          }, delay);
        }, function (err) {
          return executeSchedule(subscriber, scheduler, function () {
            return subscriber.error(err);
          }, delay);
        }));
      });
    }

    function subscribeOn(scheduler, delay) {
      if (delay === void 0) {
        delay = 0;
      }

      return operate(function (source, subscriber) {
        subscriber.add(scheduler.schedule(function () {
          return source.subscribe(subscriber);
        }, delay));
      });
    }

    function scheduleObservable(input, scheduler) {
      return innerFrom(input).pipe(subscribeOn(scheduler), observeOn(scheduler));
    }

    function schedulePromise(input, scheduler) {
      return innerFrom(input).pipe(subscribeOn(scheduler), observeOn(scheduler));
    }

    function scheduleArray(input, scheduler) {
      return new Observable(function (subscriber) {
        var i = 0;
        return scheduler.schedule(function () {
          if (i === input.length) {
            subscriber.complete();
          } else {
            subscriber.next(input[i++]);

            if (!subscriber.closed) {
              this.schedule();
            }
          }
        });
      });
    }

    function scheduleIterable(input, scheduler) {
      return new Observable(function (subscriber) {
        var iterator$1;
        executeSchedule(subscriber, scheduler, function () {
          iterator$1 = input[iterator]();
          executeSchedule(subscriber, scheduler, function () {
            var _a;

            var value;
            var done;

            try {
              _a = iterator$1.next(), value = _a.value, done = _a.done;
            } catch (err) {
              subscriber.error(err);
              return;
            }

            if (done) {
              subscriber.complete();
            } else {
              subscriber.next(value);
            }
          }, 0, true);
        });
        return function () {
          return isFunction$4(iterator$1 === null || iterator$1 === void 0 ? void 0 : iterator$1.return) && iterator$1.return();
        };
      });
    }

    function scheduleAsyncIterable(input, scheduler) {
      if (!input) {
        throw new Error('Iterable cannot be null');
      }

      return new Observable(function (subscriber) {
        executeSchedule(subscriber, scheduler, function () {
          var iterator = input[Symbol.asyncIterator]();
          executeSchedule(subscriber, scheduler, function () {
            iterator.next().then(function (result) {
              if (result.done) {
                subscriber.complete();
              } else {
                subscriber.next(result.value);
              }
            });
          }, 0, true);
        });
      });
    }

    function scheduleReadableStreamLike(input, scheduler) {
      return scheduleAsyncIterable(readableStreamLikeToAsyncGenerator(input), scheduler);
    }

    function scheduled(input, scheduler) {
      if (input != null) {
        if (isInteropObservable(input)) {
          return scheduleObservable(input, scheduler);
        }

        if (isArrayLike$3(input)) {
          return scheduleArray(input, scheduler);
        }

        if (isPromise(input)) {
          return schedulePromise(input, scheduler);
        }

        if (isAsyncIterable(input)) {
          return scheduleAsyncIterable(input, scheduler);
        }

        if (isIterable$1(input)) {
          return scheduleIterable(input, scheduler);
        }

        if (isReadableStreamLike(input)) {
          return scheduleReadableStreamLike(input, scheduler);
        }
      }

      throw createInvalidObservableTypeError(input);
    }

    function from(input, scheduler) {
      return scheduler ? scheduled(input, scheduler) : innerFrom(input);
    }

    function of() {
      var args = [];

      for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
      }

      var scheduler = popScheduler(args);
      return from(args, scheduler);
    }

    var NotificationKind;

    (function (NotificationKind) {
      NotificationKind["NEXT"] = "N";
      NotificationKind["ERROR"] = "E";
      NotificationKind["COMPLETE"] = "C";
    })(NotificationKind || (NotificationKind = {}));

    var EmptyError = createErrorClass(function (_super) {
      return function EmptyErrorImpl() {
        _super(this);

        this.name = 'EmptyError';
        this.message = 'no elements in sequence';
      };
    });

    function lastValueFrom(source, config) {
      var hasConfig = typeof config === 'object';
      return new Promise(function (resolve, reject) {
        var _hasValue = false;

        var _value;

        source.subscribe({
          next: function (value) {
            _value = value;
            _hasValue = true;
          },
          error: reject,
          complete: function () {
            if (_hasValue) {
              resolve(_value);
            } else if (hasConfig) {
              resolve(config.defaultValue);
            } else {
              reject(new EmptyError());
            }
          }
        });
      });
    }

    function firstValueFrom(source, config) {
      var hasConfig = typeof config === 'object';
      return new Promise(function (resolve, reject) {
        var subscriber = new SafeSubscriber({
          next: function (value) {
            resolve(value);
            subscriber.unsubscribe();
          },
          error: reject,
          complete: function () {
            if (hasConfig) {
              resolve(config.defaultValue);
            } else {
              reject(new EmptyError());
            }
          }
        });
        source.subscribe(subscriber);
      });
    }

    createErrorClass(function (_super) {
      return function ArgumentOutOfRangeErrorImpl() {
        _super(this);

        this.name = 'ArgumentOutOfRangeError';
        this.message = 'argument out of range';
      };
    });

    var NotFoundError = createErrorClass(function (_super) {
      return function NotFoundErrorImpl(message) {
        _super(this);

        this.name = 'NotFoundError';
        this.message = message;
      };
    });

    var SequenceError = createErrorClass(function (_super) {
      return function SequenceErrorImpl(message) {
        _super(this);

        this.name = 'SequenceError';
        this.message = message;
      };
    });

    createErrorClass(function (_super) {
      return function TimeoutErrorImpl(info) {
        if (info === void 0) {
          info = null;
        }

        _super(this);

        this.message = 'Timeout has occurred';
        this.name = 'TimeoutError';
        this.info = info;
      };
    });

    function map(project, thisArg) {
      return operate(function (source, subscriber) {
        var index = 0;
        source.subscribe(createOperatorSubscriber(subscriber, function (value) {
          subscriber.next(project.call(thisArg, value, index++));
        }));
      });
    }

    var isArray$b = Array.isArray;

    function callOrApply(fn, args) {
      return isArray$b(args) ? fn.apply(void 0, __spreadArray([], __read(args))) : fn(args);
    }

    function mapOneOrManyArgs(fn) {
      return map(function (args) {
        return callOrApply(fn, args);
      });
    }

    var isArray$a = Array.isArray;
    var getPrototypeOf = Object.getPrototypeOf,
        objectProto$f = Object.prototype,
        getKeys = Object.keys;
    function argsArgArrayOrObject(args) {
      if (args.length === 1) {
        var first_1 = args[0];

        if (isArray$a(first_1)) {
          return {
            args: first_1,
            keys: null
          };
        }

        if (isPOJO(first_1)) {
          var keys = getKeys(first_1);
          return {
            args: keys.map(function (key) {
              return first_1[key];
            }),
            keys: keys
          };
        }
      }

      return {
        args: args,
        keys: null
      };
    }

    function isPOJO(obj) {
      return obj && typeof obj === 'object' && getPrototypeOf(obj) === objectProto$f;
    }

    function createObject(keys, values) {
      return keys.reduce(function (result, key, i) {
        return result[key] = values[i], result;
      }, {});
    }

    function mergeInternals(source, subscriber, project, concurrent, onBeforeNext, expand, innerSubScheduler, additionalFinalizer) {
      var buffer = [];
      var active = 0;
      var index = 0;
      var isComplete = false;

      var checkComplete = function () {
        if (isComplete && !buffer.length && !active) {
          subscriber.complete();
        }
      };

      var outerNext = function (value) {
        return active < concurrent ? doInnerSub(value) : buffer.push(value);
      };

      var doInnerSub = function (value) {
        expand && subscriber.next(value);
        active++;
        var innerComplete = false;
        innerFrom(project(value, index++)).subscribe(createOperatorSubscriber(subscriber, function (innerValue) {
          onBeforeNext === null || onBeforeNext === void 0 ? void 0 : onBeforeNext(innerValue);

          if (expand) {
            outerNext(innerValue);
          } else {
            subscriber.next(innerValue);
          }
        }, function () {
          innerComplete = true;
        }, undefined, function () {
          if (innerComplete) {
            try {
              active--;

              var _loop_1 = function () {
                var bufferedValue = buffer.shift();

                if (innerSubScheduler) {
                  executeSchedule(subscriber, innerSubScheduler, function () {
                    return doInnerSub(bufferedValue);
                  });
                } else {
                  doInnerSub(bufferedValue);
                }
              };

              while (buffer.length && active < concurrent) {
                _loop_1();
              }

              checkComplete();
            } catch (err) {
              subscriber.error(err);
            }
          }
        }));
      };

      source.subscribe(createOperatorSubscriber(subscriber, outerNext, function () {
        isComplete = true;
        checkComplete();
      }));
      return function () {
        additionalFinalizer === null || additionalFinalizer === void 0 ? void 0 : additionalFinalizer();
      };
    }

    function mergeMap(project, resultSelector, concurrent) {
      if (concurrent === void 0) {
        concurrent = Infinity;
      }

      if (isFunction$4(resultSelector)) {
        return mergeMap(function (a, i) {
          return map(function (b, ii) {
            return resultSelector(a, b, i, ii);
          })(innerFrom(project(a, i)));
        }, concurrent);
      } else if (typeof resultSelector === 'number') {
        concurrent = resultSelector;
      }

      return operate(function (source, subscriber) {
        return mergeInternals(source, subscriber, project, concurrent);
      });
    }

    function mergeAll(concurrent) {
      if (concurrent === void 0) {
        concurrent = Infinity;
      }

      return mergeMap(identity, concurrent);
    }

    function concatAll() {
      return mergeAll(1);
    }

    function concat$1() {
      var args = [];

      for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
      }

      return concatAll()(from(args, popScheduler(args)));
    }

    function forkJoin() {
      var args = [];

      for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
      }

      var resultSelector = popResultSelector(args);

      var _a = argsArgArrayOrObject(args),
          sources = _a.args,
          keys = _a.keys;

      var result = new Observable(function (subscriber) {
        var length = sources.length;

        if (!length) {
          subscriber.complete();
          return;
        }

        var values = new Array(length);
        var remainingCompletions = length;
        var remainingEmissions = length;

        var _loop_1 = function (sourceIndex) {
          var hasValue = false;
          innerFrom(sources[sourceIndex]).subscribe(createOperatorSubscriber(subscriber, function (value) {
            if (!hasValue) {
              hasValue = true;
              remainingEmissions--;
            }

            values[sourceIndex] = value;
          }, function () {
            return remainingCompletions--;
          }, undefined, function () {
            if (!remainingCompletions || !hasValue) {
              if (!remainingEmissions) {
                subscriber.next(keys ? createObject(keys, values) : values);
              }

              subscriber.complete();
            }
          }));
        };

        for (var sourceIndex = 0; sourceIndex < length; sourceIndex++) {
          _loop_1(sourceIndex);
        }
      });
      return resultSelector ? result.pipe(mapOneOrManyArgs(resultSelector)) : result;
    }

    function merge() {
      var args = [];

      for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
      }

      var scheduler = popScheduler(args);
      var concurrent = popNumber(args, Infinity);
      var sources = args;
      return !sources.length ? EMPTY$1 : sources.length === 1 ? innerFrom(sources[0]) : mergeAll(concurrent)(from(sources, scheduler));
    }

    new Observable(noop);

    function not(pred, thisArg) {
      return function (value, index) {
        return !pred.call(thisArg, value, index);
      };
    }

    function filter(predicate, thisArg) {
      return operate(function (source, subscriber) {
        var index = 0;
        source.subscribe(createOperatorSubscriber(subscriber, function (value) {
          return predicate.call(thisArg, value, index++) && subscriber.next(value);
        }));
      });
    }

    function partition$1(source, predicate, thisArg) {
      return [filter(predicate, thisArg)(innerFrom(source)), filter(not(predicate, thisArg))(innerFrom(source))];
    }

    function bufferTime(bufferTimeSpan) {
      var _a, _b;

      var otherArgs = [];

      for (var _i = 1; _i < arguments.length; _i++) {
        otherArgs[_i - 1] = arguments[_i];
      }

      var scheduler = (_a = popScheduler(otherArgs)) !== null && _a !== void 0 ? _a : asyncScheduler;
      var bufferCreationInterval = (_b = otherArgs[0]) !== null && _b !== void 0 ? _b : null;
      var maxBufferSize = otherArgs[1] || Infinity;
      return operate(function (source, subscriber) {
        var bufferRecords = [];
        var restartOnEmit = false;

        var emit = function (record) {
          var buffer = record.buffer,
              subs = record.subs;
          subs.unsubscribe();
          arrRemove(bufferRecords, record);
          subscriber.next(buffer);
          restartOnEmit && startBuffer();
        };

        var startBuffer = function () {
          if (bufferRecords) {
            var subs = new Subscription();
            subscriber.add(subs);
            var buffer = [];
            var record_1 = {
              buffer: buffer,
              subs: subs
            };
            bufferRecords.push(record_1);
            executeSchedule(subs, scheduler, function () {
              return emit(record_1);
            }, bufferTimeSpan);
          }
        };

        if (bufferCreationInterval !== null && bufferCreationInterval >= 0) {
          executeSchedule(subscriber, scheduler, startBuffer, bufferCreationInterval, true);
        } else {
          restartOnEmit = true;
        }

        startBuffer();
        var bufferTimeSubscriber = createOperatorSubscriber(subscriber, function (value) {
          var e_1, _a;

          var recordsCopy = bufferRecords.slice();

          try {
            for (var recordsCopy_1 = __values(recordsCopy), recordsCopy_1_1 = recordsCopy_1.next(); !recordsCopy_1_1.done; recordsCopy_1_1 = recordsCopy_1.next()) {
              var record = recordsCopy_1_1.value;
              var buffer = record.buffer;
              buffer.push(value);
              maxBufferSize <= buffer.length && emit(record);
            }
          } catch (e_1_1) {
            e_1 = {
              error: e_1_1
            };
          } finally {
            try {
              if (recordsCopy_1_1 && !recordsCopy_1_1.done && (_a = recordsCopy_1.return)) _a.call(recordsCopy_1);
            } finally {
              if (e_1) throw e_1.error;
            }
          }
        }, function () {
          while (bufferRecords === null || bufferRecords === void 0 ? void 0 : bufferRecords.length) {
            subscriber.next(bufferRecords.shift().buffer);
          }

          bufferTimeSubscriber === null || bufferTimeSubscriber === void 0 ? void 0 : bufferTimeSubscriber.unsubscribe();
          subscriber.complete();
          subscriber.unsubscribe();
        }, undefined, function () {
          return bufferRecords = null;
        });
        source.subscribe(bufferTimeSubscriber);
      });
    }

    function scanInternals(accumulator, seed, hasSeed, emitOnNext, emitBeforeComplete) {
      return function (source, subscriber) {
        var hasState = hasSeed;
        var state = seed;
        var index = 0;
        source.subscribe(createOperatorSubscriber(subscriber, function (value) {
          var i = index++;
          state = hasState ? accumulator(state, value, i) : (hasState = true, value);
          emitOnNext && subscriber.next(state);
        }, emitBeforeComplete && function () {
          hasState && subscriber.next(state);
          subscriber.complete();
        }));
      };
    }

    function reduce(accumulator, seed) {
      return operate(scanInternals(accumulator, seed, arguments.length >= 2, false, true));
    }

    var arrReducer = function (arr, value) {
      return arr.push(value), arr;
    };

    function toArray() {
      return operate(function (source, subscriber) {
        reduce(arrReducer, [])(source).subscribe(subscriber);
      });
    }

    function fromSubscribable(subscribable) {
      return new Observable(function (subscriber) {
        return subscribable.subscribe(subscriber);
      });
    }

    var DEFAULT_CONFIG = {
      connector: function () {
        return new Subject();
      }
    };
    function connect(selector, config) {
      if (config === void 0) {
        config = DEFAULT_CONFIG;
      }

      var connector = config.connector;
      return operate(function (source, subscriber) {
        var subject = connector();
        from(selector(fromSubscribable(subject))).subscribe(subscriber);
        subscriber.add(source.subscribe(subject));
      });
    }

    function defaultIfEmpty(defaultValue) {
      return operate(function (source, subscriber) {
        var hasValue = false;
        source.subscribe(createOperatorSubscriber(subscriber, function (value) {
          hasValue = true;
          subscriber.next(value);
        }, function () {
          if (!hasValue) {
            subscriber.next(defaultValue);
          }

          subscriber.complete();
        }));
      });
    }

    function take(count) {
      return count <= 0 ? function () {
        return EMPTY$1;
      } : operate(function (source, subscriber) {
        var seen = 0;
        source.subscribe(createOperatorSubscriber(subscriber, function (value) {
          if (++seen <= count) {
            subscriber.next(value);

            if (count <= seen) {
              subscriber.complete();
            }
          }
        }));
      });
    }

    function ignoreElements() {
      return operate(function (source, subscriber) {
        source.subscribe(createOperatorSubscriber(subscriber, noop));
      });
    }

    function mapTo(value) {
      return map(function () {
        return value;
      });
    }

    function delayWhen(delayDurationSelector, subscriptionDelay) {
      if (subscriptionDelay) {
        return function (source) {
          return concat$1(subscriptionDelay.pipe(take(1), ignoreElements()), source.pipe(delayWhen(delayDurationSelector)));
        };
      }

      return mergeMap(function (value, index) {
        return delayDurationSelector(value, index).pipe(take(1), mapTo(value));
      });
    }

    function distinct(keySelector, flushes) {
      return operate(function (source, subscriber) {
        var distinctKeys = new Set();
        source.subscribe(createOperatorSubscriber(subscriber, function (value) {
          var key = keySelector ? keySelector(value) : value;

          if (!distinctKeys.has(key)) {
            distinctKeys.add(key);
            subscriber.next(value);
          }
        }));
        flushes === null || flushes === void 0 ? void 0 : flushes.subscribe(createOperatorSubscriber(subscriber, function () {
          return distinctKeys.clear();
        }, noop));
      });
    }

    function expand(project, concurrent, scheduler) {
      if (concurrent === void 0) {
        concurrent = Infinity;
      }

      concurrent = (concurrent || 0) < 1 ? Infinity : concurrent;
      return operate(function (source, subscriber) {
        return mergeInternals(source, subscriber, project, concurrent, undefined, true, scheduler);
      });
    }

    function groupBy$1(keySelector, elementOrOptions, duration, connector) {
      return operate(function (source, subscriber) {
        var element;

        if (!elementOrOptions || typeof elementOrOptions === 'function') {
          element = elementOrOptions;
        } else {
          duration = elementOrOptions.duration, element = elementOrOptions.element, connector = elementOrOptions.connector;
        }

        var groups = new Map();

        var notify = function (cb) {
          groups.forEach(cb);
          cb(subscriber);
        };

        var handleError = function (err) {
          return notify(function (consumer) {
            return consumer.error(err);
          });
        };

        var activeGroups = 0;
        var teardownAttempted = false;
        var groupBySourceSubscriber = new OperatorSubscriber(subscriber, function (value) {
          try {
            var key_1 = keySelector(value);
            var group_1 = groups.get(key_1);

            if (!group_1) {
              groups.set(key_1, group_1 = connector ? connector() : new Subject());
              var grouped = createGroupedObservable(key_1, group_1);
              subscriber.next(grouped);

              if (duration) {
                var durationSubscriber_1 = createOperatorSubscriber(group_1, function () {
                  group_1.complete();
                  durationSubscriber_1 === null || durationSubscriber_1 === void 0 ? void 0 : durationSubscriber_1.unsubscribe();
                }, undefined, undefined, function () {
                  return groups.delete(key_1);
                });
                groupBySourceSubscriber.add(innerFrom(duration(grouped)).subscribe(durationSubscriber_1));
              }
            }

            group_1.next(element ? element(value) : value);
          } catch (err) {
            handleError(err);
          }
        }, function () {
          return notify(function (consumer) {
            return consumer.complete();
          });
        }, handleError, function () {
          return groups.clear();
        }, function () {
          teardownAttempted = true;
          return activeGroups === 0;
        });
        source.subscribe(groupBySourceSubscriber);

        function createGroupedObservable(key, groupSubject) {
          var result = new Observable(function (groupSubscriber) {
            activeGroups++;
            var innerSub = groupSubject.subscribe(groupSubscriber);
            return function () {
              innerSub.unsubscribe();
              --activeGroups === 0 && teardownAttempted && groupBySourceSubscriber.unsubscribe();
            };
          });
          result.key = key;
          return result;
        }
      });
    }

    function isEmpty$2() {
      return operate(function (source, subscriber) {
        source.subscribe(createOperatorSubscriber(subscriber, function () {
          subscriber.next(false);
          subscriber.complete();
        }, function () {
          subscriber.next(true);
          subscriber.complete();
        }));
      });
    }

    function takeLast(count) {
      return count <= 0 ? function () {
        return EMPTY$1;
      } : operate(function (source, subscriber) {
        var buffer = [];
        source.subscribe(createOperatorSubscriber(subscriber, function (value) {
          buffer.push(value);
          count < buffer.length && buffer.shift();
        }, function () {
          var e_1, _a;

          try {
            for (var buffer_1 = __values(buffer), buffer_1_1 = buffer_1.next(); !buffer_1_1.done; buffer_1_1 = buffer_1.next()) {
              var value = buffer_1_1.value;
              subscriber.next(value);
            }
          } catch (e_1_1) {
            e_1 = {
              error: e_1_1
            };
          } finally {
            try {
              if (buffer_1_1 && !buffer_1_1.done && (_a = buffer_1.return)) _a.call(buffer_1);
            } finally {
              if (e_1) throw e_1.error;
            }
          }

          subscriber.complete();
        }, undefined, function () {
          buffer = null;
        }));
      });
    }

    function scan(accumulator, seed) {
      return operate(scanInternals(accumulator, seed, arguments.length >= 2, true));
    }

    function share(options) {
      if (options === void 0) {
        options = {};
      }

      var _a = options.connector,
          connector = _a === void 0 ? function () {
        return new Subject();
      } : _a,
          _b = options.resetOnError,
          resetOnError = _b === void 0 ? true : _b,
          _c = options.resetOnComplete,
          resetOnComplete = _c === void 0 ? true : _c,
          _d = options.resetOnRefCountZero,
          resetOnRefCountZero = _d === void 0 ? true : _d;
      return function (wrapperSource) {
        var connection = null;
        var resetConnection = null;
        var subject = null;
        var refCount = 0;
        var hasCompleted = false;
        var hasErrored = false;

        var cancelReset = function () {
          resetConnection === null || resetConnection === void 0 ? void 0 : resetConnection.unsubscribe();
          resetConnection = null;
        };

        var reset = function () {
          cancelReset();
          connection = subject = null;
          hasCompleted = hasErrored = false;
        };

        var resetAndUnsubscribe = function () {
          var conn = connection;
          reset();
          conn === null || conn === void 0 ? void 0 : conn.unsubscribe();
        };

        return operate(function (source, subscriber) {
          refCount++;

          if (!hasErrored && !hasCompleted) {
            cancelReset();
          }

          var dest = subject = subject !== null && subject !== void 0 ? subject : connector();
          subscriber.add(function () {
            refCount--;

            if (refCount === 0 && !hasErrored && !hasCompleted) {
              resetConnection = handleReset(resetAndUnsubscribe, resetOnRefCountZero);
            }
          });
          dest.subscribe(subscriber);

          if (!connection) {
            connection = new SafeSubscriber({
              next: function (value) {
                return dest.next(value);
              },
              error: function (err) {
                hasErrored = true;
                cancelReset();
                resetConnection = handleReset(reset, resetOnError, err);
                dest.error(err);
              },
              complete: function () {
                hasCompleted = true;
                cancelReset();
                resetConnection = handleReset(reset, resetOnComplete);
                dest.complete();
              }
            });
            from(source).subscribe(connection);
          }
        })(wrapperSource);
      };
    }

    function handleReset(reset, on) {
      var args = [];

      for (var _i = 2; _i < arguments.length; _i++) {
        args[_i - 2] = arguments[_i];
      }

      if (on === true) {
        reset();
        return null;
      }

      if (on === false) {
        return null;
      }

      return on.apply(void 0, __spreadArray([], __read(args))).pipe(take(1)).subscribe(function () {
        return reset();
      });
    }

    function shareReplay(configOrBufferSize, windowTime, scheduler) {
      var _a, _b, _c;

      var bufferSize;
      var refCount = false;

      if (configOrBufferSize && typeof configOrBufferSize === 'object') {
        _a = configOrBufferSize.bufferSize, bufferSize = _a === void 0 ? Infinity : _a, _b = configOrBufferSize.windowTime, windowTime = _b === void 0 ? Infinity : _b, _c = configOrBufferSize.refCount, refCount = _c === void 0 ? false : _c, scheduler = configOrBufferSize.scheduler;
      } else {
        bufferSize = configOrBufferSize !== null && configOrBufferSize !== void 0 ? configOrBufferSize : Infinity;
      }

      return share({
        connector: function () {
          return new ReplaySubject(bufferSize, windowTime, scheduler);
        },
        resetOnError: true,
        resetOnComplete: false,
        resetOnRefCountZero: refCount
      });
    }

    function single(predicate) {
      return operate(function (source, subscriber) {
        var hasValue = false;
        var singleValue;
        var seenValue = false;
        var index = 0;
        source.subscribe(createOperatorSubscriber(subscriber, function (value) {
          seenValue = true;

          if (!predicate || predicate(value, index++, source)) {
            hasValue && subscriber.error(new SequenceError('Too many matching values'));
            hasValue = true;
            singleValue = value;
          }
        }, function () {
          if (hasValue) {
            subscriber.next(singleValue);
            subscriber.complete();
          } else {
            subscriber.error(seenValue ? new NotFoundError('No matching values') : new EmptyError());
          }
        }));
      });
    }

    function tap(observerOrNext, error, complete) {
      var tapObserver = isFunction$4(observerOrNext) || error || complete ? {
        next: observerOrNext,
        error: error,
        complete: complete
      } : observerOrNext;
      return tapObserver ? operate(function (source, subscriber) {
        var _a;

        (_a = tapObserver.subscribe) === null || _a === void 0 ? void 0 : _a.call(tapObserver);
        var isUnsub = true;
        source.subscribe(createOperatorSubscriber(subscriber, function (value) {
          var _a;

          (_a = tapObserver.next) === null || _a === void 0 ? void 0 : _a.call(tapObserver, value);
          subscriber.next(value);
        }, function () {
          var _a;

          isUnsub = false;
          (_a = tapObserver.complete) === null || _a === void 0 ? void 0 : _a.call(tapObserver);
          subscriber.complete();
        }, function (err) {
          var _a;

          isUnsub = false;
          (_a = tapObserver.error) === null || _a === void 0 ? void 0 : _a.call(tapObserver, err);
          subscriber.error(err);
        }, function () {
          var _a, _b;

          if (isUnsub) {
            (_a = tapObserver.unsubscribe) === null || _a === void 0 ? void 0 : _a.call(tapObserver);
          }

          (_b = tapObserver.finalize) === null || _b === void 0 ? void 0 : _b.call(tapObserver);
        }));
      }) : identity;
    }

    function withLatestFrom() {
      var inputs = [];

      for (var _i = 0; _i < arguments.length; _i++) {
        inputs[_i] = arguments[_i];
      }

      var project = popResultSelector(inputs);
      return operate(function (source, subscriber) {
        var len = inputs.length;
        var otherValues = new Array(len);
        var hasValue = inputs.map(function () {
          return false;
        });
        var ready = false;

        var _loop_1 = function (i) {
          innerFrom(inputs[i]).subscribe(createOperatorSubscriber(subscriber, function (value) {
            otherValues[i] = value;

            if (!ready && !hasValue[i]) {
              hasValue[i] = true;
              (ready = hasValue.every(identity)) && (hasValue = null);
            }
          }, noop));
        };

        for (var i = 0; i < len; i++) {
          _loop_1(i);
        }

        source.subscribe(createOperatorSubscriber(subscriber, function (value) {
          if (ready) {
            var values = __spreadArray([value], __read(otherValues));

            subscriber.next(project ? project.apply(void 0, __spreadArray([], __read(values))) : values);
          }
        }));
      });
    }

    class Deferred {
      constructor() {
        this.resolve = null;
        this.reject = null;
        this.promise = new Promise((a, b) => {
          this.resolve = a;
          this.reject = b;
        });
      }

    }

    Promise.resolve();
    /**
     * Will subscribe to the `source` observable provided,
     *
     * Allowing a `for await..of` loop to iterate over every
     * value that the source emits.
     *
     * **WARNING**: If the async loop is slower than the observable
     * producing values, the values will build up in a buffer
     * and you could experience an out of memory error.
     *
     * This is a lossless subscription method. No value
     * will be missed or duplicated.
     *
     * Example usage:
     *
     * ```ts
     * async function test() {
     *   const source$ = getSomeObservable();
     *
     *   for await(const value of eachValueFrom(source$)) {
     *     console.log(value);
     *   }
     * }
     * ```
     *
     * @param source the Observable source to await values from
     */

    async function* eachValueFrom(source) {
      const deferreds = [];
      const values = [];
      let hasError = false;
      let error = null;
      let completed = false;
      const subs = source.subscribe({
        next: value => {
          if (deferreds.length > 0) {
            deferreds.shift().resolve({
              value,
              done: false
            });
          } else {
            values.push(value);
          }
        },
        error: err => {
          hasError = true;
          error = err;

          while (deferreds.length > 0) {
            deferreds.shift().reject(err);
          }
        },
        complete: () => {
          completed = true;

          while (deferreds.length > 0) {
            deferreds.shift().resolve({
              value: undefined,
              done: true
            });
          }
        }
      });

      try {
        while (true) {
          if (values.length > 0) {
            yield values.shift();
          } else if (completed) {
            return;
          } else if (hasError) {
            throw error;
          } else {
            const d = new Deferred();
            deferreds.push(d);
            const result = await d.promise;

            if (result.done) {
              return;
            } else {
              yield result.value;
            }
          }
        }
      } catch (err) {
        throw err;
      } finally {
        subs.unsubscribe();
      }
    }

    var _StackSubject_primed, _StackSubject_stack;
    /**
     * A sort of stack buffer.  It emit elements only when something has called
     * {@link StackSubject.pop pop()}, allowing you to rate limit but also
     * prioritize the latest values.
     *
     * Even though this will multicast by nature of being a {@link Subject},
     * anything can call {@link StackSubject.pop pop()} to trigger the next
     * emission.  It is recommended to limit ownership of this method to
     * properly implement rate-limiting.
     */
    class StackSubject extends Subject {
        constructor(primed = false) {
            super();
            /** When `true`, the stack should emit its next value. */
            _StackSubject_primed.set(this, void 0);
            /** The internal stack. */
            _StackSubject_stack.set(this, void 0);
            __classPrivateFieldSet(this, _StackSubject_stack, [], "f");
            __classPrivateFieldSet(this, _StackSubject_primed, primed, "f");
        }
        /**
         * Provides a value to the stack.  If the subject is currently primed,
         * it will immediately emit the value and leave the primed state.
         */
        next(value) {
            if (__classPrivateFieldGet(this, _StackSubject_primed, "f")) {
                __classPrivateFieldSet(this, _StackSubject_primed, false, "f");
                super.next(value);
                return;
            }
            __classPrivateFieldGet(this, _StackSubject_stack, "f").push(value);
        }
        /** Just an alias of `next` with stack semantics. */
        push(value) {
            this.next(value);
        }
        /**
         * Tells this subject some consumer is ready to receive the latest
         * stack value.  If it has none to emit, it will transition to its
         * primed state and will immediately emit the next value it receives.
         */
        pop() {
            if (__classPrivateFieldGet(this, _StackSubject_stack, "f").length === 0)
                __classPrivateFieldSet(this, _StackSubject_primed, true, "f");
            else
                super.next(__classPrivateFieldGet(this, _StackSubject_stack, "f").pop());
        }
    }
    _StackSubject_primed = new WeakMap(), _StackSubject_stack = new WeakMap();

    var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

    /**
     * The base implementation of `_.hasIn` without support for deep paths.
     *
     * @private
     * @param {Object} [object] The object to query.
     * @param {Array|string} key The key to check.
     * @returns {boolean} Returns `true` if `key` exists, else `false`.
     */

    function baseHasIn$1(object, key) {
      return object != null && key in Object(object);
    }

    var _baseHasIn = baseHasIn$1;

    /**
     * Checks if `value` is classified as an `Array` object.
     *
     * @static
     * @memberOf _
     * @since 0.1.0
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is an array, else `false`.
     * @example
     *
     * _.isArray([1, 2, 3]);
     * // => true
     *
     * _.isArray(document.body.children);
     * // => false
     *
     * _.isArray('abc');
     * // => false
     *
     * _.isArray(_.noop);
     * // => false
     */
    var isArray$9 = Array.isArray;
    var isArray_1 = isArray$9;

    /** Detect free variable `global` from Node.js. */
    var freeGlobal$1 = typeof commonjsGlobal == 'object' && commonjsGlobal && commonjsGlobal.Object === Object && commonjsGlobal;
    var _freeGlobal = freeGlobal$1;

    var freeGlobal = _freeGlobal;
    /** Detect free variable `self`. */

    var freeSelf = typeof self == 'object' && self && self.Object === Object && self;
    /** Used as a reference to the global object. */

    var root$8 = freeGlobal || freeSelf || Function('return this')();
    var _root = root$8;

    var root$7 = _root;
    /** Built-in value references. */

    var Symbol$6 = root$7.Symbol;
    var _Symbol = Symbol$6;

    var Symbol$5 = _Symbol;
    /** Used for built-in method references. */

    var objectProto$e = Object.prototype;
    /** Used to check objects for own properties. */

    var hasOwnProperty$b = objectProto$e.hasOwnProperty;
    /**
     * Used to resolve the
     * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
     * of values.
     */

    var nativeObjectToString$1 = objectProto$e.toString;
    /** Built-in value references. */

    var symToStringTag$1 = Symbol$5 ? Symbol$5.toStringTag : undefined;
    /**
     * A specialized version of `baseGetTag` which ignores `Symbol.toStringTag` values.
     *
     * @private
     * @param {*} value The value to query.
     * @returns {string} Returns the raw `toStringTag`.
     */

    function getRawTag$1(value) {
      var isOwn = hasOwnProperty$b.call(value, symToStringTag$1),
          tag = value[symToStringTag$1];

      try {
        value[symToStringTag$1] = undefined;
        var unmasked = true;
      } catch (e) {}

      var result = nativeObjectToString$1.call(value);

      if (unmasked) {
        if (isOwn) {
          value[symToStringTag$1] = tag;
        } else {
          delete value[symToStringTag$1];
        }
      }

      return result;
    }

    var _getRawTag = getRawTag$1;

    /** Used for built-in method references. */
    var objectProto$d = Object.prototype;
    /**
     * Used to resolve the
     * [`toStringTag`](http://ecma-international.org/ecma-262/7.0/#sec-object.prototype.tostring)
     * of values.
     */

    var nativeObjectToString = objectProto$d.toString;
    /**
     * Converts `value` to a string using `Object.prototype.toString`.
     *
     * @private
     * @param {*} value The value to convert.
     * @returns {string} Returns the converted string.
     */

    function objectToString$1(value) {
      return nativeObjectToString.call(value);
    }

    var _objectToString = objectToString$1;

    var Symbol$4 = _Symbol,
        getRawTag = _getRawTag,
        objectToString = _objectToString;
    /** `Object#toString` result references. */

    var nullTag = '[object Null]',
        undefinedTag = '[object Undefined]';
    /** Built-in value references. */

    var symToStringTag = Symbol$4 ? Symbol$4.toStringTag : undefined;
    /**
     * The base implementation of `getTag` without fallbacks for buggy environments.
     *
     * @private
     * @param {*} value The value to query.
     * @returns {string} Returns the `toStringTag`.
     */

    function baseGetTag$5(value) {
      if (value == null) {
        return value === undefined ? undefinedTag : nullTag;
      }

      return symToStringTag && symToStringTag in Object(value) ? getRawTag(value) : objectToString(value);
    }

    var _baseGetTag = baseGetTag$5;

    /**
     * Checks if `value` is object-like. A value is object-like if it's not `null`
     * and has a `typeof` result of "object".
     *
     * @static
     * @memberOf _
     * @since 4.0.0
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
     * @example
     *
     * _.isObjectLike({});
     * // => true
     *
     * _.isObjectLike([1, 2, 3]);
     * // => true
     *
     * _.isObjectLike(_.noop);
     * // => false
     *
     * _.isObjectLike(null);
     * // => false
     */

    function isObjectLike$7(value) {
      return value != null && typeof value == 'object';
    }

    var isObjectLike_1 = isObjectLike$7;

    var baseGetTag$4 = _baseGetTag,
        isObjectLike$6 = isObjectLike_1;
    /** `Object#toString` result references. */

    var symbolTag$3 = '[object Symbol]';
    /**
     * Checks if `value` is classified as a `Symbol` primitive or object.
     *
     * @static
     * @memberOf _
     * @since 4.0.0
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a symbol, else `false`.
     * @example
     *
     * _.isSymbol(Symbol.iterator);
     * // => true
     *
     * _.isSymbol('abc');
     * // => false
     */

    function isSymbol$4(value) {
      return typeof value == 'symbol' || isObjectLike$6(value) && baseGetTag$4(value) == symbolTag$3;
    }

    var isSymbol_1 = isSymbol$4;

    var isArray$8 = isArray_1,
        isSymbol$3 = isSymbol_1;
    /** Used to match property names within property paths. */

    var reIsDeepProp = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/,
        reIsPlainProp = /^\w*$/;
    /**
     * Checks if `value` is a property name and not a property path.
     *
     * @private
     * @param {*} value The value to check.
     * @param {Object} [object] The object to query keys on.
     * @returns {boolean} Returns `true` if `value` is a property name, else `false`.
     */

    function isKey$1(value, object) {
      if (isArray$8(value)) {
        return false;
      }

      var type = typeof value;

      if (type == 'number' || type == 'symbol' || type == 'boolean' || value == null || isSymbol$3(value)) {
        return true;
      }

      return reIsPlainProp.test(value) || !reIsDeepProp.test(value) || object != null && value in Object(object);
    }

    var _isKey = isKey$1;

    /**
     * Checks if `value` is the
     * [language type](http://www.ecma-international.org/ecma-262/7.0/#sec-ecmascript-language-types)
     * of `Object`. (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
     *
     * @static
     * @memberOf _
     * @since 0.1.0
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is an object, else `false`.
     * @example
     *
     * _.isObject({});
     * // => true
     *
     * _.isObject([1, 2, 3]);
     * // => true
     *
     * _.isObject(_.noop);
     * // => true
     *
     * _.isObject(null);
     * // => false
     */

    function isObject$8(value) {
      var type = typeof value;
      return value != null && (type == 'object' || type == 'function');
    }

    var isObject_1 = isObject$8;

    var baseGetTag$3 = _baseGetTag,
        isObject$7 = isObject_1;
    /** `Object#toString` result references. */

    var asyncTag = '[object AsyncFunction]',
        funcTag$2 = '[object Function]',
        genTag$1 = '[object GeneratorFunction]',
        proxyTag = '[object Proxy]';
    /**
     * Checks if `value` is classified as a `Function` object.
     *
     * @static
     * @memberOf _
     * @since 0.1.0
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a function, else `false`.
     * @example
     *
     * _.isFunction(_);
     * // => true
     *
     * _.isFunction(/abc/);
     * // => false
     */

    function isFunction$3(value) {
      if (!isObject$7(value)) {
        return false;
      } // The use of `Object#toString` avoids issues with the `typeof` operator
      // in Safari 9 which returns 'object' for typed arrays and other constructors.


      var tag = baseGetTag$3(value);
      return tag == funcTag$2 || tag == genTag$1 || tag == asyncTag || tag == proxyTag;
    }

    var isFunction_1 = isFunction$3;

    var root$6 = _root;
    /** Used to detect overreaching core-js shims. */

    var coreJsData$1 = root$6['__core-js_shared__'];
    var _coreJsData = coreJsData$1;

    var coreJsData = _coreJsData;
    /** Used to detect methods masquerading as native. */

    var maskSrcKey = function () {
      var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || '');
      return uid ? 'Symbol(src)_1.' + uid : '';
    }();
    /**
     * Checks if `func` has its source masked.
     *
     * @private
     * @param {Function} func The function to check.
     * @returns {boolean} Returns `true` if `func` is masked, else `false`.
     */


    function isMasked$1(func) {
      return !!maskSrcKey && maskSrcKey in func;
    }

    var _isMasked = isMasked$1;

    /** Used for built-in method references. */
    var funcProto$1 = Function.prototype;
    /** Used to resolve the decompiled source of functions. */

    var funcToString$1 = funcProto$1.toString;
    /**
     * Converts `func` to its source code.
     *
     * @private
     * @param {Function} func The function to convert.
     * @returns {string} Returns the source code.
     */

    function toSource$2(func) {
      if (func != null) {
        try {
          return funcToString$1.call(func);
        } catch (e) {}

        try {
          return func + '';
        } catch (e) {}
      }

      return '';
    }

    var _toSource = toSource$2;

    var isFunction$2 = isFunction_1,
        isMasked = _isMasked,
        isObject$6 = isObject_1,
        toSource$1 = _toSource;
    /**
     * Used to match `RegExp`
     * [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
     */

    var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
    /** Used to detect host constructors (Safari). */

    var reIsHostCtor = /^\[object .+?Constructor\]$/;
    /** Used for built-in method references. */

    var funcProto = Function.prototype,
        objectProto$c = Object.prototype;
    /** Used to resolve the decompiled source of functions. */

    var funcToString = funcProto.toString;
    /** Used to check objects for own properties. */

    var hasOwnProperty$a = objectProto$c.hasOwnProperty;
    /** Used to detect if a method is native. */

    var reIsNative = RegExp('^' + funcToString.call(hasOwnProperty$a).replace(reRegExpChar, '\\$&').replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$');
    /**
     * The base implementation of `_.isNative` without bad shim checks.
     *
     * @private
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a native function,
     *  else `false`.
     */

    function baseIsNative$1(value) {
      if (!isObject$6(value) || isMasked(value)) {
        return false;
      }

      var pattern = isFunction$2(value) ? reIsNative : reIsHostCtor;
      return pattern.test(toSource$1(value));
    }

    var _baseIsNative = baseIsNative$1;

    /**
     * Gets the value at `key` of `object`.
     *
     * @private
     * @param {Object} [object] The object to query.
     * @param {string} key The key of the property to get.
     * @returns {*} Returns the property value.
     */

    function getValue$1(object, key) {
      return object == null ? undefined : object[key];
    }

    var _getValue = getValue$1;

    var baseIsNative = _baseIsNative,
        getValue = _getValue;
    /**
     * Gets the native function at `key` of `object`.
     *
     * @private
     * @param {Object} object The object to query.
     * @param {string} key The key of the method to get.
     * @returns {*} Returns the function if it's native, else `undefined`.
     */

    function getNative$7(object, key) {
      var value = getValue(object, key);
      return baseIsNative(value) ? value : undefined;
    }

    var _getNative = getNative$7;

    var getNative$6 = _getNative;
    /* Built-in method references that are verified to be native. */

    var nativeCreate$4 = getNative$6(Object, 'create');
    var _nativeCreate = nativeCreate$4;

    var nativeCreate$3 = _nativeCreate;
    /**
     * Removes all key-value entries from the hash.
     *
     * @private
     * @name clear
     * @memberOf Hash
     */

    function hashClear$1() {
      this.__data__ = nativeCreate$3 ? nativeCreate$3(null) : {};
      this.size = 0;
    }

    var _hashClear = hashClear$1;

    /**
     * Removes `key` and its value from the hash.
     *
     * @private
     * @name delete
     * @memberOf Hash
     * @param {Object} hash The hash to modify.
     * @param {string} key The key of the value to remove.
     * @returns {boolean} Returns `true` if the entry was removed, else `false`.
     */

    function hashDelete$1(key) {
      var result = this.has(key) && delete this.__data__[key];
      this.size -= result ? 1 : 0;
      return result;
    }

    var _hashDelete = hashDelete$1;

    var nativeCreate$2 = _nativeCreate;
    /** Used to stand-in for `undefined` hash values. */

    var HASH_UNDEFINED$2 = '__lodash_hash_undefined__';
    /** Used for built-in method references. */

    var objectProto$b = Object.prototype;
    /** Used to check objects for own properties. */

    var hasOwnProperty$9 = objectProto$b.hasOwnProperty;
    /**
     * Gets the hash value for `key`.
     *
     * @private
     * @name get
     * @memberOf Hash
     * @param {string} key The key of the value to get.
     * @returns {*} Returns the entry value.
     */

    function hashGet$1(key) {
      var data = this.__data__;

      if (nativeCreate$2) {
        var result = data[key];
        return result === HASH_UNDEFINED$2 ? undefined : result;
      }

      return hasOwnProperty$9.call(data, key) ? data[key] : undefined;
    }

    var _hashGet = hashGet$1;

    var nativeCreate$1 = _nativeCreate;
    /** Used for built-in method references. */

    var objectProto$a = Object.prototype;
    /** Used to check objects for own properties. */

    var hasOwnProperty$8 = objectProto$a.hasOwnProperty;
    /**
     * Checks if a hash value for `key` exists.
     *
     * @private
     * @name has
     * @memberOf Hash
     * @param {string} key The key of the entry to check.
     * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
     */

    function hashHas$1(key) {
      var data = this.__data__;
      return nativeCreate$1 ? data[key] !== undefined : hasOwnProperty$8.call(data, key);
    }

    var _hashHas = hashHas$1;

    var nativeCreate = _nativeCreate;
    /** Used to stand-in for `undefined` hash values. */

    var HASH_UNDEFINED$1 = '__lodash_hash_undefined__';
    /**
     * Sets the hash `key` to `value`.
     *
     * @private
     * @name set
     * @memberOf Hash
     * @param {string} key The key of the value to set.
     * @param {*} value The value to set.
     * @returns {Object} Returns the hash instance.
     */

    function hashSet$1(key, value) {
      var data = this.__data__;
      this.size += this.has(key) ? 0 : 1;
      data[key] = nativeCreate && value === undefined ? HASH_UNDEFINED$1 : value;
      return this;
    }

    var _hashSet = hashSet$1;

    var hashClear = _hashClear,
        hashDelete = _hashDelete,
        hashGet = _hashGet,
        hashHas = _hashHas,
        hashSet = _hashSet;
    /**
     * Creates a hash object.
     *
     * @private
     * @constructor
     * @param {Array} [entries] The key-value pairs to cache.
     */

    function Hash$1(entries) {
      var index = -1,
          length = entries == null ? 0 : entries.length;
      this.clear();

      while (++index < length) {
        var entry = entries[index];
        this.set(entry[0], entry[1]);
      }
    } // Add methods to `Hash`.


    Hash$1.prototype.clear = hashClear;
    Hash$1.prototype['delete'] = hashDelete;
    Hash$1.prototype.get = hashGet;
    Hash$1.prototype.has = hashHas;
    Hash$1.prototype.set = hashSet;
    var _Hash = Hash$1;

    /**
     * Removes all key-value entries from the list cache.
     *
     * @private
     * @name clear
     * @memberOf ListCache
     */

    function listCacheClear$1() {
      this.__data__ = [];
      this.size = 0;
    }

    var _listCacheClear = listCacheClear$1;

    /**
     * Performs a
     * [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
     * comparison between two values to determine if they are equivalent.
     *
     * @static
     * @memberOf _
     * @since 4.0.0
     * @category Lang
     * @param {*} value The value to compare.
     * @param {*} other The other value to compare.
     * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
     * @example
     *
     * var object = { 'a': 1 };
     * var other = { 'a': 1 };
     *
     * _.eq(object, object);
     * // => true
     *
     * _.eq(object, other);
     * // => false
     *
     * _.eq('a', 'a');
     * // => true
     *
     * _.eq('a', Object('a'));
     * // => false
     *
     * _.eq(NaN, NaN);
     * // => true
     */

    function eq$3(value, other) {
      return value === other || value !== value && other !== other;
    }

    var eq_1 = eq$3;

    var eq$2 = eq_1;
    /**
     * Gets the index at which the `key` is found in `array` of key-value pairs.
     *
     * @private
     * @param {Array} array The array to inspect.
     * @param {*} key The key to search for.
     * @returns {number} Returns the index of the matched value, else `-1`.
     */

    function assocIndexOf$4(array, key) {
      var length = array.length;

      while (length--) {
        if (eq$2(array[length][0], key)) {
          return length;
        }
      }

      return -1;
    }

    var _assocIndexOf = assocIndexOf$4;

    var assocIndexOf$3 = _assocIndexOf;
    /** Used for built-in method references. */

    var arrayProto = Array.prototype;
    /** Built-in value references. */

    var splice = arrayProto.splice;
    /**
     * Removes `key` and its value from the list cache.
     *
     * @private
     * @name delete
     * @memberOf ListCache
     * @param {string} key The key of the value to remove.
     * @returns {boolean} Returns `true` if the entry was removed, else `false`.
     */

    function listCacheDelete$1(key) {
      var data = this.__data__,
          index = assocIndexOf$3(data, key);

      if (index < 0) {
        return false;
      }

      var lastIndex = data.length - 1;

      if (index == lastIndex) {
        data.pop();
      } else {
        splice.call(data, index, 1);
      }

      --this.size;
      return true;
    }

    var _listCacheDelete = listCacheDelete$1;

    var assocIndexOf$2 = _assocIndexOf;
    /**
     * Gets the list cache value for `key`.
     *
     * @private
     * @name get
     * @memberOf ListCache
     * @param {string} key The key of the value to get.
     * @returns {*} Returns the entry value.
     */

    function listCacheGet$1(key) {
      var data = this.__data__,
          index = assocIndexOf$2(data, key);
      return index < 0 ? undefined : data[index][1];
    }

    var _listCacheGet = listCacheGet$1;

    var assocIndexOf$1 = _assocIndexOf;
    /**
     * Checks if a list cache value for `key` exists.
     *
     * @private
     * @name has
     * @memberOf ListCache
     * @param {string} key The key of the entry to check.
     * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
     */

    function listCacheHas$1(key) {
      return assocIndexOf$1(this.__data__, key) > -1;
    }

    var _listCacheHas = listCacheHas$1;

    var assocIndexOf = _assocIndexOf;
    /**
     * Sets the list cache `key` to `value`.
     *
     * @private
     * @name set
     * @memberOf ListCache
     * @param {string} key The key of the value to set.
     * @param {*} value The value to set.
     * @returns {Object} Returns the list cache instance.
     */

    function listCacheSet$1(key, value) {
      var data = this.__data__,
          index = assocIndexOf(data, key);

      if (index < 0) {
        ++this.size;
        data.push([key, value]);
      } else {
        data[index][1] = value;
      }

      return this;
    }

    var _listCacheSet = listCacheSet$1;

    var listCacheClear = _listCacheClear,
        listCacheDelete = _listCacheDelete,
        listCacheGet = _listCacheGet,
        listCacheHas = _listCacheHas,
        listCacheSet = _listCacheSet;
    /**
     * Creates an list cache object.
     *
     * @private
     * @constructor
     * @param {Array} [entries] The key-value pairs to cache.
     */

    function ListCache$4(entries) {
      var index = -1,
          length = entries == null ? 0 : entries.length;
      this.clear();

      while (++index < length) {
        var entry = entries[index];
        this.set(entry[0], entry[1]);
      }
    } // Add methods to `ListCache`.


    ListCache$4.prototype.clear = listCacheClear;
    ListCache$4.prototype['delete'] = listCacheDelete;
    ListCache$4.prototype.get = listCacheGet;
    ListCache$4.prototype.has = listCacheHas;
    ListCache$4.prototype.set = listCacheSet;
    var _ListCache = ListCache$4;

    var getNative$5 = _getNative,
        root$5 = _root;
    /* Built-in method references that are verified to be native. */

    var Map$4 = getNative$5(root$5, 'Map');
    var _Map = Map$4;

    var Hash = _Hash,
        ListCache$3 = _ListCache,
        Map$3 = _Map;
    /**
     * Removes all key-value entries from the map.
     *
     * @private
     * @name clear
     * @memberOf MapCache
     */

    function mapCacheClear$1() {
      this.size = 0;
      this.__data__ = {
        'hash': new Hash(),
        'map': new (Map$3 || ListCache$3)(),
        'string': new Hash()
      };
    }

    var _mapCacheClear = mapCacheClear$1;

    /**
     * Checks if `value` is suitable for use as unique object key.
     *
     * @private
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is suitable, else `false`.
     */

    function isKeyable$1(value) {
      var type = typeof value;
      return type == 'string' || type == 'number' || type == 'symbol' || type == 'boolean' ? value !== '__proto__' : value === null;
    }

    var _isKeyable = isKeyable$1;

    var isKeyable = _isKeyable;
    /**
     * Gets the data for `map`.
     *
     * @private
     * @param {Object} map The map to query.
     * @param {string} key The reference key.
     * @returns {*} Returns the map data.
     */

    function getMapData$4(map, key) {
      var data = map.__data__;
      return isKeyable(key) ? data[typeof key == 'string' ? 'string' : 'hash'] : data.map;
    }

    var _getMapData = getMapData$4;

    var getMapData$3 = _getMapData;
    /**
     * Removes `key` and its value from the map.
     *
     * @private
     * @name delete
     * @memberOf MapCache
     * @param {string} key The key of the value to remove.
     * @returns {boolean} Returns `true` if the entry was removed, else `false`.
     */

    function mapCacheDelete$1(key) {
      var result = getMapData$3(this, key)['delete'](key);
      this.size -= result ? 1 : 0;
      return result;
    }

    var _mapCacheDelete = mapCacheDelete$1;

    var getMapData$2 = _getMapData;
    /**
     * Gets the map value for `key`.
     *
     * @private
     * @name get
     * @memberOf MapCache
     * @param {string} key The key of the value to get.
     * @returns {*} Returns the entry value.
     */

    function mapCacheGet$1(key) {
      return getMapData$2(this, key).get(key);
    }

    var _mapCacheGet = mapCacheGet$1;

    var getMapData$1 = _getMapData;
    /**
     * Checks if a map value for `key` exists.
     *
     * @private
     * @name has
     * @memberOf MapCache
     * @param {string} key The key of the entry to check.
     * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
     */

    function mapCacheHas$1(key) {
      return getMapData$1(this, key).has(key);
    }

    var _mapCacheHas = mapCacheHas$1;

    var getMapData = _getMapData;
    /**
     * Sets the map `key` to `value`.
     *
     * @private
     * @name set
     * @memberOf MapCache
     * @param {string} key The key of the value to set.
     * @param {*} value The value to set.
     * @returns {Object} Returns the map cache instance.
     */

    function mapCacheSet$1(key, value) {
      var data = getMapData(this, key),
          size = data.size;
      data.set(key, value);
      this.size += data.size == size ? 0 : 1;
      return this;
    }

    var _mapCacheSet = mapCacheSet$1;

    var mapCacheClear = _mapCacheClear,
        mapCacheDelete = _mapCacheDelete,
        mapCacheGet = _mapCacheGet,
        mapCacheHas = _mapCacheHas,
        mapCacheSet = _mapCacheSet;
    /**
     * Creates a map cache object to store key-value pairs.
     *
     * @private
     * @constructor
     * @param {Array} [entries] The key-value pairs to cache.
     */

    function MapCache$3(entries) {
      var index = -1,
          length = entries == null ? 0 : entries.length;
      this.clear();

      while (++index < length) {
        var entry = entries[index];
        this.set(entry[0], entry[1]);
      }
    } // Add methods to `MapCache`.


    MapCache$3.prototype.clear = mapCacheClear;
    MapCache$3.prototype['delete'] = mapCacheDelete;
    MapCache$3.prototype.get = mapCacheGet;
    MapCache$3.prototype.has = mapCacheHas;
    MapCache$3.prototype.set = mapCacheSet;
    var _MapCache = MapCache$3;

    var MapCache$2 = _MapCache;
    /** Error message constants. */

    var FUNC_ERROR_TEXT = 'Expected a function';
    /**
     * Creates a function that memoizes the result of `func`. If `resolver` is
     * provided, it determines the cache key for storing the result based on the
     * arguments provided to the memoized function. By default, the first argument
     * provided to the memoized function is used as the map cache key. The `func`
     * is invoked with the `this` binding of the memoized function.
     *
     * **Note:** The cache is exposed as the `cache` property on the memoized
     * function. Its creation may be customized by replacing the `_.memoize.Cache`
     * constructor with one whose instances implement the
     * [`Map`](http://ecma-international.org/ecma-262/7.0/#sec-properties-of-the-map-prototype-object)
     * method interface of `clear`, `delete`, `get`, `has`, and `set`.
     *
     * @static
     * @memberOf _
     * @since 0.1.0
     * @category Function
     * @param {Function} func The function to have its output memoized.
     * @param {Function} [resolver] The function to resolve the cache key.
     * @returns {Function} Returns the new memoized function.
     * @example
     *
     * var object = { 'a': 1, 'b': 2 };
     * var other = { 'c': 3, 'd': 4 };
     *
     * var values = _.memoize(_.values);
     * values(object);
     * // => [1, 2]
     *
     * values(other);
     * // => [3, 4]
     *
     * object.a = 2;
     * values(object);
     * // => [1, 2]
     *
     * // Modify the result cache.
     * values.cache.set(object, ['a', 'b']);
     * values(object);
     * // => ['a', 'b']
     *
     * // Replace `_.memoize.Cache`.
     * _.memoize.Cache = WeakMap;
     */

    function memoize$1(func, resolver) {
      if (typeof func != 'function' || resolver != null && typeof resolver != 'function') {
        throw new TypeError(FUNC_ERROR_TEXT);
      }

      var memoized = function () {
        var args = arguments,
            key = resolver ? resolver.apply(this, args) : args[0],
            cache = memoized.cache;

        if (cache.has(key)) {
          return cache.get(key);
        }

        var result = func.apply(this, args);
        memoized.cache = cache.set(key, result) || cache;
        return result;
      };

      memoized.cache = new (memoize$1.Cache || MapCache$2)();
      return memoized;
    } // Expose `MapCache`.


    memoize$1.Cache = MapCache$2;
    var memoize_1 = memoize$1;

    var memoize = memoize_1;
    /** Used as the maximum memoize cache size. */

    var MAX_MEMOIZE_SIZE = 500;
    /**
     * A specialized version of `_.memoize` which clears the memoized function's
     * cache when it exceeds `MAX_MEMOIZE_SIZE`.
     *
     * @private
     * @param {Function} func The function to have its output memoized.
     * @returns {Function} Returns the new memoized function.
     */

    function memoizeCapped$1(func) {
      var result = memoize(func, function (key) {
        if (cache.size === MAX_MEMOIZE_SIZE) {
          cache.clear();
        }

        return key;
      });
      var cache = result.cache;
      return result;
    }

    var _memoizeCapped = memoizeCapped$1;

    var memoizeCapped = _memoizeCapped;
    /** Used to match property names within property paths. */

    var rePropName = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g;
    /** Used to match backslashes in property paths. */

    var reEscapeChar = /\\(\\)?/g;
    /**
     * Converts `string` to a property path array.
     *
     * @private
     * @param {string} string The string to convert.
     * @returns {Array} Returns the property path array.
     */

    var stringToPath$1 = memoizeCapped(function (string) {
      var result = [];

      if (string.charCodeAt(0) === 46
      /* . */
      ) {
        result.push('');
      }

      string.replace(rePropName, function (match, number, quote, subString) {
        result.push(quote ? subString.replace(reEscapeChar, '$1') : number || match);
      });
      return result;
    });
    var _stringToPath = stringToPath$1;

    /**
     * A specialized version of `_.map` for arrays without support for iteratee
     * shorthands.
     *
     * @private
     * @param {Array} [array] The array to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {Array} Returns the new mapped array.
     */

    function arrayMap$1(array, iteratee) {
      var index = -1,
          length = array == null ? 0 : array.length,
          result = Array(length);

      while (++index < length) {
        result[index] = iteratee(array[index], index, array);
      }

      return result;
    }

    var _arrayMap = arrayMap$1;

    var Symbol$3 = _Symbol,
        arrayMap = _arrayMap,
        isArray$7 = isArray_1,
        isSymbol$2 = isSymbol_1;
    /** Used as references for various `Number` constants. */

    var INFINITY$1 = 1 / 0;
    /** Used to convert symbols to primitives and strings. */

    var symbolProto$2 = Symbol$3 ? Symbol$3.prototype : undefined,
        symbolToString = symbolProto$2 ? symbolProto$2.toString : undefined;
    /**
     * The base implementation of `_.toString` which doesn't convert nullish
     * values to empty strings.
     *
     * @private
     * @param {*} value The value to process.
     * @returns {string} Returns the string.
     */

    function baseToString$1(value) {
      // Exit early for strings to avoid a performance hit in some environments.
      if (typeof value == 'string') {
        return value;
      }

      if (isArray$7(value)) {
        // Recursively convert values (susceptible to call stack limits).
        return arrayMap(value, baseToString$1) + '';
      }

      if (isSymbol$2(value)) {
        return symbolToString ? symbolToString.call(value) : '';
      }

      var result = value + '';
      return result == '0' && 1 / value == -INFINITY$1 ? '-0' : result;
    }

    var _baseToString = baseToString$1;

    var baseToString = _baseToString;
    /**
     * Converts `value` to a string. An empty string is returned for `null`
     * and `undefined` values. The sign of `-0` is preserved.
     *
     * @static
     * @memberOf _
     * @since 4.0.0
     * @category Lang
     * @param {*} value The value to convert.
     * @returns {string} Returns the converted string.
     * @example
     *
     * _.toString(null);
     * // => ''
     *
     * _.toString(-0);
     * // => '-0'
     *
     * _.toString([1, 2, 3]);
     * // => '1,2,3'
     */

    function toString$1(value) {
      return value == null ? '' : baseToString(value);
    }

    var toString_1 = toString$1;

    var isArray$6 = isArray_1,
        isKey = _isKey,
        stringToPath = _stringToPath,
        toString = toString_1;
    /**
     * Casts `value` to a path array if it's not one.
     *
     * @private
     * @param {*} value The value to inspect.
     * @param {Object} [object] The object to query keys on.
     * @returns {Array} Returns the cast property path array.
     */

    function castPath$1(value, object) {
      if (isArray$6(value)) {
        return value;
      }

      return isKey(value, object) ? [value] : stringToPath(toString(value));
    }

    var _castPath = castPath$1;

    var baseGetTag$2 = _baseGetTag,
        isObjectLike$5 = isObjectLike_1;
    /** `Object#toString` result references. */

    var argsTag$3 = '[object Arguments]';
    /**
     * The base implementation of `_.isArguments`.
     *
     * @private
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is an `arguments` object,
     */

    function baseIsArguments$1(value) {
      return isObjectLike$5(value) && baseGetTag$2(value) == argsTag$3;
    }

    var _baseIsArguments = baseIsArguments$1;

    var baseIsArguments = _baseIsArguments,
        isObjectLike$4 = isObjectLike_1;
    /** Used for built-in method references. */

    var objectProto$9 = Object.prototype;
    /** Used to check objects for own properties. */

    var hasOwnProperty$7 = objectProto$9.hasOwnProperty;
    /** Built-in value references. */

    var propertyIsEnumerable$1 = objectProto$9.propertyIsEnumerable;
    /**
     * Checks if `value` is likely an `arguments` object.
     *
     * @static
     * @memberOf _
     * @since 0.1.0
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is an `arguments` object,
     *  else `false`.
     * @example
     *
     * _.isArguments(function() { return arguments; }());
     * // => true
     *
     * _.isArguments([1, 2, 3]);
     * // => false
     */

    var isArguments$2 = baseIsArguments(function () {
      return arguments;
    }()) ? baseIsArguments : function (value) {
      return isObjectLike$4(value) && hasOwnProperty$7.call(value, 'callee') && !propertyIsEnumerable$1.call(value, 'callee');
    };
    var isArguments_1 = isArguments$2;

    /** Used as references for various `Number` constants. */
    var MAX_SAFE_INTEGER$1 = 9007199254740991;
    /** Used to detect unsigned integer values. */

    var reIsUint = /^(?:0|[1-9]\d*)$/;
    /**
     * Checks if `value` is a valid array-like index.
     *
     * @private
     * @param {*} value The value to check.
     * @param {number} [length=MAX_SAFE_INTEGER] The upper bounds of a valid index.
     * @returns {boolean} Returns `true` if `value` is a valid index, else `false`.
     */

    function isIndex$2(value, length) {
      var type = typeof value;
      length = length == null ? MAX_SAFE_INTEGER$1 : length;
      return !!length && (type == 'number' || type != 'symbol' && reIsUint.test(value)) && value > -1 && value % 1 == 0 && value < length;
    }

    var _isIndex = isIndex$2;

    /** Used as references for various `Number` constants. */
    var MAX_SAFE_INTEGER = 9007199254740991;
    /**
     * Checks if `value` is a valid array-like length.
     *
     * **Note:** This method is loosely based on
     * [`ToLength`](http://ecma-international.org/ecma-262/7.0/#sec-tolength).
     *
     * @static
     * @memberOf _
     * @since 4.0.0
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
     * @example
     *
     * _.isLength(3);
     * // => true
     *
     * _.isLength(Number.MIN_VALUE);
     * // => false
     *
     * _.isLength(Infinity);
     * // => false
     *
     * _.isLength('3');
     * // => false
     */

    function isLength$3(value) {
      return typeof value == 'number' && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
    }

    var isLength_1 = isLength$3;

    var isSymbol$1 = isSymbol_1;
    /** Used as references for various `Number` constants. */

    var INFINITY = 1 / 0;
    /**
     * Converts `value` to a string key if it's not a string or symbol.
     *
     * @private
     * @param {*} value The value to inspect.
     * @returns {string|symbol} Returns the key.
     */

    function toKey$1(value) {
      if (typeof value == 'string' || isSymbol$1(value)) {
        return value;
      }

      var result = value + '';
      return result == '0' && 1 / value == -INFINITY ? '-0' : result;
    }

    var _toKey = toKey$1;

    var castPath = _castPath,
        isArguments$1 = isArguments_1,
        isArray$5 = isArray_1,
        isIndex$1 = _isIndex,
        isLength$2 = isLength_1,
        toKey = _toKey;
    /**
     * Checks if `path` exists on `object`.
     *
     * @private
     * @param {Object} object The object to query.
     * @param {Array|string} path The path to check.
     * @param {Function} hasFunc The function to check properties.
     * @returns {boolean} Returns `true` if `path` exists, else `false`.
     */

    function hasPath$1(object, path, hasFunc) {
      path = castPath(path, object);
      var index = -1,
          length = path.length,
          result = false;

      while (++index < length) {
        var key = toKey(path[index]);

        if (!(result = object != null && hasFunc(object, key))) {
          break;
        }

        object = object[key];
      }

      if (result || ++index != length) {
        return result;
      }

      length = object == null ? 0 : object.length;
      return !!length && isLength$2(length) && isIndex$1(key, length) && (isArray$5(object) || isArguments$1(object));
    }

    var _hasPath = hasPath$1;

    var baseHasIn = _baseHasIn,
        hasPath = _hasPath;
    /**
     * Checks if `path` is a direct or inherited property of `object`.
     *
     * @static
     * @memberOf _
     * @since 4.0.0
     * @category Object
     * @param {Object} object The object to query.
     * @param {Array|string} path The path to check.
     * @returns {boolean} Returns `true` if `path` exists, else `false`.
     * @example
     *
     * var object = _.create({ 'a': _.create({ 'b': 2 }) });
     *
     * _.hasIn(object, 'a');
     * // => true
     *
     * _.hasIn(object, 'a.b');
     * // => true
     *
     * _.hasIn(object, ['a', 'b']);
     * // => true
     *
     * _.hasIn(object, 'b');
     * // => false
     */

    function hasIn(object, path) {
      return object != null && hasPath(object, path, baseHasIn);
    }

    var hasIn_1 = hasIn;

    const isUndefined = (value) => typeof value === "undefined";
    const isInstance = (value) => value != null;
    const isFunction$1 = (value) => typeof value === "function";
    const isObject$5 = (value) => value && typeof value === "object";
    const isArray$4 = Array.isArray;
    /**
     * Tests if something is an iterable collection.
     *
     * Even though strings are in-fact iterable, this function will return
     * `false` for them, as too often I would do something terrible with them.
     */
    const isIterable = (value) => isObject$5(value) && isFunction$1(value[Symbol.iterator]);
    const isString = (value) => typeof value === "string";
    const isNumber = (value) => typeof value === "number";
    const isBoolean = (value) => typeof value === "boolean";
    const isPojo = dew(() => {
        const POJO_PROTOS = Object.freeze([Object.prototype, null]);
        return (value) => {
            if (!isObject$5(value))
                return false;
            return POJO_PROTOS.includes(Object.getPrototypeOf(value));
        };
    });
    const isThenable = (value) => {
        if (value instanceof Promise)
            return true;
        return isObject$5(value) && isFunction$1(value.then);
    };

    /**
     * Validates a basic assertion.  If it fails, an error with `msg` is thrown.
     */
    const assert = (msg, check) => {
        if (check)
            return;
        throw new Error(msg);
    };
    /**
     * Validates that `value` passes the given type predicate.  If it fails, an error
     * with `msg` is thrown.
     */
    const assertAs = (msg, checkFn, value) => {
        assert(msg, checkFn(value));
        return value;
    };
    /**
     * Validates that `value` is not `null` or `undefined`.
     */
    const assertExists = (msg, value) => assertAs(msg, isInstance, value);
    const isLengthy = (value) => isString(value) || hasIn_1(value, "length");
    const isSized = (value) => hasIn_1(value, "size");
    const hasMin = (value) => hasIn_1(value, "min");
    const hasMax = (value) => hasIn_1(value, "max");
    const getMin = (value) => {
        if (hasMin(value))
            return value.min;
        return 0;
    };
    const getMax = (value) => {
        if (isNumber(value))
            return value;
        if (isLengthy(value))
            return value.length;
        if (isSized(value))
            return value.size;
        if (hasMax(value))
            return value.max;
        throw new Error("Unsupported value type.");
    };
    function assertInBounds(msg, value, ref, inclusive = false) {
        const min = getMin(ref);
        const max = getMax(ref);
        assert(msg, value >= min && (inclusive ? value <= max : value < max));
    }

    /**
     * Creates a {@link Future}, which is basically a promise that has been
     * turned inside out.  You will need to specify the `T` yourself.
     */
    const future = () => {
        let didFulfill = false;
        let _resolve;
        let _reject;
        const promise = new Promise((ok, fail) => {
            _resolve = ok;
            _reject = fail;
        });
        return {
            resolve: (value) => {
                assert("Already fulfilled.", !didFulfill);
                didFulfill = true;
                _resolve(value);
            },
            reject: (err) => {
                assert("Already fulfilled.", !didFulfill);
                didFulfill = true;
                _reject(err);
            },
            get isFulfilled() { return didFulfill; },
            get promise() { return promise; }
        };
    };
    /** Defers execution of an async function until `execute` is called. */
    const defer = (taskFn) => {
        let started = false;
        const _future = future();
        return {
            execute: () => {
                assert("Execution has already begun.", !started);
                started = true;
                taskFn().then(_future.resolve, _future.reject);
                // Return the future's promise instead.
                return _future.promise;
            },
            get isStarted() { return started; },
            get isFulfilled() { return _future.isFulfilled; },
            get promise() { return _future.promise; }
        };
    };
    /** The identity function. */
    const ident = (value) => value;

    const isDefined = (value) => value !== undefined;
    /** Operator that emits an `undefined` value when `source` completes. */
    const whenCompleted = () => (
    /** The source observable. */
    source) => source.pipe(ignoreElements(), defaultIfEmpty(undefined));
    /** Operator that delays the source until `toComplete` completes. */
    const followUpAfter = (toComplete) => pipe(delayWhen(() => toComplete.pipe(whenCompleted())));
    /**
     * Operator that applies a partial function to every element of the
     * observable then filters out any results that were `undefined`.
     */
    const collect = (
    /** The collection function. */
    collectFn) => pipe(map(collectFn), filter(isDefined));
    function firstOrEmpty(predicate) {
        if (!isFunction$1(predicate))
            return pipe(take(1));
        return pipe(filter(predicate), take(1));
    }
    function lastOrEmpty(predicate) {
        if (!isFunction$1(predicate))
            return pipe(takeLast(1));
        return pipe(filter(predicate), takeLast(1));
    }
    /**
     * Operator that manages a concurrent task runner that prefers executing
     * the most recent tasks provided first.  Items streaming in from the
     * source observable represent tasks that the `executor` function can
     * convert into promises.  The promise representing the executing task
     * is piped to downstream observers.
     *
     * Situation: You have a main thread and one or more worker threads.
     * The worker threads execute tasks in first-in-first-out order.
     *
     * Problem: You want to keep all threads running as much as possible
     * and you want to prevent the main thread from having to wait for the
     * worker threads to clear out a bunch of low-priority jobs from their
     * queues before finally getting to the task blocking the main thread.
     *
     * This provides a solution.  It tries to keep the workers busy with
     * at most `concurrent` jobs and when a worker clears out a job, it
     * will favor kicking off the most recently queued job first, assuming
     * that the main thread will only `await` once it can proceed no further.
     *
     * The last job queued is most likely the one blocking the main thread,
     * so the main thread should be blocked for a minimum period of time
     * while the worker thread can still be saturated with tasks.
     *
     * However, the main thread may still be blocked waiting for currently
     * running tasks to finish before the blocking task is started, but
     * there's only so much you can do...
     */
    const taskRunner = (
    /** The function that kicks off the task. */
    executor, 
    /**
     * The number of concurrent tasks to run.  If more tasks than this
     * are provided, the excess tasks will be buffered and executed in
     * last-in-first-out order as running tasks finish.
     */
    concurrent = 2) => (observed) => {
        // I mean, this could be allowed to be 0 or 1, but the way I'm using
        // it would mean I'm doing something wrong.
        assert("Expected a concurrency of at least 2.", concurrent >= 2);
        return observed.pipe(connect((shared) => {
            const stack = new StackSubject(true);
            shared.subscribe(stack);
            let running = 0;
            return stack.pipe(
            // When something comes down the pipe, increment our running stat
            // and request the next task if we still have room.
            tap(() => {
                running += 1;
                if (running < concurrent)
                    stack.pop();
            }), 
            // Kick off each task.  Afterwards, prime the `StackSubject` for
            // the next value.
            map((task) => executor(task).finally(() => {
                running -= 1;
                // This shouldn't happen, but we'll check our sanity.
                assert("More tasks than expected are running.", running < concurrent);
                stack.pop();
            })));
        }));
    };
    const defaultKeyObject = { source: ident, output: ident };
    function rejectedBy(output, keyBy = defaultKeyObject) {
        const { source: sKeyFn, output: oKeyFn } = dew(() => {
            if (!isFunction$1(keyBy))
                return keyBy;
            // @ts-ignore - Overloads will error if this does not hold.
            return { source: keyBy, output: keyBy };
        });
        return (input) => {
            const keysOfOutput = output.pipe(reduce((a, v) => a.add(oKeyFn(v)), new Set()));
            const mapOfSource = input.pipe(reduce((a, v) => a.set(sKeyFn(v), v), new Map()));
            return forkJoin([mapOfSource, keysOfOutput]).pipe(mergeMap(([sources, outputs]) => {
                for (const key of outputs)
                    sources.delete(key);
                return sources.values();
            }));
        };
    }

    var _Logger_origin, _Logger_stream;
    const omegaLogger = new Subject();
    omegaLogger.forEach(({ origin, type, data }) => {
        switch (type) {
            case "info": return console.info(`[${origin}]`, ...data);
            case "warn": return console.warn(`[${origin}]`, ...data);
            case "error": return console.error(`[${origin}]`, ...data);
            case "dir": {
                if (data.length === 0)
                    return;
                console.log(`[${origin}]:`);
                return console.dir(...data);
            }
        }
    });
    class Logger {
        constructor(origin) {
            _Logger_origin.set(this, void 0);
            _Logger_stream.set(this, void 0);
            this.info = (...data) => __classPrivateFieldGet(this, _Logger_stream, "f").next({ origin: __classPrivateFieldGet(this, _Logger_origin, "f"), type: "info", data });
            this.warn = (...data) => __classPrivateFieldGet(this, _Logger_stream, "f").next({ origin: __classPrivateFieldGet(this, _Logger_origin, "f"), type: "info", data });
            this.error = (...data) => __classPrivateFieldGet(this, _Logger_stream, "f").next({ origin: __classPrivateFieldGet(this, _Logger_origin, "f"), type: "info", data });
            this.dir = (...data) => __classPrivateFieldGet(this, _Logger_stream, "f").next({ origin: __classPrivateFieldGet(this, _Logger_origin, "f"), type: "info", data });
            this.mark = (name) => performance.mark(`[${__classPrivateFieldGet(this, _Logger_origin, "f")}] ${name}`);
            __classPrivateFieldSet(this, _Logger_origin, origin, "f");
            __classPrivateFieldSet(this, _Logger_stream, new Subject(), "f");
            __classPrivateFieldGet(this, _Logger_stream, "f").subscribe(omegaLogger);
        }
        stopWatch(name) {
            const NAME = `[${__classPrivateFieldGet(this, _Logger_origin, "f")}] ${name}`;
            const START = `[${__classPrivateFieldGet(this, _Logger_origin, "f")}] START ${name}`;
            const STOP = `[${__classPrivateFieldGet(this, _Logger_origin, "f")}] STOP ${name}`;
            let started = false;
            const start = () => {
                if (!started) {
                    started = true;
                    performance.mark(START);
                    return;
                }
                this.warn(`Measurement \`${name}\` already started.`);
            };
            const stopAndReport = () => {
                if (started) {
                    started = false;
                    performance.mark(STOP);
                    return performance.measure(NAME, START, STOP);
                }
                this.warn(`Measurement \`${name}\` not yet started.`);
            };
            const stop = (logMeasurement = true) => {
                const measurement = stopAndReport();
                if (measurement && logMeasurement)
                    this.info(measurement);
            };
            return { start, stop, stopAndReport };
        }
        measureFn(fn, givenName) {
            const self = this;
            const name = givenName || fn.name || "<anonymous>";
            const wrappedName = `measured ${name}`;
            const aggregator = new Subject();
            aggregator.pipe(bufferTime(1000), filter((measurements) => measurements.length > 0), map((measurements) => measurements.reduce((acc, m) => {
                const initCount = acc.count;
                const dur = m.duration;
                acc.count = initCount + 1;
                acc.total = acc.total + dur;
                acc.min = initCount > 0 ? Math.min(acc.min, dur) : dur;
                acc.avg = acc.total / acc.count;
                acc.max = Math.max(acc.max, dur);
                return acc;
            }, {
                name: wrappedName,
                count: 0,
                total: 0,
                min: 0,
                avg: 0,
                max: 0
            }))).subscribe((m) => this.info(m));
            // An old trick to give a dynamic name to a function.
            const wrapping = {
                [wrappedName]() {
                    const stopWatch = self.stopWatch(name);
                    const doStop = () => {
                        const measurement = stopWatch.stopAndReport();
                        if (!measurement)
                            return;
                        aggregator.next(measurement);
                    };
                    stopWatch.start();
                    const retVal = fn.apply(this, arguments);
                    // For async functions, we want to wait for it to resolve.
                    if (isThenable(retVal)) {
                        return Promise.resolve(retVal).finally(doStop);
                    }
                    else {
                        doStop();
                        return retVal;
                    }
                }
            };
            return wrapping[wrappedName];
        }
        async measureAsync(name, task) {
            const stopWatch = this.stopWatch(name);
            stopWatch.start();
            const result = await task();
            stopWatch.stop();
            return result;
        }
        measureStream(name) {
            const forCold = this.stopWatch(`${name} (Cold)`);
            const forHot = this.stopWatch(`${name} (Hot)`);
            const operatorFn = (source) => {
                const observable = from(source);
                let state = "cold";
                const onFinished = () => {
                    switch (state) {
                        case "cold":
                            forCold.stop();
                            break;
                        case "hot":
                            forHot.stop();
                            break;
                    }
                    state = "done";
                };
                forCold.start();
                return observable.pipe(connect((shared) => {
                    if (state === "cold") {
                        forCold.stop();
                        state = "hot";
                        forHot.start();
                    }
                    shared.subscribe({
                        complete: onFinished,
                        error: (err) => {
                            onFinished();
                            this.error(err);
                        }
                    });
                    return shared;
                }));
            };
            return Object.assign(operatorFn, {
                markItems: (labeler) => (source) => {
                    let index = 0;
                    return operatorFn(source).pipe(tap((item) => {
                        const label = labeler?.(item, index) ?? String(index);
                        this.mark(`${name} - ${label}`);
                        index += 1;
                    }));
                }
            });
        }
    }
    _Logger_origin = new WeakMap(), _Logger_stream = new WeakMap();
    const createLogger = (origin) => {
        return new Logger(origin);
    };

    /**
     * A utility to produce modules that rely on {@link WrappedRequireFn}.
     *
     * You are required to return the `exports` object, so use {@link Object.assign}
     * to assign your exported values to it.
     */
    function usModule(moduleFactory) {
        const exports = {};
        let begunInit = false;
        const moduleBuilder = (wrappedRequire) => {
            // In order to avoid cyclical calls, we'll only call the factory once.
            // It is required to return the same `exports` object that is given, meaning
            // this object will eventually be populated.  This has all the same problems
            // that Node modules have, being unable to statically initialize a module.
            if (begunInit)
                return exports;
            begunInit = true;
            {
                const result = moduleFactory(wrappedRequire, exports);
                if (result === exports)
                    return Object.freeze(result);
            }
            throw new Error("A user-script module must return the given `exports` object.");
        };
        return moduleBuilder;
    }

    class TokenizerHelpers extends ModuleDef {
        constructor() {
            super(...arguments);
            this.moduleId = 89003;
            this.expectedExports = 3;
            this.mapping = {
                "ID": ["getTokenizerType", "function"]
            };
        }
    }
    var TokenizerHelpers$1 = new TokenizerHelpers();

    /**
     * Converts the given iterable into a readonly array, if needed.
     */
    const toImmutable = (iterable) => {
        if (!isArray$4(iterable))
            return Object.freeze([...iterable]);
        if (Object.isFrozen(iterable))
            return iterable;
        return Object.freeze(iterable.slice());
    };
    const hasSize = (value) => {
        if (!isObject$5(value))
            return false;
        if (value instanceof Map)
            return true;
        if (value instanceof Set)
            return true;
        // @ts-ignore - `_hasIn` does not actually narrow the type.
        if (hasIn_1(value, "size"))
            return isNumber(value.size);
        return false;
    };
    /**
     * Determines if the given iterable is empty.
     *
     * WARNING: this can invoke the iterator of the iterable; avoid
     * using with {@link IterableIterator} or any kind of lazy iterator.
     */
    const isEmpty$1 = (iterable) => {
        if (isArray$4(iterable))
            return !iterable.length;
        if (isString(iterable))
            return !iterable.length;
        if (hasSize(iterable))
            return !iterable.size;
        return !iterable[Symbol.iterator]().next().done;
    };
    /**
     * Gets the first element of an iterable or `undefined` if it has none.
     */
    const first = ([v]) => v;
    /**
     * Gets the last element of an iterable or `undefined` if it has none.
     */
    const last = (iter) => {
        if (isArray$4(iter)) {
            if (iter.length === 0)
                return undefined;
            return iter[iter.length - 1];
        }
        let result = undefined;
        for (const v of iter)
            result = v;
        return result;
    };
    /**
     * Counts the number of elements that pass a predicate.
     */
    const countBy = (iter, predicateFn) => {
        let count = 0;
        for (const item of iter)
            if (predicateFn(item))
                count += 1;
        return count;
    };
    /**
     * Creates an object from key-value-pairs.
     */
    const fromPairs = (kvps) => {
        const result = {};
        for (const [k, v] of kvps)
            result[k] = v;
        return result;
    };
    function* toPairs(obj) {
        if (obj == null)
            return;
        for (const key of Object.keys(obj))
            yield [key, obj[key]];
        for (const sym of Object.getOwnPropertySymbols(obj))
            yield [sym, obj[sym]];
    }
    /**
     * Transforms an iterable with the given function, yielding each result.
     */
    const flatMap = function* (iterable, transformFn) {
        for (const value of iterable)
            yield* transformFn(value);
    };
    /**
     * Flattens the given iterable.  If the iterable contains strings, which
     * are themselves iterable, they will be yielded as-is, without flattening them.
     */
    const flatten = function* (iterable) {
        // This is almost certainly an error.
        assert("Flattening strings is not allowed.", !isString(iterable));
        for (const value of iterable) {
            // @ts-ignore - We don't flatten strings.
            if (isString(value))
                yield value;
            // @ts-ignore - We pass out non-iterables, as they are.
            else if (!isIterable(value))
                yield value;
            // And now, do a flatten.
            else
                yield* value;
        }
    };
    /**
     * Yields iterables with a number representing their position.  For arrays,
     * this is very similar to a for loop, but you don't increment the index
     * yourself.
     */
    const iterPosition = function* (iter) {
        if (isArray$4(iter)) {
            yield* iter.entries();
        }
        else {
            let i = 0;
            for (const item of iter)
                yield [i++, item];
        }
    };
    /**
     * Yields elements of an iterable in reverse order.  You can limit the
     * number of results yielded by providing `count`.
     */
    const iterReverse = function* (iter, count) {
        if (isArray$4(iter)) {
            // Ensure `count` is between 0 and the number of items in the array.
            count = Math.max(0, Math.min(iter.length, count ?? iter.length));
            const lim = iter.length - count;
            for (let i = iter.length - 1; i >= lim; i--)
                yield iter[i];
        }
        else {
            // We gotta materialize the values so we can reverse them.
            yield* iterReverse([...iter], count);
        }
    };
    /**
     * Yields items from the beginning of the iterable until the given predicate
     * function returns `true`.
     */
    const takeUntil = function* (iter, predicateFn) {
        for (const item of iter) {
            if (predicateFn(item))
                return;
            yield item;
        }
    };
    /** Yields items after skipping the first `count` items. */
    const skip = function* (iter, count) {
        if (count <= 0)
            return iter;
        if (isArray$4(iter)) {
            // Ensure `count` is between 0 and the number of items in the array.
            count = Math.max(0, Math.min(iter.length, count ?? iter.length));
            for (let i = count; i < iter.length; i++)
                yield iter[i];
        }
        else {
            let skipped = 0;
            for (const item of iter) {
                if (skipped >= count)
                    yield item;
                else
                    skipped += 1;
            }
        }
    };
    /** Yields items starting from the first to pass `predicateFn`. */
    const skipUntil = function* (iter, predicateFn) {
        let skipDone = false;
        for (const item of iter) {
            checks: {
                if (skipDone)
                    break checks;
                if (!predicateFn(item))
                    continue;
                skipDone = true;
            }
            yield item;
        }
    };
    /** Yields all items except the last `count` items. */
    const skipRight = function* (iter, count) {
        if (count <= 0)
            return iter;
        if (isArray$4(iter)) {
            // Ensure `count` is between 0 and the number of items in the array.
            count = Math.max(0, Math.min(iter.length, count ?? iter.length));
            for (let i = 0; i < iter.length - count; i++)
                yield iter[i];
        }
        else {
            const buffer = [];
            for (const item of iter) {
                buffer.push(item);
                if (buffer.length > count)
                    yield buffer.shift();
            }
        }
    };
    /**
     * Creates an iterable that transforms values.
     */
    const mapIter = function* (iterable, transformFn) {
        for (const value of iterable)
            yield transformFn(value);
    };
    /**
     * Transforms the values of an iterable of {@link KVP}.
     */
    const mapValuesOf = (iterable, transformFn) => {
        return mapIter(iterable, ([k, v]) => [k, transformFn(v)]);
    };
    /**
     * Creates an iterable that transforms values, and yields the result if it is
     * not `undefined`.
     */
    const collectIter = function* (iterable, collectFn) {
        for (const value of iterable) {
            const result = collectFn(value);
            if (typeof result !== "undefined")
                yield result;
        }
    };
    /**
     * Filters the given iterable to those values that pass a predicate.
     */
    const filterIter = function* (iterable, predicateFn) {
        for (const value of iterable)
            if (predicateFn(value))
                yield value;
    };
    const reduceIter = function (iterable, initialValue, reducer) {
        // Fast-path for array instances.  We do need to adapt the `reducer`,
        // since `Array#reduce` passes additional arguments to it that can
        // break things like `Math.min`.
        if (isArray$4(iterable))
            return iterable.reduce((p, v) => reducer(p, v), initialValue);
        let acc = initialValue;
        for (const value of iterable)
            acc = reducer(acc, value);
        return acc;
    };
    /**
     * Creates an iterable that groups values based on a transformation function.
     */
    const groupBy = function* (iterable, transformFn) {
        const groups = new Map();
        for (const value of iterable) {
            const key = transformFn(value);
            if (key == null)
                continue;
            const theGroup = groups.get(key) ?? [];
            theGroup.push(value);
            groups.set(key, theGroup);
        }
        yield* groups;
    };
    const partitionKeys = (kvp) => kvp[0];
    const partitionValues = (kvp) => kvp[1];
    /**
     * Creates an iterable that groups key-value-pairs when they share the same key.
     */
    const partition = function* (iterable) {
        for (const [key, values] of groupBy(iterable, partitionKeys))
            yield [key, values.map(partitionValues)];
    };
    /**
     * Concatenates multiple iterables together.
     *
     * Similar to {@link flatten}, providing `string` as `T` is treated as an
     * error.  Use `as Iterable<string>` if you want to overrule it.
     */
    const concat = function* (...others) {
        for (const value of others) {
            assertAs("Expected an iterable.", isIterable, value);
            yield* value;
        }
    };
    /**
     * Inserts the given `values` before the elements of `iterable`.
     */
    const prepend = function* (iterable, values) {
        yield* values;
        yield* iterable;
    };
    /**
     * Inserts the given `values` after the elements of `iterable`.
     */
    const append = function* (iterable, values) {
        yield* iterable;
        yield* values;
    };
    /**
     * Yields values from an `iterable` that pass the predicate `waypointFn`
     * as well as all values in-between these waypoints.
     *
     * This just trims the beginning and end of the iterable of values that
     * are not considered "useful", according to the predicate.
     */
    const journey = function* (iter, waypointFn) {
        let journeyBegun = false;
        const buffer = [];
        // Any items still in the buffer after iteration completes will be
        // intentionally discarded, as they are not between two waypoints.
        for (const item of iter) {
            if (!waypointFn(item)) {
                if (!journeyBegun)
                    continue;
                buffer.push(item);
            }
            else {
                journeyBegun = true;
                if (buffer.length) {
                    yield* buffer;
                    buffer.length = 0;
                }
                yield item;
            }
        }
    };
    /**
     * Buffers items until an item passes the given `predicateFn`.
     * - The item that satisfied the predicate is added to the buffer.
     * - The buffer is yielded.
     * - Then a new buffer is created.
     *
     * If `finalize` is set to `false`, the final buffer will not be yielded if
     * the last item failed to pass the predicate.
     */
    const buffer = function* (iter, predicateFn, finalize = true) {
        let buffer = [];
        for (const item of iter) {
            buffer.push(item);
            if (!predicateFn(item))
                continue;
            yield buffer;
            buffer = [];
        }
        if (!finalize || !buffer.length)
            return;
        yield buffer;
    };
    function* batch(iter, compareFn) {
        // By default, check if the current item is the same as the last item
        // in the buffer using `Object.is`.
        compareFn ?? (compareFn = Object.is);
        let buffer = [];
        for (const item of iter) {
            checks: {
                if (buffer.length === 0)
                    break checks;
                const result = compareFn(item, buffer[buffer.length - 1]);
                if (result === 0 || result === true)
                    break checks;
                yield buffer;
                buffer = [];
            }
            buffer.push(item);
        }
        if (buffer.length)
            yield buffer;
    }
    /**
     * Calls the given function on each element of `iterable` and yields the
     * values, unchanged.
     */
    const tapEach = function* (iterable, tapFn) {
        // Clone an array in case the reference may be mutated by the `tapFn`.
        const safedIterable = isArray$4(iterable) ? [...iterable] : iterable;
        for (const value of safedIterable) {
            tapFn(value);
            yield value;
        }
    };
    /**
     * Calls the given function on an array materialized from `iterable` and
     * yields the same values, unchanged.
     */
    const tapAll = function* (iterable, tapFn) {
        // Materialize the iterable; we can't provide an iterable that is
        // currently being iterated.
        const materialized = [...iterable];
        tapFn(materialized);
        yield* materialized;
    };
    function chain(iterable) {
        iterable = iterable ?? [];
        return {
            reduce: (init, reducer) => reduceIter(iterable, init, reducer),
            map: (transformFn) => chain(mapIter(iterable, transformFn)),
            flatMap: (transformFn) => chain(flatMap(iterable, transformFn)),
            flatten: () => chain(flatten(iterable)),
            filter: (predicateFn) => chain(filterIter(iterable, predicateFn)),
            collect: (collectFn) => chain(collectIter(iterable, collectFn)),
            prepend: (values) => chain(prepend(iterable, values)),
            prependVal: (...values) => chain(prepend(iterable, values)),
            append: (values) => chain(append(iterable, values)),
            appendVal: (...values) => chain(append(iterable, values)),
            thru: (transformFn) => chain(transformFn(iterable)),
            pipe: (fn, ...args) => chain(fn(iterable, ...args)),
            tap: (tapFn) => chain(tapEach(iterable, tapFn)),
            tapAll: (tapFn) => chain(tapAll(iterable, tapFn)),
            value: (xformFn) => xformFn ? xformFn(iterable) : iterable,
            toArray: () => [...iterable],
            exec: () => { for (const _ of iterable)
                ; }
        };
    }

    class TokenizerCodec extends ModuleDef {
        constructor() {
            super(...arguments);
            this.moduleId = 70613;
            this.expectedExports = 3;
            this.mapping = {
                "PT": ["GlobalEncoder", "function"]
            };
        }
    }
    var $TokenizerCodec = new TokenizerCodec();

    class AppConstants extends ModuleDef {
        constructor() {
            super(...arguments);
            this.moduleId = 58050;
            this.expectedExports = 50;
            this.mapping = {
                "uV": ["contextSize", "number"],
                "T8": ["T8", "number"]
            };
        }
    }
    var AppConstants$1 = new AppConstants();

    /**
     * Provides services that handle the splitting of text into fragments.
     * Each fragment retains information on where that fragment came from,
     * at least relative to the original string.
     *
     * These methods are the main splitters:
     * - `byLine` splits on newlines for the `newline` trim-type.
     * - `byLineFromEnd` is optimized for reverse iteration; the story
     *   can get huge and we don't want to have to process thousands of
     *   lines, just to discard all but the last dozen or so.
     * - `bySentence` splits on sentences for the `sentence` trim-type.
     * - `byWord` splits on words for the `token` trim-type.  Yeah, that
     *   definitely isn't splitting on tokens, but NovelAI would need to
     *   give the global tokenizer `encodeKvp` and `decodeKvp` tasks
     *   to do that with relative efficiency.
     *
     * Additionally, the basic tools for inspecting and manipulating the
     * `TextFragment` type live here.
     */
    const { raw } = String;
    /**
     * A raw string with all the punctuation characters we care about.
     *
     * The characters are:
     * - The typical english `.`, `?`, and `!`.
     * - The `~` character, which is seeing more common use.
     * - `\xbf` -> `¿`
     * - `\xa1` -> `¡`
     * - `\u061f` -> `؟`
     * - `\u3002` -> `。`
     * - `\uff1f` -> `？`
     * - `\uff01` -> `！`
     */
    const PUNCT = raw `.?!~\xbf\xa1\u061f\u3002\uff1f\uff01`;
    /** The quote characters we care about. */
    const QUOTE = `'"`;
    /**
     * An exception case in sentence separation: english honorific abbreviations.
     * Seems a bit much, but NovelAI apparently found this necessary.
     */
    const HONORIFIC = raw `(?:dr|mrs?|ms|esq|jr|sn?r)\.`;
    /** Matches something that isn't English syntax. */
    const reWordy = new RegExp(`[^${PUNCT}${QUOTE}\\s-]`);
    /** Matches any string with at least one newline character. */
    const reHasNewLine = /\n/;
    /**
     * Each match will be one of:
     * - A single `\n` character.
     * - A word's contents.
     * - Stuff between words (punctuation and other whitespace).
     */
    const reByWord = dew(() => {
        /** Anything that is not whitespace and within a word-boundary is a word. */
        const singleWord = raw `\b\S+\b`;
        /**
         * Otherwise, if we have at least one character, grab characters until:
         * - We hit a word boundary (start of next word).
         * - End of the string.
         * - The position immediately before a `\n` character.  We don't want to
         *   consume the `\n`, only stop before it.
         */
        const elseUntilNextWordOrEnd = raw `.+?(?:\b|$|(?=\n))`;
        /** A `\n` is the only thing left of the possibilities. */
        const endOfLine = raw `\n`;
        return new RegExp(`${singleWord}|${elseUntilNextWordOrEnd}|${endOfLine}`, "gi");
    });
    /**
     * This regular expression is designed to work against isolated lines.
     *
     * Categorizes each match into one of three capture groups:
     * `[1]` - Whitespace between sentences.
     * `[2]` - Punctuation (may include the odd quote character).
     * `[3]` - The sentence contents.
     *
     * There must be whitespace separating sentences for them to count as
     * separate sentences.  This helps ensure that things like "novelai.com"
     * remain together.
     *
     * This will fail to handle certain syntactical complexities; for
     * instance, a quote within a quote.  It's just not worth dealing with.
     */
    const reBySentence = dew(() => {
        /** A group for whitespace. */
        const wsGroup = raw `\s+`;
        /**
         * A group for things that define a sentence ending, which is defined as:
         * - One or more punctuation characters.
         * - Then zero-or-more closing-quote characters.
         * - Terminated by the end of the string or some whitespace.
         */
        const punctGroup = raw `[${PUNCT}]+[${QUOTE}]*(?=$|\s)`;
        /**
         * A group for the sentence contents, which is terminated either when
         * we hit the end of the string or we find something the punctuation
         * group would match.
         *
         * We have a special exception to allow a period to be a part of the
         * sentence when it comes before an english honorific.
         */
        const contentGroup = raw `(?:${HONORIFIC}|.)+?(?=$|${punctGroup})`;
        return new RegExp(`(${wsGroup})|(${punctGroup})|(${contentGroup})`, "gi");
    });
    /**
     * Each match will be one of:
     * - A single `\n` character.
     * - A line's contents.
     */
    const reByLine = /\n|.+/g;
    var $TextSplitterService = usModule((require, exports) => {
        // NovelAI uses this value times 20 as a safe chunk size to get plenty
        // of lines of story to kick off lorebook key matching.  I don't like
        // assumptions; we'll still use it, but with a safer method.
        const chunkSize = require(AppConstants$1).contextSize;
        assert("Expected chunk size greater than 0.", !!chunkSize && chunkSize > 0);
        /**
         * Builds a {@link TextFragment} given some inputs.
         *
         * A `source` may be given if this fragment was derived from another
         * string or fragment.  If its a {@link TextFragment}, then its
         * {@link TextFragment.offset offset} will be applied to the given
         * `offset` for you.
         */
        const createFragment = (
        /** The content of the fragment. */
        content, 
        /** The offset of the fragment within the source fragment/string. */
        offset, 
        /** The source fragment/string, if `content` came from it. */
        source) => {
            const result = !source || isString(source) ? { content, offset }
                : { content, offset: source.offset + offset };
            return Object.freeze(result);
        };
        /** Standardizes on text fragments for processing. */
        const asFragment = (inputText) => isString(inputText) ? createFragment(inputText, 0) : inputText;
        /** Pulls the content text from a string or fragment. */
        const asContent = (inputText) => isString(inputText) ? inputText : inputText.content;
        /** Creates an empty version of a fragment at the same offset. */
        const asEmptyFragment = (fragment) => !fragment.content ? fragment : createFragment("", 0, fragment);
        /** Retrieves the starting offset of a fragment. */
        const beforeFragment = (f) => f.offset;
        /** Retrieves the ending offset of a fragment. */
        const afterFragment = (f) => f.offset + f.content.length;
        /**
         * Combines many sequential fragments into a single fragment.
         *
         * This function performs no checks to validate the fragments are
         * actually sequential; it will join the fragments in the order given.
         *
         * If they are not sequential, only the offset of the initial fragment
         * is preserved and any information about gaps that existed in `fragments`
         * will be lost.
         */
        const mergeFragments = (fragments) => {
            assert("Expected at least one text fragment.", fragments.length > 0);
            const content = fragments.map(asContent).join("");
            const [{ offset }] = fragments;
            return { content, offset };
        };
        /** Internal function; checks if `curFrag` comes after `prevFrag`. */
        const isSequentialPair = (curFrag, prevFrag) => beforeFragment(curFrag) === afterFragment(prevFrag);
        /**
         * Finds sequential sections of fragments that have been split apart
         * and merges them back into a single fragment.
         */
        const defragment = (fragments) => chain(fragments)
            .thru((iter) => batch(iter, isSequentialPair))
            .map(mergeFragments)
            .value();
        /**
         * Checks if the given offset appears to be inside a given fragment.
         */
        const isOffsetInside = (offset, fragment) => {
            if (offset < beforeFragment(fragment))
                return false;
            if (offset > afterFragment(fragment))
                return false;
            return true;
        };
        /**
         * Checks if the given collection of fragments is contiguous; this means
         * the collection has no gaps and all fragments are not out-of-order.
         *
         * Returns `false` if `fragments` was empty.
         */
        const isContiguous = (fragments) => {
            let lastFrag = undefined;
            for (const curFrag of fragments) {
                if (lastFrag) {
                    const expectedOffset = lastFrag.offset + lastFrag.content.length;
                    if (curFrag.offset !== expectedOffset)
                        return false;
                }
                lastFrag = curFrag;
            }
            // Return `false` if `fragments` was empty.
            return Boolean(lastFrag);
        };
        /**
         * Splits a text fragment at a specific offset.  The offset should be
         * relative to the source text and within the bounds of the fragment.
         */
        const splitFragmentAt = (
        /** The fragment to split. */
        fragment, 
        /** The offset of the cut. */
        cutOffset) => {
            const { offset, content } = fragment;
            assert("Expected cut offset to be in bounds of the fragment.", cutOffset >= offset && cutOffset <= offset + content.length);
            // Fast-path: reuse the instance if cutting at beginning.
            if (cutOffset === offset)
                return [createFragment("", 0, fragment), fragment];
            // Fast-path: reuse instance if cutting at end.
            if (cutOffset === offset + content.length)
                return [fragment, createFragment("", content.length, fragment)];
            // Get the relative position of the offset.
            const position = cutOffset - offset;
            const before = content.slice(0, position);
            const after = content.slice(position);
            return [
                createFragment(before, 0, fragment),
                createFragment(after, before.length, fragment)
            ];
        };
        /**
         * Breaks text up into fragments containing one of:
         * - A single `\n` character.
         * - The full contents of a line.
         *
         * Will yield no elements for an empty string.
         */
        function* byLine(inputText) {
            const inputFrag = asFragment(inputText);
            for (const match of inputFrag.content.matchAll(reByLine)) {
                const [content] = match;
                const offset = assertExists("Expected match index to exist.", match.index);
                assert("Expected match contents to be non-empty.", content.length > 0);
                yield createFragment(content, offset, inputFrag);
            }
        }
        /**
         * Gets a chunk of text towards the end of `inputFrag.content` but
         * before `endIndex`.  This chunk will always contain a `\n` character
         * or will be the final line of iteration.
         */
        function getChunkAtEnd(inputFrag, endIndex = inputFrag.content.length) {
            if (!inputFrag.content.length)
                return createFragment("", 0, inputFrag);
            // The caller should have aborted instead of calling this.
            assert("End index must be non-zero.", endIndex > 0);
            const { content } = inputFrag;
            let startIndex = Math.max(0, endIndex - chunkSize);
            let chunk = content.slice(startIndex, endIndex);
            while (startIndex > 0) {
                if (reHasNewLine.test(chunk))
                    break;
                startIndex = Math.max(0, startIndex - chunkSize);
                chunk = content.slice(startIndex, endIndex);
            }
            return createFragment(chunk, startIndex, inputFrag);
        }
        /**
         * Produces fragments of text as {@link byLine} does, however it yields
         * lines in reverse order and is guaranteed to remain fairly efficient
         * while guaranteeing you get each line.
         *
         * Just to be doubly-clear, **REVERSE ORDER**!  If you want the fragments
         * in normal order, pass the returned iterable through {@link iterReverse}.
         */
        function* byLineFromEnd(inputText) {
            const inputFrag = asFragment(inputText);
            let curChunk = getChunkAtEnd(inputFrag);
            // The idea here is to yield lines from the chunk in reverse until
            // the last, presumably partial, line is encountered.  At this point,
            // we go back to the offset of the last line yielded and grab a new
            // chunk from there.
            while (curChunk.offset > inputFrag.offset) {
                let lastOffset = null;
                // We're going to use `curChunk.content` directly so that when we
                // see `line.offset === 0`, we know we're at the first line of
                // the chunk.  This means we'll need to correct the offset.
                for (const line of iterReverse(byLine(curChunk.content))) {
                    // Don't yield the first line; it may be a partial line.
                    if (line.offset === 0)
                        break;
                    lastOffset = line.offset;
                    yield createFragment(line.content, line.offset, curChunk);
                }
                // Grab the next chunk ending at the last known good line.
                // Remember: `lastOffset` needs to be corrected.
                const nextOffset = curChunk.offset + assertExists("Expected to encounter one line not from the start of the chunk.", lastOffset);
                // We must correct for `inputFrag` not being at offset `0`
                // to properly obtain an index on its content.
                curChunk = getChunkAtEnd(inputFrag, nextOffset - inputFrag.offset);
            }
            // If we've reached the start of the string, just yield the remaining
            // chunk's lines and we're done.  There's no need to adjust the
            // offset in this case.
            yield* iterReverse(byLine(curChunk));
        }
        /**
         * Breaks text up into fragments containing one of:
         * - A single `\n` character.
         * - A block of other whitespace characters.
         * - The contents of a single sentence.
         *
         * It will do its best to yield full sentences, but it may fail to keep
         * a sentence together due to certain English language complexities.
         *
         * For instance, the following text:
         * > Taleir exclaims, "but the dog said, 'it's right over there!'
         * > This doesn't make sense!" She pouts unhappily.
         *
         * Will yield something like:
         * - `Taleir exclaims, "but the dog said, 'it's right over there!'`
         * - ` `
         * - `This doesn't make sense!"`
         * - ` `
         * - `She pouts unhappily.`
         */
        function* bySentence(inputText) {
            const inputFrag = asFragment(inputText);
            // To simplify destructuring, we'll start by breaking the content up by
            // lines.  This way, the `\n` character won't complicate things.
            for (const fragment of byLine(inputFrag)) {
                // If the fragment is a `\n` character, carry on.
                if (fragment.content === "\n") {
                    yield fragment;
                    continue;
                }
                // We're going to need to fuse the body and punctuation parts together.
                // It's gonna be a bit weird...
                let lastBody = null;
                for (const match of fragment.content.matchAll(reBySentence)) {
                    const [, whitespace, punctuation, body] = match;
                    assert("Expected exactly one capture group to be populated.", countBy([whitespace, punctuation, body], Boolean) === 1);
                    const index = assertExists("Expected match index to exist.", match.index);
                    // If we have a body on standby, but we just got something that
                    // is not punctuation to close it off, yield the body now.
                    if (!punctuation && lastBody) {
                        yield lastBody;
                        lastBody = null;
                    }
                    if (punctuation) {
                        if (!lastBody)
                            yield createFragment(punctuation, index, fragment);
                        else {
                            yield createFragment(`${lastBody.content}${punctuation}`, lastBody.offset);
                            lastBody = null;
                        }
                    }
                    else if (whitespace) {
                        yield createFragment(whitespace, index, fragment);
                    }
                    else if (body) {
                        // Hold on to this body until we've seen the next match.
                        lastBody = createFragment(body, index, fragment);
                    }
                }
                // If we're still holding a body, yield it before we loop.
                if (lastBody)
                    yield lastBody;
            }
        }
        /**
         * Breaks text up into fragments containing one of:
         * - A single `\n` character.
         * - A word's contents.
         * - Stuff between words (punctuation and other whitespace).
         */
        function* byWord(inputText) {
            const inputFrag = asFragment(inputText);
            for (const match of inputFrag.content.matchAll(reByWord)) {
                const [content] = match;
                const length = content.length;
                const index = assertExists("Expected match index to exist.", match.index);
                assert("Expected match contents to be non-empty.", length > 0);
                yield createFragment(content, index, inputFrag);
            }
        }
        /**
         * Determines if some text (or a fragment of text) has any contents that
         * looks like a word.
         *
         * This basically looks for any character that is not:
         * - Whitespace.
         * - A single or double quote character.
         * - A common sentence terminator `.?!~`.
         * - A hyphen (since it is used as a word joiner).
         */
        function hasWords(inputText) {
            return reWordy.test(isString(inputText) ? inputText : inputText.content);
        }
        /**
         * Builds an iterator that breaks up the given fragments to the desired
         * granularity specified by `splitType` in the most efficient way possible
         * and only as much as demanded by the consumer of the iterator.
         *
         * This smooths over the minute differences in output between using:
         * - The `byWord` splitter on its own, which will group punctuation
         *   and not-newline whitespace into a single fragment (anything
         *   that is not a word).
         * - The `token` level trim-sequencer, which will split by sentence
         *   first, separating out the not-newline white space between
         *   sentences first, before splitting again by word, which will
         *   separate the punctuation at the end of the sentence.
         *
         * If you need the consistent behavior and laziness of a trim-sequencer
         * without doing the trimming part, use this rather than calling the
         * splitting functions yourself.
         */
        function makeFragmenter(
        /** The granularity of the fragments desired. */
        splitType, 
        /** Whether to yield the fragments in reversed order. */
        reversed = false) {
            const TYPES = ["newline", "sentence", "token"];
            const index = TYPES.findIndex((v) => v === splitType);
            const splitters = TYPES.slice(0, index + 1).map((v) => {
                switch (v) {
                    case "newline": return byLine;
                    case "sentence": return bySentence;
                    case "token": return byWord;
                }
            });
            // We're just gonna go recursive, as usual.
            function* innerIterator(frags, splitFns) {
                // If we're iterating towards the top of the assembly, we need
                // to reverse the fragments we were given.
                frags = reversed ? iterReverse(frags) : frags;
                if (!splitFns.length) {
                    // if we have no functions to split, the recursion is finished.
                    // Just spit them back out (maybe in reversed order).
                    yield* frags;
                }
                else {
                    // Otherwise, split them up and recurse.
                    const [nextFn, ...restFns] = splitFns;
                    for (const srcFrag of frags)
                        yield* innerIterator(nextFn(srcFrag), restFns);
                }
            }
            const fragmenter = (
            /** The fragments to be split up. */
            fragments) => innerIterator(fragments, splitters);
            return fragmenter;
        }
        return Object.assign(exports, {
            byLine,
            byLineFromEnd,
            bySentence,
            byWord,
            hasWords,
            createFragment,
            asFragment,
            asContent,
            asEmptyFragment,
            beforeFragment,
            afterFragment,
            mergeFragments,
            defragment,
            isOffsetInside,
            isContiguous,
            splitFragmentAt,
            makeFragmenter
        });
    });

    /**
     * This massive module provides services for tokenizing the content.
     *
     * It is responsible for setting up an augmented token codec, using
     * either a specific codec that was provided by NovelAI or one of
     * the codecs in its global tokenizer.
     *
     * The augmented codec provides a few extra services besides `encode`
     * and `decode`:
     * - `mendTokens` for joining any combination of strings or
     *   token-arrays into a single token-array.
     * - `findOffset` for locating a character offset in the decoded
     *   string of an encoded token-array in a decently efficient way.
     *
     * It also provides `prependEncoder` and `appendEncoder, the generator
     * functions responsible for lazily tokenizing fragments one at a time.
     * It ended up rather convoluted, but the goal was to minimize the
     * total length of the strings tokenized since the process is expensive.
     */
    const UNSAFE_TOKEN_BUFFER = 10;
    const $$MarkOfAugmentation = Symbol("TokenizerService.tokenCodec");
    var $TokenizerService = usModule((require, exports) => {
        const tokenizerCodec = require($TokenizerCodec);
        const textSplitter = $TextSplitterService(require);
        // NovelAI's token codecs have a bit of a problem that makes handling
        // them efficiently challenging: they only work discretely.  You give
        // it a string, you get tokens.
        //
        // Now, consider the following:
        // You have three strings, `["foo", " ", "bar"]`, and you need to
        // yield the tokens for a concatenated string under a budget.
        //
        // If you take a naive approach, you could tokenize each string:
        // `[[21943], [220], [5657]]`
        // And see you should have three tokens when they're concatenated.
        // In reality, you'll end up with two.
        // `[21943, 2318]`
        //
        // What happened is it tokenized them like `["foo", " bar"]`, combining
        // the whitespace with the word following it.  It has a lot of combined
        // tokens like this that essentially require you to check each permutation
        // that is under your budget until you go over it, as in:
        // - Is "foo" over budget?
        // - Is "foo " over budget?
        // - Is "foo bar" over budget?
        //
        // This kinda sucks, so lets turn the discrete token codec into an async
        // iterable that only does as much work as is needed.
        //
        // We're going to have a concept of "safe" tokens and "unverified" tokens.
        // Unverified tokens are those from a text fragment that was just ingested
        // and close to the end of the string.  They get upgraded to safe tokens
        // when we ingest the next fragment and make sure the interface between
        // the two fragments is stable.
        //
        // We do that by taking the last 10-ish tokens from the end of the
        // previous fragment, decoding them back into a string, tacking them on
        // to the start of the next fragment, encoding it, and then all but the
        // last 10-ish tokens from this fragment are considered safe.
        /**
         * Creates a function that can mend together token arrays, strings, and
         * {@link TextFragment text fragments} into a single, uniform token array.
         *
         * There's two major performance sinks when working with the tokenizer:
         * - The high cost of encoding a string into tokens.
         * - The cost of marshalling the tokenizer's background worker.
         *
         * Because decoding tokens is relatively cheap, we can minimize the size
         * of strings sent to the encoder when joining them together if we have
         * a previously encoded sample of the string.
         *
         * By taking only the tokens at the boundaries where they need to be
         * mended together and decoding those and re-encoding the concatenation
         * of those strings, we can significantly reduce how long we're waiting
         * on the encoder.
         *
         * There is a balance to be struck here, however.  The extra decoding
         * step means we have performance losses due to worker marshalling to
         * cope with, but we can mitigate that to a degree with some braining.
         */
        const makeMendTokens = (encode, decode) => {
            /** To reduce object instantiations. */
            const NO_TOKENS = Object.freeze([]);
            const isTokens = isArray$4;
            const isLengthy = (v) => v.length > 0;
            const toDecoded = (v) => isTokens(v) ? decode(v) : v;
            const doSum = (acc, v) => acc + v.length;
            // We're going to be lazy; when doing assembly and inserting new tokens
            // into the context's token array, rather than try and figure out which
            // tokens were unaffected and which need mending, we're just going throw
            // all the tokens back into `mendTokens`.  When it's mending two pairs
            // of token arrays together, it can check to see if it's done that pair
            // before and pull from cache if so.
            const binaryCache = new Map();
            /** For mending pairs of tokens, this will draw from the cache. */
            const getBinaryFuture = (sections) => {
                // Only applicable to `[Tokens, Tokens]`.
                if (sections.length !== 2 || !sections.every(isTokens))
                    return undefined;
                // We're not going to use the cache for larger sequences.
                if (sections.reduce(doSum, 0) > UNSAFE_TOKEN_BUFFER * 2)
                    return undefined;
                // We can flatten the tokens to build the cache-key as their
                // re-encoded result will be the same, regardless of which side
                // of the mend the tokens came from.
                const key = sections.flat().join(":");
                let theFuture = binaryCache.get(key);
                if (theFuture) {
                    theFuture.isNew = false;
                    return theFuture;
                }
                theFuture = Object.assign(future(), { isNew: true });
                binaryCache.set(key, theFuture);
                return theFuture;
            };
            /** Splits the leading tokens into safe and unsafe portions. */
            const leadingTokens = (bufferSize, tokens) => {
                if (tokens.length === 0)
                    return [tokens, tokens];
                const left = tokens.slice(0, -bufferSize);
                const right = tokens.slice(-bufferSize);
                return [left, right];
            };
            /** Splits the trailing tokens into unsafe and safe portions. */
            const trailingTokens = (bufferSize, tokens) => {
                if (tokens.length === 0)
                    return [tokens, tokens];
                const left = tokens.slice(0, bufferSize);
                const right = tokens.slice(bufferSize);
                return [left, right];
            };
            const doMending = async (
            /** How many tokens at mending boundaries to re-encode. */
            bufferSize, 
            /** All the tokens we have encoded up to this point. */
            prevTokens, 
            /** The sections to be mended. */
            sections) => {
                // Be aware: this is a private function and `boundMendTokens`
                // will have filtered out empty sections for it.  No need to
                // check for those.
                // We need at least one section.
                const lastSection = last(sections);
                if (!lastSection)
                    return prevTokens;
                // Fast-path: With empty `prevTokens`, no need to mend when
                // we only have one element in `sections`.
                if (!prevTokens.length && sections.length === 1) {
                    // Clone the tokens if needed and just use them directly.
                    if (isTokens(lastSection))
                        return toImmutable(lastSection);
                    // We just need to do an `encode` on a single string.
                    return await encode(lastSection);
                }
                // We need to figure out what is going to be involved in the
                // mend and what is not.  We do not need to do an expensive
                // re-encoding when we can just decode a smaller section of
                // tokens and encode that smaller portion instead.
                const [tokensBefore, leading] = leadingTokens(bufferSize, prevTokens);
                // We need to handle the case that the last element was a string.
                const [trailing, tokensAfter] = isTokens(lastSection) ? trailingTokens(bufferSize, lastSection)
                    : [lastSection, NO_TOKENS];
                // `trailing` already has the contribution from the last section,
                // so we'll use `skipRight` to remove it and get the sections
                // in between.
                const between = skipRight(sections, 1);
                // Because `prevTokens` could have been empty, we do still have
                // to filter empty items.  This doubles as a sanity check too.
                const theSections = [leading, ...between, trailing].filter(isLengthy);
                // If this is just mending two token arrays, let's see if we have
                // stored a result for this one already.  If we get one and it
                // isn't new, we'll use it.  Otherwise, we will need to do the
                // mend during this call, and potentially fulfill it.
                const maybeBinary = getBinaryFuture(theSections);
                if (maybeBinary?.isNew === false) {
                    const fromCache = await maybeBinary.promise;
                    return [...tokensBefore, ...fromCache, ...tokensAfter];
                }
                try {
                    // Decode as needed, then encode.
                    const theText = await Promise.all(theSections.map(toDecoded));
                    const tokensMended = await encode(theText.join(""));
                    // Resolve the binary future if we need to.
                    maybeBinary?.resolve(Object.freeze(tokensMended));
                    // And rejoin the split tokens back into the re-encoded portion.
                    return [...tokensBefore, ...tokensMended, ...tokensAfter];
                }
                catch (err) {
                    // Just in case the error happened during the re-join above.
                    if (maybeBinary?.isFulfilled === false)
                        maybeBinary.reject(err);
                    throw err;
                }
            };
            /**
             * Given any arrangement of token arrays, strings, and
             * {@link TextFragment text fragments}, re-encodes everything into a
             * single, uniform array of tokens as efficiently as possible.
             */
            const boundMendTokens = async (
            /** The sections of tokens and strings to be mended together. */
            inputSections, bufferSize = UNSAFE_TOKEN_BUFFER) => {
                // Get everything into either an array of tokens or a string.
                // While we're at it, drop any empty sections; no reason to bother.
                const sections = inputSections
                    .map((v) => isTokens(v) ? v : textSplitter.asContent(v))
                    .filter(isLengthy);
                // Fast-path: If empty, our result is also empty.
                if (sections.length === 0)
                    return NO_TOKENS;
                // Fast-path: If we have only one thing, we just make sure its tokens.
                if (sections.length === 1) {
                    const [section] = sections;
                    if (isTokens(section))
                        return toImmutable(section);
                    return Object.freeze(await encode(section));
                }
                // We want to process things in chunks, each containing zero-or-more
                // strings and ended by an array of tokens (possibly; there is nothing
                // that says the final element can't be a string).
                let prevTokens = NO_TOKENS;
                for (const bufSections of buffer(sections, isTokens))
                    prevTokens = await doMending(bufferSize, prevTokens, bufSections);
                return toImmutable(prevTokens);
            };
            return boundMendTokens;
        };
        /**
         * Creates a function that can locate where a string offset would be
         * located in a token array if it were decoded.
         *
         * This is needed for figuring out how to quickly split tokens into
         * two when splitting a tokenized text fragment into two.
         *
         * Because token mending can fuse two tokens from different fragments
         * together into a single token, it is unsafe to assume that an index
         * from one fragment can map to its mended version.
         *
         * When we want to figure out how to map from a token array to an
         * offset in its decoded string, we got some problems:
         * - Due to mending, we can't really use the source fragments to
         *   assume anything about the mended token array.
         * - We have no easy way to map from "position in string" to "index
         *   of token array" without breaking it down into individual tokens.
         * - When the offset we want happens to be inside a token, that sucks.
         *
         * So, to locate a position in the decoded token array, we need to
         * actually decode its individual tokens...  Or do we!?
         *
         * Unfortunately, the tokenizer has no "convert this array of tokens
         * into an array of its decoded strings" task.  But decoding is actually
         * pretty fast (it's literally looking up a number in a hash-table),
         * the cost of decoding individual tokens is more in marshalling the
         * tokenizer's worker.
         *
         * So, it is actually faster to just use a binary search; we'll decode
         * the same tokens multiple times, but we'll overall reduce how much
         * time we spend doing `postMessage` and `setTimeout` stuff.
         */
        const makeFindOffset = (decode) => {
            const { createFragment, isOffsetInside } = textSplitter;
            const toPart = (source, tokens, tokensOffset, text, textOffset) => {
                const indexOffset = source.indexOffset + tokensOffset;
                const fragment = createFragment(text, textOffset, source.fragment);
                return { indexOffset, tokens, fragment };
            };
            const bifurcate = async (givenPart) => {
                const { tokens, fragment } = givenPart;
                // We should switch to a per-token strategy for 3 or fewer tokens.
                assert("Will not bifurcate; too small!", tokens.length > 3);
                const splitIndex = (tokens.length / 2) | 0;
                const leftTokens = tokens.slice(0, splitIndex);
                const rightTokens = tokens.slice(splitIndex);
                // We only need one of these; we can infer the other.
                const leftText = await decode(leftTokens);
                const rightText = fragment.content.slice(leftText.length);
                assert("Expected `leftText` to be the start of `fragment`.", fragment.content.startsWith(leftText));
                return [
                    toPart(givenPart, leftTokens, 0, leftText, 0),
                    toPart(givenPart, rightTokens, leftTokens.length, rightText, leftText.length)
                ];
            };
            const getData = async (part, tokenIndex) => {
                const index = part.indexOffset + tokenIndex;
                const token = part.tokens[tokenIndex];
                const value = await decode([token]);
                return { index, token, value };
            };
            return async (
            /** The array of tokens to search. */
            tokens, 
            /** The character offset to locate. */
            offset, 
            /** The source text of the `tokens`. */
            sourceText) => {
                // We cannot produce a helpful result with an empty array.
                if (!tokens.length)
                    return undefined;
                // If we were not given the source text, we'll need to decode it.
                sourceText = sourceText != null ? sourceText : await decode(tokens);
                assertInBounds("Expected `offset` to be in bounds of the source text.", offset, sourceText, 
                // The offset at `sourceText.length` is an allowed offset.
                true);
                // Setup our initial part.
                let curPart = {
                    indexOffset: 0,
                    tokens,
                    fragment: textSplitter.createFragment(sourceText, 0)
                };
                // Fast-path: For offset 0, just indicate before.
                if (offset === 0)
                    return { type: "before" };
                // Fast-path: For offset `sourceText.length`, just indicate after.
                if (offset === sourceText.length)
                    return { type: "after" };
                while (curPart.tokens.length > 3) {
                    const [leftPart, rightPart] = await bifurcate(curPart);
                    const inLeft = isOffsetInside(offset, leftPart.fragment);
                    const inRight = isOffsetInside(offset, rightPart.fragment);
                    // Fast-path: This is an exceptional situation, but it basically
                    // means its between the last token of the left part and the first
                    // token of the right part.  We can use this information to spit
                    // out a faster result.
                    if (inLeft && inRight) {
                        const [min, max] = await Promise.all([
                            getData(leftPart, leftPart.tokens.length - 1),
                            getData(rightPart, 0)
                        ]);
                        return { type: "double", min, max, remainder: 0 };
                    }
                    curPart = inLeft ? leftPart : rightPart;
                }
                // When we get here, we should be down to 2 or 3 tokens.  We just
                // need to decide which tokens contain our offset.
                const processor = from(curPart.tokens.keys()).pipe(mergeMap((i) => getData(curPart, i)), scan((a, d) => {
                    const prev = a.fragment;
                    const fragment = createFragment(d.value, prev.offset + prev.content.length);
                    return Object.assign(d, { fragment });
                }, { fragment: createFragment("", 0, curPart.fragment) }), filter((d) => isOffsetInside(offset, d.fragment)), toArray());
                const result = await lastValueFrom(processor);
                switch (result.length) {
                    case 2: {
                        const [min, max] = result;
                        return { type: "double", min, max, remainder: 0 };
                    }
                    case 1: {
                        const [data] = result;
                        const remainder = offset - data.fragment.offset;
                        return { type: "single", data, remainder };
                    }
                    default:
                        throw new Error("Expected to have either 1 or 2 elements.");
                }
            };
        };
        const bootstrapPrepend = async (codec, seedResult, suffix) => {
            // With a seed result, we can unpack the data.
            if (seedResult) {
                const { type, safeCount, unsafeTokens } = seedResult.resume;
                assert("Seed result cannot resume a prepend.", type === "prepend");
                return [
                    unsafeTokens,
                    // We want the last of `tokens` for a prepend.
                    seedResult.tokens.slice(-safeCount),
                    seedResult.fragments
                ];
            }
            // If we have a suffix, we'll prime the unverified tokens with it.
            if (suffix)
                return [await codec.encode(suffix), [], []];
            // Otherwise, we start fresh.
            return [[], [], []];
        };
        /**
         * An encoder that takes an iterable of {@link TextFragment} and provides
         * an asynchronous iterable that will encode the next meaningful chunk of
         * tokens and yield an intermediate result, prepended to the last result.
         *
         * It abstracts away a lot tedium related to the token codecs and avoids
         * pitfalls in how the tokenizer may combine tokens differently from one
         * encoding to the next, while minimizing time spent encoding and decoding.
         *
         * Each time the iterator needs to produce a new result, it does more work,
         * so only request as many values as you need.
         */
        async function* prependEncoder(
        /** The {@link TokenCodec} to use for token encode/decode. */
        codec, 
        /**
         * An iterable containing the text fragments to encode.
         * As this is a prepend encoder, these fragments should be provided
         * in reversed order.
         */
        toEncode, 
        /** Options used to setup the encoder. */
        options) {
            const prefix = options?.prefix ?? "";
            const suffix = options?.suffix ?? "";
            const seedResult = options?.seedResult;
            const bufferSize = options?.bufferSize ?? UNSAFE_TOKEN_BUFFER;
            let [wilderness, safeHouse, encoded] = await bootstrapPrepend(codec, seedResult, suffix);
            const fragmentBuffers = chain(toEncode)
                .thru((frags) => buffer(frags, textSplitter.hasWords))
                .map((bufParts) => bufParts.reverse())
                .value();
            for (const theBuffer of fragmentBuffers) {
                // We want to include unverified tokens, in case they change.
                const toPrepend = await codec.mendTokens([...theBuffer, wilderness], bufferSize);
                // Prepare the result for this encoding before updating our state.
                const fragments = Object.freeze([...theBuffer, ...encoded]);
                const tokens = await codec.mendTokens([prefix, [...toPrepend, ...safeHouse]], bufferSize);
                // The first `bufferSize` tokens are considered unverified.
                wilderness = Object.freeze(toPrepend.slice(0, bufferSize));
                // And anything afterwards is now considered verified.
                safeHouse = [...toPrepend.slice(bufferSize), ...safeHouse];
                encoded = fragments;
                const resume = Object.freeze({
                    type: "prepend",
                    safeCount: safeHouse.length,
                    unsafeTokens: wilderness
                });
                yield Object.freeze({ fragments, tokens, resume });
            }
        }
        const bootstrapAppend = async (codec, seedResult, prefix) => {
            // With a seed result, we can unpack the data.
            if (seedResult) {
                const { type, safeCount, unsafeTokens } = seedResult.resume;
                assert("Seed result cannot resume an append.", type === "append");
                return [
                    unsafeTokens,
                    // We want the first of `tokens` for an append.
                    seedResult.tokens.slice(0, safeCount),
                    seedResult.fragments
                ];
            }
            // If we have a prefix, we'll prime the unverified tokens with it.
            if (prefix)
                return [await codec.encode(prefix), [], []];
            // Otherwise, we start fresh.
            return [[], [], []];
        };
        /**
         * An encoder that takes an iterable of {@link TextFragment} and provides
         * an asynchronous iterable that will encode the next meaningful chunk of
         * tokens and yield an intermediate result, appended to the last result.
         *
         * It abstracts away a lot tedium related to the token codecs and avoids
         * pitfalls in how the tokenizer may combine tokens differently from one
         * encoding to the next, while minimizing time spent encoding and decoding.
         *
         * Each time the iterator needs to produce a new result, it does more work,
         * so only request as many values as you need.
         */
        async function* appendEncoder(
        /** The {@link TokenCodec} to use for token encode/decode. */
        codec, 
        /** An iterable containing the text fragments to encode. */
        toEncode, 
        /** Options used to setup the encoder. */
        options) {
            const prefix = options?.prefix ?? "";
            const suffix = options?.suffix ?? "";
            const seedResult = options?.seedResult;
            const bufferSize = options?.bufferSize ?? UNSAFE_TOKEN_BUFFER;
            let [wilderness, safeHouse, encoded] = await bootstrapAppend(codec, seedResult, prefix);
            const fragmentBuffers = chain(toEncode)
                .thru((frags) => buffer(frags, textSplitter.hasWords))
                .value();
            for (const theBuffer of fragmentBuffers) {
                // We want to include unverified tokens, in case they change.
                const toAppend = await codec.mendTokens([wilderness, ...theBuffer], bufferSize);
                // Prepare the result for this encoding before updating our state.
                const fragments = Object.freeze([...encoded, ...theBuffer]);
                const tokens = await codec.mendTokens([[...safeHouse, ...toAppend], suffix], bufferSize);
                // The last `bufferSize` tokens are considered unverified.
                wilderness = Object.freeze(toAppend.slice(-bufferSize));
                // And anything before that is now considered verified.
                safeHouse = [...safeHouse, ...toAppend.slice(0, -bufferSize)];
                encoded = fragments;
                const resume = Object.freeze({
                    type: "append",
                    safeCount: safeHouse.length,
                    unsafeTokens: wilderness
                });
                yield Object.freeze({ fragments, tokens, resume });
            }
        }
        /** Checks if `value` satisfies the {@link SomeTokenCodec} interface. */
        const isCodec = (value) => {
            if (!isObject$5(value))
                return false;
            if (!hasIn_1(value, "encode"))
                return false;
            if (!hasIn_1(value, "decode"))
                return false;
            if (!isFunction$1(value.encode))
                return false;
            if (!isFunction$1(value.decode))
                return false;
            return true;
        };
        /**
         * Ensures `givenCodec` is a codec and wraps it to ensure it corresponds
         * to an {@link AsyncTokenCodec}. Otherwise, it returns an appropriate
         * global codec instance.
         */
        const getCodec = (type, givenCodec) => {
            // Wrap in a try/catch in case it is synchronous.
            if (isCodec(givenCodec))
                return {
                    encode: (text) => {
                        try {
                            return Promise.resolve(givenCodec.encode(text));
                        }
                        catch (err) {
                            return Promise.reject(err);
                        }
                    },
                    decode: (tokens) => {
                        try {
                            return Promise.resolve(givenCodec.decode(tokens));
                        }
                        catch (err) {
                            return Promise.reject(err);
                        }
                    }
                };
            // NovelAI keeps instantiating a new class for the global encoder, but it
            // seems to work fine (and is much faster) reusing an instance so.
            const globalEncoder = new tokenizerCodec.GlobalEncoder();
            return {
                encode: (text) => globalEncoder.encode(text, type),
                decode: (tokens) => globalEncoder.decode(tokens, type)
            };
        };
        /**
         * Augments the given codec with a few additional methods.
         *
         * It also wraps the given `codec` in a task runner that will run three
         * encode/decode tasks concurrently and buffer any more than that,
         * favoring executing the latest task before older tasks.
         *
         * This will hopefully utilize both the background worker and main thread
         * more efficiently, keeping the worker saturated and the main thread
         * unblocked (as much as is reasonable).
         *
         * The task management would be better placed into the actual background
         * worker, since a task-runner on the main thread can only actually advance
         * the worker's jobs after the current event loop ends...  But it will
         * still be better than no management at all.
         */
        const augmentCodec = (codec) => {
            // @ts-ignore - Preventing double augmentation.
            if (codec[$$MarkOfAugmentation] === true)
                return codec;
            const jobSubject = new Subject();
            // This will execute deferred tasks as appropriate.
            jobSubject.pipe(taskRunner((v) => v.execute(), 3)).subscribe(noop);
            const encode = (text) => {
                const def = defer(() => codec.encode(text));
                jobSubject.next(def);
                return def.promise;
            };
            const decode = (tokens) => {
                const def = defer(() => codec.decode(tokens));
                jobSubject.next(def);
                return def.promise;
            };
            const mendTokens = makeMendTokens(encode, decode);
            const findOffset = makeFindOffset(decode);
            return {
                encode, decode,
                mendTokens, findOffset,
                // @ts-ignore - Don't care.  Doing it anyways.
                [$$MarkOfAugmentation]: true
            };
        };
        /**
         * Provides a codec of the given `tokenizerType`.  If `givenCodec` is
         * provided, it will be checked to make sure it follows the interface
         * and will be used instead of the global codec, if so.
         */
        function codecFor(tokenizerType, givenCodec) {
            const codec = getCodec(tokenizerType, givenCodec);
            return augmentCodec(codec);
        }
        return Object.assign(exports, {
            isCodec,
            codecFor,
            prependEncoder,
            appendEncoder
        });
    });

    class ModelModule extends ModuleDef {
        constructor() {
            super(...arguments);
            this.moduleId = 81101;
            this.expectedExports = 9;
            this.mapping = {
                "vp": ["GetPreamble", "function"]
            };
        }
    }
    var ModelModule$1 = new ModelModule();

    /**
     * Provides helpers or work-alike implementations for NovelAI's internal
     * APIs.
     */
    var $NaiInternals = usModule((require, exports) => {
        const modelModule = require(ModelModule$1);
        const getPreambleTokens = async (codec, data) => {
            if (isArray$4(data.exactTokens))
                return data.exactTokens;
            if (!data.str)
                return [];
            return await codec.encode(data.str);
        };
        const getPreamble = async (codec, model, prefix, prependPreamble, isContextEmpty, isStoryUntrimmed) => {
            const preambleData = modelModule.GetPreamble(model, prependPreamble, isContextEmpty, isStoryUntrimmed, prefix);
            return {
                str: preambleData.str,
                tokens: await getPreambleTokens(codec, preambleData)
            };
        };
        return Object.assign(exports, {
            getPreamble
        });
    });

    /**
     * In order to reduce complexity of passing data around, this module
     * provides an abstraction to ferry generally important parameters
     * influencing the generation of the context around.
     *
     * The function exported here sets up the root context parameters
     * from data provided from NovelAI.  Sub-contexts will use
     * object-spread to copy most properties from the root context's
     * parameter, replacing only those relevant to that sub-context.
     */
    var $ParamsService = usModule((require, exports) => {
        const tokenizerHelpers = require(TokenizerHelpers$1);
        const tokenizer = $TokenizerService(require);
        const naiInternals = $NaiInternals(require);
        async function makeParams(storyContent, storyState, givenTokenLimit, givenStoryLength, prependPreamble = true, givenCodec) {
            const contextName = "<Root>";
            const forSubContext = false;
            const tokenizerType = tokenizerHelpers.getTokenizerType(storyContent.settings.model);
            const tokenCodec = tokenizer.codecFor(tokenizerType, givenCodec);
            const storyLength = givenStoryLength ?? 0;
            const orderByKeyLocations = storyContent.lorebook?.settings?.orderByKeyLocations === true;
            const contextSize = await dew(async () => {
                let contextSize = givenTokenLimit;
                // A module (aka prefix) for a model claims a few tokens to pass
                // data to the model...  Or something like that!
                if (storyContent.settings.prefix !== "vanilla")
                    contextSize -= 20;
                // The preamble's tokens are reserved ahead of time, even if it doesn't
                // end up being used in the end.
                const preamble = await naiInternals.getPreamble(tokenCodec, storyContent.settings.model, storyContent.settings.prefix, prependPreamble, false, false);
                contextSize -= preamble.tokens.length;
                return contextSize;
            });
            return Object.freeze({
                contextName,
                forSubContext,
                storyContent,
                storyState,
                storyLength,
                contextSize,
                tokenizerType,
                tokenCodec,
                prependPreamble,
                orderByKeyLocations
            });
        }
        return Object.assign(exports, {
            makeParams
        });
    });

    /**
     * Allows the given function to be called only once.  Only the first arguments
     * provided will be used; any further calls will always return the result of
     * the first call.
     */
    function callOnce(fn) {
        let result;
        let didCall = false;
        // @ts-ignore - Dumb, shitty, stupid TS.  FFS, do your job properly.
        return (...args) => {
            if (didCall)
                return result;
            didCall = true;
            result = fn(...args);
            return result;
        };
    }

    function protoExtend(proto, extensions) {
        // Using `Object.create` on a function causes it to no longer
        // be callable for some reason.  I dunno.  I guess the hidden
        // `[[Call]]` property is not inheritable for some reason.
        assert("Cannot proto-extend a function.", typeof proto !== "function");
        // Why not just `Object.assign` after the `Object.create`?
        // Because if some property exists on `proto` and it's frozen
        // or not writable, the assign will prioritize that property
        // and fail.  But, since we're using it as a prototype, we can
        // override those properties with new properties on the object
        // instance.
        const propMap = chain(toPairs(extensions))
            .map(([k, v]) => {
            const descriptor = {
                value: v,
                enumerable: true,
                writable: false
            };
            return [k, descriptor];
        })
            .value((iter) => fromPairs(iter));
        return Object.freeze(Object.create(proto, propMap));
    }
    /**
     * Given an object with properties that have an arity-0 function as their
     * value, returns a new object with those properties replaced with
     * the result of calling the function.
     *
     * Each function of a property will only ever be called once.
     */
    const lazyObject = (proto) => {
        const obj = {};
        for (const [k, v] of Object.entries(proto))
            Object.defineProperty(obj, k, { get: callOnce(v) });
        return Object.freeze(obj);
    };

    /**
     * The abstraction here is basically just a scratch-pad used during the
     * builder pipeline.  Yeah, mutating an object in an RxJS stream is bad
     * mojo, but mutation is fast and types can guard programmers from
     * themselves.
     */
    var $ContextSource = usModule((require, exports) => {
        const toIdentifier = (entry, type) => {
            assertAs("Expected an object.", isObject$5, entry);
            ephemeral: {
                if (type !== "ephemeral")
                    break ephemeral;
                if (!("text" in entry))
                    break ephemeral;
                if (!isString(entry.text))
                    break ephemeral;
                const text = entry.text;
                return `E:${text.length > 12 ? `${text.slice(0, 12)}...` : text.slice(0, 15)}`;
            }
            loreLike: {
                if (!("displayName" in entry))
                    break loreLike;
                if (!isString(entry.displayName))
                    break loreLike;
                return entry.displayName;
            }
            switch (type) {
                case "story": return "Story";
                case "memory": return "Memory";
                case "an": return "A/N";
                default: return `Unknown Object (as ${type})`;
            }
        };
        const create = (entry, type, identifier = toIdentifier(entry.field, type)) => {
            return {
                // Just alias the UUID of the content for convenience.
                get uniqueId() { return entry.uniqueId; },
                identifier, type, entry
            };
        };
        return Object.assign(exports, { create });
    });

    class EventModule extends ModuleDef {
        constructor() {
            super(...arguments);
            this.moduleId = 60933;
            this.expectedExports = 4;
            this.mapping = {
                "bi": ["StoryState", "function"],
                "W7": ["StoryInputEvent", "function"],
                "ko": ["PreContextEvent", "function"]
            };
        }
    }
    var EventModule$1 = new EventModule();

    class ContextModule extends ModuleDef {
        constructor() {
            super(...arguments);
            this.moduleId = 58480;
            this.expectedExports = 9;
            this.mapping = {
                "SI": ["ContextField", "function"],
                "vU": ["TRIM_TYPES", "object"]
            };
        }
    }
    var ContextModule$1 = new ContextModule();

    class UUID extends ModuleDef {
        constructor() {
            super(...arguments);
            this.moduleId = 5185;
            this.expectedExports = 1;
            this.mapping = {
                "Z": ["v4", "function"]
            };
        }
    }
    var UUID$1 = new UUID();

    /**
     * This module provides abstractions to support the trimming process.
     *
     * The `TrimProvider` provides functions on how to fragment the text
     * for each trim-type.  It's its own abstraction so the process can
     * potentially be customized, like with comment removal.
     *
     * It is important to note that the providers are setup so the output
     * of the previous trim-level is fed to the next as its input.
     *
     * IE: the `token` level will receive the fragments yielded from
     * the `sentence` level which receives the fragments yielded from
     * the `newline` level which receives the fragments yielded by
     * the `preProcess` function.
     *
     * The `TextSequencer` is mostly just lubricant for the trimming
     * service, representing a single trim-type and hiding the provider
     * behind a standardized interface.  The `getSequencersFrom` function
     * figures out which providers to apply for the configured maximum
     * trim-type for an entry.
     */
    /** The natural order for sequencers. */
    const TRIM_ORDER = Object.freeze(["newline", "sentence", "token"]);
    /** Sequencer token encoder buffer size configurations. */
    const BUFFER_SIZE = Object.freeze([10, 5, 5]);
    /**
     * This module provides common {@link TrimProvider trim providers} used
     * in trimming.  They can be tweaked to mess with the input text for
     * those odd special cases.
     */
    var $TrimmingProviders = usModule((require, exports) => {
        const tokenizerService = $TokenizerService(require);
        const splitterService = $TextSplitterService(require);
        // Generally, we just work off the assembly's content.
        const basicPreProcess = (assembly) => assembly.content;
        // For `doNotTrim`, we do not trim...  So, yield an empty iterable.
        const noop = () => [];
        const isNewline = (f) => f.content === "\n";
        /** Providers for basic trimming. */
        const basic = Object.freeze({
            trimBottom: Object.freeze({
                preProcess: basicPreProcess,
                newline: splitterService.byLine,
                sentence: splitterService.bySentence,
                token: splitterService.byWord,
                reversed: false,
                noSequencing: false
            }),
            trimTop: Object.freeze({
                preProcess: basicPreProcess,
                newline: splitterService.byLineFromEnd,
                sentence: (text) => iterReverse(splitterService.bySentence(text)),
                token: (text) => iterReverse(splitterService.byWord(text)),
                reversed: true,
                noSequencing: false
            }),
            doNotTrim: Object.freeze({
                preProcess: basicPreProcess,
                newline: noop,
                sentence: noop,
                token: noop,
                reversed: false,
                noSequencing: true
            })
        });
        const reCommentFrag = /^##.*$/;
        /** Providers that remove fragments that are comment lines. */
        const removeComments = Object.freeze({
            trimBottom: protoExtend(basic.trimBottom, {
                newline: (text) => {
                    // The goal is to remove comments while keeping the start and end
                    // of the string similarly structured.  There's essentially three
                    // cases we're looking out for:
                    // - The string starts with a comment (with newline).
                    //   - Just remove the comment and following newline.
                    // - The string has comments in lines in the middle.
                    //   - Just remove the comment and following newline.
                    // - The string ends with a comment (no new line after).
                    //   - We want the last non-comment line to also not end with
                    //     a newline.
                    let dropLastNewLine = false;
                    return chain(basic.trimBottom.newline(text))
                        // Chunk it up into the fragments for each line, arranged like:
                        // `[StartFrag, ...RestFrags, CurLineEnd?]`
                        .thru((frags) => buffer(frags, isNewline, true))
                        // This removes any chunks with a comment in the `StartFrag` position.
                        .thru(function* (lineChunks) {
                        for (const frags of lineChunks) {
                            const theStart = first(frags);
                            if (reCommentFrag.test(theStart.content)) {
                                // Removing this line by not yielding it.
                                // Check to see if the comment ended with a newline.
                                // If it did not, and this was the last chunk, then
                                // `dropLastNewLine` will instruct the next step to
                                // remove the previous newline.
                                const theEnd = last(frags);
                                dropLastNewLine = !isNewline(theEnd);
                            }
                            else {
                                yield* frags;
                                dropLastNewLine = false;
                            }
                        }
                    })
                        // This removes the last newline character if needed.
                        .thru(function* (frags) {
                        // We actually need to run through the iterable, since we
                        // are being naughty and have shared mutable state in the
                        // form of the `dropLastNewLine` variable.
                        let lastFrag = undefined;
                        for (const frag of frags) {
                            if (lastFrag)
                                yield lastFrag;
                            lastFrag = frag;
                        }
                        // Now the variable should be set correctly.
                        if (!lastFrag)
                            return;
                        if (isNewline(lastFrag) && dropLastNewLine)
                            return;
                        yield lastFrag;
                    })
                        .value();
                }
            }),
            trimTop: protoExtend(basic.trimTop, {
                newline: (text) => {
                    // Basically the same as above, only the last fragment in a chunk
                    // will be the newline.
                    let dropLastNewLine = false;
                    return chain(basic.trimTop.newline(text))
                        // Chunk it up into the fragments for each line, arranged like:
                        // `[...RestFrags, StartFrag, PrevLineEnd?]`
                        .thru((frags) => buffer(frags, isNewline, true))
                        // This removes any chunks with a comment in the `StartFrag` position.
                        .thru(function* (lineChunks) {
                        for (const frags of lineChunks) {
                            const [theStart, theNewLine] = dew(() => {
                                let theLast = frags.at(-1);
                                if (!isNewline(theLast))
                                    return [theLast, undefined];
                                return [frags.at(-2), theLast];
                            });
                            if (theStart && reCommentFrag.test(theStart.content)) {
                                dropLastNewLine = !theNewLine;
                            }
                            else {
                                yield* frags;
                                dropLastNewLine = false;
                            }
                        }
                    })
                        // This removes the last newline character if needed.
                        .thru(function* (frags) {
                        let lastFrag = undefined;
                        for (const frag of frags) {
                            if (lastFrag)
                                yield lastFrag;
                            lastFrag = frag;
                        }
                        if (!lastFrag)
                            return;
                        if (isNewline(lastFrag) && dropLastNewLine)
                            return;
                        yield lastFrag;
                    })
                        .value();
                }
            }),
            doNotTrim: protoExtend(basic.doNotTrim, {
                preProcess: (assembly) => flatMap(basic.doNotTrim.preProcess(assembly), removeComments.trimBottom.newline)
            })
        });
        /** Ensures `srcProvider` is a {@link TrimProvider}. */
        const asProvider = (srcProvider) => assertExists(`Expected \`${srcProvider}\` to be mappable to a provider.`, isString(srcProvider) ? basic[srcProvider] : srcProvider);
        /**
         * A sequencer is an abstraction that yields longer and longer iterables
         * of a string split up using some kind of strategy.  The idea is that
         * we'll keep adding fragments until we either yield the whole string
         * or we bust the token budget.
         *
         * We'll have sequencers for the different trim settings and when we
         * find we have busted the budget, we'll apply a finer splitter to the
         * fragment that couldn't fit.
         */
        const makeSequencer = (
        /** One of the splitting methods from {@link TrimProvider}. */
        splitUp, 
        /** The size of the encoder's unverified tokens buffer. */
        bufferSize, 
        /** Whether `splitUp` runs in reverse. */
        reversed) => {
            const encode = dew(() => {
                if (reversed)
                    return (codec, toEncode, options) => {
                        options = { bufferSize, ...options };
                        return tokenizerService.prependEncoder(codec, toEncode, options);
                    };
                return (codec, toEncode, options) => {
                    options = { bufferSize, ...options };
                    return tokenizerService.appendEncoder(codec, toEncode, options);
                };
            });
            const prepareInnerChunk = dew(() => {
                if (reversed)
                    return (current, last) => {
                        if (!last)
                            return current.fragments;
                        const diff = current.fragments.length - last.fragments.length;
                        return current.fragments.slice(0, diff).reverse();
                    };
                return (current, last) => {
                    if (!last)
                        return current.fragments;
                    const diff = current.fragments.length - last.fragments.length;
                    return current.fragments.slice(-diff);
                };
            });
            return {
                splitUp,
                encode,
                prepareInnerChunk,
                reversed
            };
        };
        /**
         * Converts a {@link TrimProvider} or {@link TrimDirection} into one
         * or more {@link TextSequencer}, each representing one trim-level,
         * in the order that they should be applied.
         *
         * The `maximumTrimType` indicates the coarsest trim-level that we can
         * use and will influence how many sequencers are returned.
         */
        const getSequencersFrom = (provider, maximumTrimType) => {
            const p = asProvider(provider);
            const order = dew(() => {
                switch (maximumTrimType) {
                    case "token": return TRIM_ORDER;
                    case "sentence": return TRIM_ORDER.slice(0, -1);
                    case "newline": return TRIM_ORDER.slice(0, -2);
                }
            });
            return order
                .map((key, i) => [p[key], BUFFER_SIZE[i]])
                .map(([sFn, bs]) => makeSequencer(sFn, bs, p.reversed));
        };
        return Object.assign(exports, {
            basic,
            removeComments,
            asProvider,
            getSequencersFrom
        });
    });

    /**
     * Wraps the given async-iterable or arity-0 async generator function in an
     * object that caches the yielded values so that multiple iterations do not
     * result in repeat work.
     *
     * Unlike RxJS's `ReplaySubject`, this will only do as much work as asked to
     * do so by whatever is using the iterator, so aborting a `for-await-of` loop
     * early will prevent any additional work being done.
     */
    const toReplay = (source) => {
        const getIterable = isFunction$1(source) ? source : () => source;
        let elements = [];
        let iterator = undefined;
        async function* replayWrapped() {
            yield* elements;
            // Start up the iterator if needed.  This is done only on demand
            // so as to prevent side-effects until the first actual invocation.
            iterator = iterator ?? getIterable()[Symbol.asyncIterator]();
            let n = await iterator.next();
            while (!n.done) {
                elements.push(n.value);
                yield n.value;
                n = await iterator.next();
            }
        }
        return Object.assign(replayWrapped, {
            [Symbol.asyncIterator]: replayWrapped,
            clear: () => {
                elements = [];
                iterator = undefined;
            }
        });
    };
    /**
     * Gets the last value from the given `source` async-iterable as
     * a promise.  This will run the source to the end, naturally.
     *
     * If the source is empty, returns `undefined`.
     */
    const lastValueOrUndef = (source) => lastValueFrom(from(source).pipe(defaultIfEmpty(undefined)));

    /** Creates a fragment cursor. */
    const fragment = (origin, offset) => Object.freeze({ type: "fragment", origin, offset });

    /** Iterates through any `assembly`.  May be `reversed`. */
    function* iterateOn(assembly, reversed = false) {
        const { prefix, content, suffix } = assembly;
        if (reversed) {
            if (suffix.content)
                yield suffix;
            for (const value of iterReverse(content))
                yield value;
            if (prefix.content)
                yield prefix;
        }
        else {
            if (prefix.content)
                yield prefix;
            for (const value of content)
                yield value;
            if (suffix.content)
                yield suffix;
        }
    }
    /**
     * Gets the first non-empty fragment of an assembly, if one exists.
     */
    const getFirstFragment = (assembly) => first(iterateOn(assembly));
    /** Gets the last non-empty fragment of an assembly, if one exists. */
    const getLastFragment = (assembly) => last(iterateOn(assembly));
    /**
     * Gets the source assembly of an assembly.
     *
     * This returns the given assembly if it has a nullish `source` property.
     */
    const getSource = (assembly) => assembly.source ?? assembly;
    /**
     * Gets the text for an assembly.
     *
     * Will attempt to use the `text` property unless `force` is true.
     */
    const getText = (assembly, force = false) => {
        if (!force && isString(assembly.text))
            return assembly.text;
        return [...iterateOn(assembly)].map((f) => f.content).join("");
    };
    /**
     * Gets the text for an assembly.
     *
     * Will attempt to use the `contentText` property unless `force` is true.
     */
    const getContentText = (assembly, force = false) => {
        if (!force && isString(assembly.contentText))
            return assembly.contentText;
        return chain(assembly.content)
            .map((f) => f.content)
            .toArray()
            .join("");
    };
    /** Checks if two assemblies have the same source, and thus, comparable content. */
    const checkRelated = (a, b) => getSource(a) === getSource(b);
    /** Checks if the given assembly has a prefix or suffix. */
    const isAffixed = (assembly) => {
        if (assembly.prefix.content)
            return true;
        if (assembly.suffix.content)
            return true;
        return false;
    };
    /** Checks if the given assembly is entirely empty. */
    const isEmpty = (assembly) => !isAffixed(assembly) && isEmpty$1(assembly.content);
    /** Determines if the given assembly is a source assembly. */
    const isSource = (assembly) => getSource(assembly) === assembly;

    var theBasics = /*#__PURE__*/Object.freeze({
        __proto__: null,
        iterateOn: iterateOn,
        getFirstFragment: getFirstFragment,
        getLastFragment: getLastFragment,
        getSource: getSource,
        getText: getText,
        getContentText: getContentText,
        checkRelated: checkRelated,
        isAffixed: isAffixed,
        isEmpty: isEmpty,
        isSource: isSource
    });

    var $IsContiguous = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        /**
         * Checks if the given assembly's content is contiguous.
         *
         * If the assembly has an `isContiguous` property, it will defer to
         * that and avoid the expensive recheck.
         */
        const isContiguous = (assembly) => {
            if (isBoolean(assembly.isContiguous))
                return assembly.isContiguous;
            return ss.isContiguous(assembly.content);
        };
        return Object.assign(exports, {
            isContiguous
        });
    });

    var $GetStats = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        /**
         * Produces some useful stats given a collection of fragments.
         *
         * This takes an array to force conversion to an iterable type that
         * can definitely be iterated multiple times.
         */
        const getStats = (
        /** The fragments to analyze. */
        fragments, 
        /** When `fragments` is empty, the default offset to use. */
        emptyOffset = 0) => {
            // The empty offset is only used when `fragments` is empty.
            const initOffset = fragments.length ? 0 : emptyOffset;
            const maxOffset = chain(fragments)
                .map(ss.afterFragment)
                .reduce(initOffset, Math.max);
            const minOffset = chain(fragments)
                .map(ss.beforeFragment)
                .reduce(maxOffset, Math.min);
            return {
                minOffset, maxOffset,
                impliedLength: maxOffset - minOffset,
                concatLength: fragments.reduce((p, v) => p + v.content.length, 0)
            };
        };
        return Object.assign(exports, {
            getStats
        });
    });

    var $TheStats = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        const stats = $GetStats(require);
        /**
         * Gets the full fragment stats for a given assembly.
         *
         * If the assembly has a `stats` property, it will defer to that and
         * avoid the expensive recheck, unless `force` is true.
         */
        const getStats = (assembly, force = false) => {
            if (!force && assembly.stats)
                return assembly.stats;
            // If we're un-affixed, we can reuse the content stats.
            // This would skip the conversion to an array.
            if (!isAffixed(assembly))
                return getContentStats(assembly);
            return stats.getStats(toImmutable(iterateOn(assembly)));
        };
        /**
         * Gets the content stats for a given assembly.
         *
         * If the assembly has a `stats` property, it will defer to that and
         * avoid the expensive recheck, unless `force` is true.
         */
        const getContentStats = (assembly, force = false) => {
            if (!force && assembly.contentStats)
                return assembly.contentStats;
            // If the assembly's content was empty, make sure we supply a default
            // offset after the source's prefix.
            return stats.getStats(toImmutable(assembly.content), ss.afterFragment(getSource(assembly).prefix));
        };
        return Object.assign(exports, {
            getStats,
            getContentStats
        });
    });

    /**
     * Module related to perform queries against `IFragmentAssembly`.
     */
    var $QueryOps = usModule((require, exports) => {
        return Object.assign(exports, {
            ...theBasics,
            ...$IsContiguous(require),
            ...$TheStats(require)
        });
    });

    /** Creates a full-text cursor. */
    const fullText = (origin, offset) => Object.freeze({ type: "fullText", origin, offset });

    var $FromFullText = usModule((require, exports) => {
        const splitterService = $TextSplitterService(require);
        const queryOps = $QueryOps(require);
        /**
         * Given a cursor that is addressing this instance's `text`,
         * re-maps that cursor into one addressing the `prefix`, `content`,
         * or `suffix` of the assembly instead.
         *
         * When the cursor falls between two fragments, creating an ambiguity
         * in which offset to use, it will use the first rule below that matches
         * the cursor's situation:
         * - Between prefix and suffix fragments:
         *   - When prefix is non-empty, use the end of the prefix fragment.
         *   - When suffix is non-empty, use the start of the suffix fragment.
         *   - When derived, use the end of the **source's** prefix fragment.
         *   - Otherwise, use offset 0 as a fail-safe.
         * - Between prefix and any content fragment, use the content fragment.
         * - Between suffix and any content fragment, use the content fragment.
         * - Between a wordy fragment and a non-wordy fragment, use the wordy fragment.
         * - Otherwise, whichever fragment comes first in natural order.
         */
        const fromFullText = (assembly, cursor) => {
            assert("Expected a full-text cursor.", cursor.type === "fullText");
            assert("Expected cursor to be for the given assembly.", cursor.origin === assembly);
            assertInBounds("Expected cursor offset to be in bounds of the assembly's text.", cursor.offset, queryOps.getText(assembly), 
            // The position at `length` is valid for a cursor.
            true);
            const { hasWords, beforeFragment, afterFragment } = splitterService;
            const { prefix, suffix } = assembly;
            const content = toImmutable(assembly.content);
            const prefixLength = prefix.content.length;
            const initOffset = dew(() => {
                // If we have an initial fragment, getting an initial offset
                // is very straight-forward.
                const firstFrag = first(content);
                if (firstFrag)
                    return beforeFragment(firstFrag);
                // However, if this assembly has no content, we will still want
                // to produce a stable answer of some sort.  Using the offset
                // after the prefix is a good idea, but since the `prefix` can
                // change due to `splitAt`, we should use the source assembly's
                // prefix instead, since all derived assemblies should have the
                // same value here.
                return afterFragment(queryOps.getSource(assembly).prefix);
            });
            // Fast-path: We can just map straight to `content`.
            if (!queryOps.isAffixed(assembly) && queryOps.isContiguous(assembly))
                return fragment(assembly, cursor.offset + initOffset);
            // When the cursor is within the prefix.
            if (cursor.offset < prefixLength)
                return fragment(assembly, cursor.offset);
            const suffixThreshold = prefixLength + queryOps.getContentStats(assembly).concatLength;
            // When the cursor is within the suffix.
            if (cursor.offset > suffixThreshold)
                return fragment(assembly, (cursor.offset - suffixThreshold) + suffix.offset);
            // Exceptional circumstances; this function is setup to favor the
            // content, but if content is empty and the cursor is between the
            // prefix and suffix (the only possibility left, assuming this cursor
            // actually is for this instance's `text`), we must favor one of
            // those instead.
            if (content.length === 0) {
                if (prefixLength)
                    return fragment(assembly, prefixLength);
                if (suffix.content)
                    return fragment(assembly, suffix.offset);
            }
            else {
                // Remove the prefix from the full-text cursor so we're inside
                // the content block.
                let cursorOffset = cursor.offset - prefixLength;
                // Fast-path: For contiguous content, we can map the cursor directly
                // to the content, now that the prefix was accounted for.
                if (queryOps.isContiguous(assembly))
                    return fragment(assembly, cursorOffset + initOffset);
                // Otherwise, we have to iterate to account for the gaps in content.
                // When there is ambiguity between a fragment with words and a
                // fragment without words, we will favor the one with words.
                let lastFrag = undefined;
                for (const curFrag of content) {
                    const fragLength = curFrag.content.length;
                    // Here, we're dealing with an ambiguity; the last fragment was
                    // non-wordy, so we pulled one more fragment in hopes it was wordy.
                    if (lastFrag && cursorOffset === 0) {
                        // If the current fragment is also non-wordy, break the loop
                        // to use the end of the last fragment.
                        if (!hasWords(curFrag.content))
                            break;
                        // Otherwise, use the start of this fragment.
                        return fragment(assembly, beforeFragment(curFrag));
                    }
                    // Remove this fragment from the full-text offset.  This will go
                    // negative if the offset is inside this fragment.
                    cursorOffset -= fragLength;
                    checks: {
                        // If it's non-zero and positive, we're not in this fragment.
                        if (cursorOffset > 0)
                            break checks;
                        // We're at the very end of this fragment, but because this
                        // fragment has no wordy content, we want to check the next
                        // fragment to see if it is a better candidate to favor.
                        if (cursorOffset === 0 && !hasWords(curFrag.content))
                            break checks;
                        // Otherwise, this is our fragment.  Because we preemptively
                        // subtracted `cursorOffset` to make the checks of the loop
                        // simpler, we have to add it back to the length to get the
                        // correct offset.
                        return fragment(assembly, curFrag.offset + fragLength + cursorOffset);
                    }
                    // Update the last fragment.
                    lastFrag = curFrag;
                }
                // It is possible we still have no last fragment; remember that
                // we were skipping empty fragments.  But if we have one, assume
                // we are meant to use the end of that fragment, since we were
                // likely attempting the non-wordy disambiguation and ran out
                // of fragments.
                if (lastFrag)
                    return fragment(assembly, afterFragment(lastFrag));
            }
            // If we get here, this is the "completely empty assembly" fail-safe;
            // just use the initial offset we determined.
            return fragment(assembly, initOffset);
        };
        return Object.assign(exports, {
            fromFullText
        });
    });

    var $TheBasics = usModule((require, exports) => {
        const { isOffsetInside } = $TextSplitterService(require);
        const { fromFullText } = $FromFullText(require);
        /** Creates a cursor of the given type. */
        const create = (origin, offset, type) => {
            switch (type) {
                case "fullText": return fullText(origin, offset);
                case "fragment": return fragment(origin, offset);
                default: throw new Error(`Unknown cursor type: ${type}`);
            }
        };
        /**
         * Checks if a given cursor's offset appears to be inside a given
         * fragment.
         *
         * As fragments do not have information on their origin assembly,
         * it does not check to make sure the cursor is actually for the
         * fragment.  Use the `positionOf` function in the assembly query
         * operators to interrogate the assembly the fragment came from
         * for that.
         */
        const isCursorInside = (cursor, fragment) => isOffsetInside(cursor.offset, fragment);
        /** Ensures the given cursor is a {@link FragmentCursor}. */
        const asFragmentCursor = (cursor) => {
            if (cursor.type === "fragment")
                return cursor;
            return fromFullText(cursor.origin, cursor);
        };
        /**
         * Converts a {@link MatchResult} to a {@link Selection}.
         *
         * If the match is zero-length, the two cursors will both be
         * identical instances.
         */
        const toSelection = (match, origin, type) => {
            const { index, length } = match;
            const left = asFragmentCursor(create(origin, index, type));
            if (length === 0)
                return Object.freeze([left, left]);
            const right = asFragmentCursor(create(origin, index + length, type));
            return Object.freeze([left, right]);
        };
        return Object.assign(exports, {
            create,
            isCursorInside,
            asFragmentCursor,
            toSelection
        });
    });

    /**
     * Cursors represent a position relative to the source string for
     * an `IFragmentAssembly`.
     *
     * Because a `TextFragment` knows where it was once positioned in
     * the source text, we have a means to map an offset from the source
     * string to one of its fragments, even as we tear that string apart
     * and throw parts of it into the trash.
     *
     * This module provides utilities for working with these offsets.
     */
    var $Cursors = usModule((require, exports) => {
        return Object.assign(exports, {
            fullText,
            fragment,
            ...$TheBasics(require)
        });
    });

    var $IsFoundIn = usModule((require, exports) => {
        const cursors = $Cursors(require);
        const queryOps = $QueryOps(require);
        /**
         * Checks to ensure that the cursor references a valid text fragment;
         * that is, the fragment of this cursor is not missing.
         *
         * When `cursor` originated from another {@link IFragmentAssembly} that was
         * created from the same source text, this can be used to validate that
         * the fragment the cursor is trying to target is still in this instance's
         * `content` array.
         */
        const isFoundIn = (
        /** The assembly to check. */
        assembly, 
        /** The cursor to look for. */
        cursor, 
        /** Whether to accept the cursor to targeting an empty prefix/suffix. */
        allowEmpty = false) => {
            assert("Expected a fragment cursor.", cursor.type === "fragment");
            assert("Expected cursor to be related to the given assembly.", queryOps.checkRelated(assembly, cursor.origin));
            // When allowing empty, we explicitly check the affix fragments.
            if (allowEmpty) {
                if (cursors.isCursorInside(cursor, assembly.prefix))
                    return true;
                if (cursors.isCursorInside(cursor, assembly.suffix))
                    return true;
            }
            // `iterateOn` will skip any empty affix fragments.  Since we'll have
            // already checked them when allowing empty fragments, we can just
            // iterate on the content fragments.
            const frags = allowEmpty ? assembly.content : queryOps.iterateOn(assembly);
            for (const frag of frags)
                if (cursors.isCursorInside(cursor, frag))
                    return true;
            return false;
        };
        return Object.assign(exports, {
            isFoundIn
        });
    });

    var $PositionOf = usModule((require, exports) => {
        const cursors = $Cursors(require);
        const queryOps = $QueryOps(require);
        /**
         * Determines what block the given `cursor` belongs to.  It makes the
         * following checks in this order:
         * - If the cursor has a source that differs from this assembly, it will
         *   return `"unrelated"` to indicate the cursor is unsuitable for this
         *   assembly.
         * - If the cursor is outside of the prefix and suffix, it returns `"content"`.
         * - If the cursor is adjacent to any content fragment, it returns `"content"`.
         * - If the cursor is inside the prefix, it returns `"prefix"`.
         * - If the cursor is inside the suffix, it returns `"suffix"`.
         * - Otherwise, it returns `"content"`, assuming the content fragment
         *   it belongs to is simply missing.
         *
         * It does not check to see if a fragment exists in this assembly that
         * corresponds to the cursor's position.  Use {@link isFoundIn} to make that
         * determination.
         */
        const positionOf = (assembly, cursor) => {
            assert("Expected a fragment cursor.", cursor.type === "fragment");
            // Can't be in this assembly if it is unrelated.
            if (!queryOps.checkRelated(assembly, cursor.origin))
                return "unrelated";
            const source = queryOps.getSource(assembly);
            // We'll use the source's prefix/suffix to keep this consistent between
            // derived assemblies and their source.
            if (cursors.isCursorInside(cursor, source.prefix)) {
                if (isEmpty$1(assembly.content))
                    return "prefix";
                if (cursor.offset !== queryOps.getContentStats(assembly).minOffset)
                    return "prefix";
            }
            else if (cursors.isCursorInside(cursor, source.suffix)) {
                if (isEmpty$1(assembly.content))
                    return "suffix";
                if (cursor.offset !== queryOps.getContentStats(assembly).maxOffset)
                    return "suffix";
            }
            // Acts as the fallback value as well.
            return "content";
        };
        return Object.assign(exports, {
            positionOf
        });
    });

    var $FindBest = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        const queryOps = $QueryOps(require);
        /**
         * Just a helper for {@link findBest}.
         *
         * This can probably emit multiple identical tuples, but we're okay with that.
         */
        function* _iterBounds(frags, needle) {
            for (const frag of frags) {
                const left = ss.beforeFragment(frag);
                yield [left, Math.abs(needle - left)];
                // If this fragment is empty, we can only get one offset from it.
                if (!frag.content)
                    continue;
                const right = ss.afterFragment(frag);
                yield [right, Math.abs(needle - right)];
            }
        }
        /** A reducer function for {@link findBest}. */
        const _offsetReducer = (p, c) => {
            if (!p)
                return c;
            if (c[1] <= p[1])
                return c;
            return p;
        };
        /**
         * Checks to ensure that the cursor references a valid text fragment;
         * that is, the fragment of this cursor is not missing.
         *
         * If the fragment is missing, it will reposition the cursor to the
         * nearest existing fragment.
         *
         * If the assembly is empty (all fragments have length-zero content),
         * it will reposition it to the nearest prefix or suffix offset.
         *
         * When `cursor` originated from a related {@link FragmentAssembly}, this
         * can be used to adapt the cursor to a reasonable position that does
         * exist.
         */
        const findBest = (
        /** The assembly to query. */
        assembly, 
        /** The cursor to potentially adjust. */
        cursor, 
        /**
         * Whether to favor content fragments.  This does not guarantee that
         * the returned cursor will be inside the content, but it will do
         * its best.
         */
        preferContent = false, 
        /**
         * Whether to use the prefix/suffix of the given assembly or its source
         * when no suitable fragments are found.
         */
        fallbackToSource = true) => {
            // This also does the various assertions, so no need to repeat those.
            if ($IsFoundIn(require).isFoundIn(assembly, cursor)) {
                if (!preferContent)
                    return cursor;
                // If we're preferring content, make sure it is for content.
                const pos = $PositionOf(require).positionOf(assembly, cursor);
                if (pos === "content")
                    return cursor;
            }
            // Seems to be missing.  Let's see about finding the next best offset.
            // That will be one end of some existing fragment with the minimum
            // distance from the cursor's offset and the fragment's end.
            // We can prefer searching within only the content.
            const fragments = preferContent ? assembly.content : queryOps.iterateOn(assembly);
            const offsetsIterator = _iterBounds(fragments, cursor.offset);
            if (queryOps.isContiguous(assembly)) {
                // Fast-path: for contiguous assemblies, we can stop as soon as the
                // distance stops getting smaller.
                let lastResult = undefined;
                for (const curResult of offsetsIterator) {
                    const next = _offsetReducer(lastResult, curResult);
                    // We hit the minimum if we get the `lastResult` back.
                    if (next === lastResult)
                        return fragment(assembly, next[0]);
                    lastResult = next;
                }
                // If we get here, we ran through them all and never got the last
                // result back from `_offsetReducer`.  But, if we have `lastResult`,
                // we will assume the very last fragment was the nearest.
                if (lastResult)
                    return fragment(assembly, lastResult[0]);
            }
            else {
                // For non-contiguous assemblies, we'll have to run through every
                // fragment to find the minimum difference.
                const result = chain(offsetsIterator).reduce(undefined, _offsetReducer);
                if (result)
                    return fragment(assembly, result[0]);
            }
            // If we get here, `fragments` was probably empty, which can happen
            // and is perfectly valid.  We can fall back to anchoring to the
            // boundaries of each significant block instead, defined completely by
            // the prefix and suffix.  This is one of the reasons why we're habitually
            // generating these, even if they're empty.
            const fallback = fallbackToSource ? queryOps.getSource(assembly) : assembly;
            const [newOffset] = assertExists("Expected to have boundaries from prefix and suffix.", chain(_iterBounds([fallback.prefix, fallback.suffix], cursor.offset))
                .reduce(undefined, _offsetReducer));
            return fragment(assembly, newOffset);
        };
        return Object.assign(exports, {
            findBest
        });
    });

    var $ContentCursorOf = usModule((require, exports) => {
        const { findBest } = $FindBest(require);
        const { isFoundIn } = $IsFoundIn(require);
        const { positionOf } = $PositionOf(require);
        /**
         * Checks to make sure that the given `cursor` points to a valid
         * fragment in the assembly's `content`.
         *
         * When `loose` is `true` and no fragment was found, it will try
         * to reposition the cursor to the nearest valid fragment.
         *
         * Otherwise, it returns `undefined` if no fragment was found.
         */
        const contentCursorOf = (
        /** The assembly to check against. */
        assembly, 
        /** The cursor demarking the position of the cut. */
        cursor, 
        /**
         * If `true` and no fragment exists in the assembly for the position,
         * the next best position will be used instead as a fallback.
         */
        loose = false) => {
            // The input cursor must be for the content.
            if (positionOf(assembly, cursor) !== "content")
                return undefined;
            // Without `loose`, we cannot try to adjust it.
            if (!loose)
                return isFoundIn(assembly, cursor) ? cursor : undefined;
            const bestCursor = findBest(assembly, cursor, true);
            // Make sure the cursor did not get moved out of the content.
            // This can happen when the content is empty; the only remaining
            // place it could be moved was to a prefix/suffix fragment.
            const isForContent = positionOf(assembly, bestCursor) === "content";
            return isForContent ? bestCursor : undefined;
        };
        return Object.assign(exports, {
            contentCursorOf
        });
    });

    var $ToFullText = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        const cursors = $Cursors(require);
        const queryOps = $QueryOps(require);
        const { isFoundIn } = $IsFoundIn(require);
        /**
         * Converts a fragment cursor into a full-text cursor.
         *
         * The cursor must be addressing a fragment that exists within this assembly.
         */
        const toFullText = (assembly, cursor) => {
            assert("Expected cursor to belong to a fragment of the given assembly.", isFoundIn(assembly, cursor, true));
            let fullLength = 0;
            for (const frag of queryOps.iterateOn(assembly)) {
                if (cursors.isCursorInside(cursor, frag)) {
                    fullLength += cursor.offset - ss.beforeFragment(frag);
                    break;
                }
                fullLength += frag.content.length;
            }
            return cursors.fullText(assembly, fullLength);
        };
        return Object.assign(exports, {
            toFullText
        });
    });

    /**
     * Module related to interactions between `IFragmentAssembly` and
     * the cursors.
     */
    var $CursorOps = usModule((require, exports) => {
        return Object.assign(exports, {
            ...$ContentCursorOf(require),
            ...$FindBest(require),
            ...$FromFullText(require),
            ...$IsFoundIn(require),
            ...$PositionOf(require),
            ...$ToFullText(require)
        });
    });

    /**
     * For classes that are going to wrap a {@link IFragmentAssembly}, this
     * function will ensure that the instance is stabilized.  This is to
     * prevent deep getter/setter recursion and ensure that the `content`
     * property is a materialized iterable.
     *
     * Asserts that the given assembly satisfies the following:
     * - Its `prefix` has an offset of `0`.
     * - Its `content` does not contain any empty fragments.
     *   - Many assembly operators expect the content to contain only
     *     non-empty fragments.
     *   - Only checked during testing or when debug mode is enabled as it can
     *     get expensive to run this check.
     *
     * If either of these assertions fail, an error is thrown.
     *
     * Additionally, it runs these checks on the given assembly:
     * - Ensures that the assembly is a plain object.
     * - Ensures that the assembly's content is a readonly array.
     *
     * If either of these checks fail, it returns a new object instance that
     * has the minimum number of properties to fit the {@link IFragmentAssembly}
     * interface.
     */
    function makeSafe(assembly) {
        // We make assumptions that the prefix fragment is always at offset 0.
        assert("Expected prefix's offset to be 0.", assembly.prefix.offset === 0);
        const content = toImmutable(assembly.content);
        {
            // Because I'm tired of coding around this possibility.
            // Note: this does allow `content` to be empty, but if it contains
            // fragments, they must all be non-empty.
            assert("Expected content to contain only non-empty fragments.", content.every((f) => Boolean(f.content)));
        }
        checks: {
            // This may be a wrapped assembly; we'll want to recompose it.
            if (!isPojo(assembly))
                break checks;
            // Do not trust mutable assemblies.
            if (!Object.isFrozen(assembly))
                break checks;
            // It was not readonly, so we'll want a new instance.
            if (content !== assembly.content)
                break checks;
            return assembly;
        }
        // Recompose the object with the new content.  We want to do this
        // on a per-property basis, in case this instance is not a POJO.
        // We'll drop the `source` if it's a source.
        if (isSource(assembly)) {
            const { prefix, suffix } = assembly;
            return Object.freeze({ prefix, content, suffix });
        }
        else {
            const { prefix, suffix, source } = assembly;
            return Object.freeze({ prefix, content, suffix, source });
        }
    }

    var $GetAffixForSplit = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        /**
         * Helper function that prepares the `prefix` and `suffix` properties
         * for splitting.  If one of the fragments is already empty, it will
         * avoid instantiating a new fragment.
         */
        const getAffixForSplit = (
        /** The assembly being split. */
        assembly) => {
            // If we're splitting this assembly, it doesn't make sense to preserve
            // the suffix on the assembly before the cut or the prefix after the cut.
            // Replace them with empty fragments, as needed.
            const { prefix, suffix } = assembly;
            const afterPrefix = ss.asEmptyFragment(prefix);
            const beforeSuffix = ss.asEmptyFragment(suffix);
            return [
                { prefix, suffix: beforeSuffix },
                { prefix: afterPrefix, suffix }
            ];
        };
        return Object.assign(exports, {
            getAffixForSplit
        });
    });

    var $RemoveAffix$1 = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        const queryOps = $QueryOps(require);
        /**
         * Generates a version of the given assembly that has no prefix or suffix.
         *
         * It still has the same source, so cursors for that source will still
         * work as expected.
         */
        const removeAffix = (assembly) => {
            // No need if we don't have a prefix or suffix.
            if (!queryOps.isAffixed(assembly))
                return assembly;
            // Replace the suffix and prefix with zero-length fragments.
            return Object.freeze({
                prefix: ss.asEmptyFragment(assembly.prefix),
                content: toImmutable(assembly.content),
                suffix: ss.asEmptyFragment(assembly.suffix),
                source: queryOps.getSource(assembly)
            });
        };
        return Object.assign(exports, {
            removeAffix
        });
    });

    var $SplitAt$2 = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        const cursors = $Cursors(require);
        /**
         * Given a cursor and a sequence of text fragments, splits the sequence
         * into two sequences.  The result is a tuple where the first element
         * is the text before the cut and the second element is the text after
         * the cut.
         *
         * It is assumed that `cursor` belongs to some fragment of `content`.
         */
        const splitAt = (content, cursor) => {
            const beforeCut = [];
            const afterCut = [];
            let curBucket = beforeCut;
            for (const frag of content) {
                // Do we need to swap buckets?
                checkForSwap: {
                    if (curBucket === afterCut)
                        break checkForSwap;
                    if (!cursors.isCursorInside(cursor, frag))
                        break checkForSwap;
                    const cursorOffset = cursor.offset;
                    // This is the fragment of the cut.  Let's figure out how to split
                    // the fragment.  We only need to bother if the point is inside the
                    // fragment, that is, not at one of its ends.  We're going to the
                    // trouble because text fragments are immutable and it'd be nice to
                    // preserve referential equality where possible.
                    switch (cursorOffset) {
                        case ss.beforeFragment(frag):
                            afterCut.push(frag);
                            break;
                        case ss.afterFragment(frag):
                            beforeCut.push(frag);
                            break;
                        default: {
                            const [before, after] = ss.splitFragmentAt(frag, cursorOffset);
                            beforeCut.push(before);
                            afterCut.push(after);
                            break;
                        }
                    }
                    // Finally, swap the buckets so we place the remaining fragments in
                    // the correct derivative assembly.
                    curBucket = afterCut;
                    continue;
                }
                // If we left the `checkForSwap` block, just add it to the current bucket.
                curBucket.push(frag);
            }
            return [Object.freeze(beforeCut), Object.freeze(afterCut)];
        };
        return Object.assign(exports, {
            splitAt
        });
    });

    /**
     * Module related to operating on kinds of `Iterable<TextFragment>`.
     */
    var $SequenceOps = usModule((require, exports) => {
        return Object.assign(exports, {
            ...$GetStats(require),
            ...$SplitAt$2(require)
        });
    });

    var $SplitAt$1 = usModule((require, exports) => {
        const cursorOps = $CursorOps(require);
        const seqOps = $SequenceOps(require);
        const { getAffixForSplit } = $GetAffixForSplit(require);
        /**
         * Given a cursor placed within this assembly's content, splits this
         * assembly into two assemblies.  The result is a tuple where the
         * first element is the text before the cut and the second element
         * is the text after the cut.
         *
         * The `suffix` of the first assembly and the `prefix` of the second
         * assembly will be empty, and so may differ from their shared source.
         *
         * If a cut cannot be made, `undefined` is returned.
         */
        const splitAt = (
        /** The assembly to split. */
        assembly, 
        /**
         * The cursor demarking the position of the cut.
         *
         * Must be a cursor within the assembly's content.
         */
        cursor) => {
            const usedCursor = cursorOps.contentCursorOf(assembly, cursor);
            if (!usedCursor)
                return undefined;
            const content = isArray$4(assembly.content) ? assembly.content : [...assembly.content];
            const [beforeCut, afterCut] = seqOps.splitAt(content, usedCursor);
            const [beforeAffix, afterAffix] = getAffixForSplit(assembly);
            return {
                assemblies: [
                    Object.freeze({
                        ...beforeAffix,
                        content: beforeCut,
                        source: getSource(assembly)
                    }),
                    Object.freeze({
                        ...afterAffix,
                        content: afterCut,
                        source: getSource(assembly)
                    })
                ],
                cursor: usedCursor
            };
        };
        return Object.assign(exports, {
            splitAt
        });
    });

    /**
     * Module related to manipulating `IFragmentAssembly`.
     */
    var $ManipOps = usModule((require, exports) => {
        return Object.assign(exports, {
            makeSafe,
            ...$GetAffixForSplit(require),
            ...$RemoveAffix$1(require),
            ...$SplitAt$1(require)
        });
    });

    const theModule$7 = usModule((require, exports) => {
        var _BaseAssembly_wrapped, _BaseAssembly_text, _BaseAssembly_contentText, _BaseAssembly_assemblyStats, _BaseAssembly_contentStats, _BaseAssembly_isContiguous;
        const manipOps = $ManipOps(require);
        const queryOps = $QueryOps(require);
        /**
         * A class fitting {@link IFragmentAssembly} that provides caching
         * for certain, expensive to calculate properties.
         *
         * It essentially acts as a wrapper around a plain-object assembly.
         */
        class BaseAssembly {
            constructor(wrapped, isContiguous) {
                _BaseAssembly_wrapped.set(this, void 0);
                _BaseAssembly_text.set(this, undefined);
                _BaseAssembly_contentText.set(this, undefined);
                _BaseAssembly_assemblyStats.set(this, undefined);
                _BaseAssembly_contentStats.set(this, undefined);
                _BaseAssembly_isContiguous.set(this, void 0);
                // A couple of things: if we were given a `BaseAssembly`, we'll
                // just reuse its wrapped instance.  Otherwise, we need to safe it.
                __classPrivateFieldSet(this, _BaseAssembly_wrapped, wrapped instanceof BaseAssembly ? __classPrivateFieldGet(wrapped, _BaseAssembly_wrapped, "f")
                    : manipOps.makeSafe(wrapped), "f");
                __classPrivateFieldSet(this, _BaseAssembly_isContiguous, isContiguous, "f");
            }
            /** The prefix fragment. */
            get prefix() { return __classPrivateFieldGet(this, _BaseAssembly_wrapped, "f").prefix; }
            /** The content fragments. */
            get content() { return __classPrivateFieldGet(this, _BaseAssembly_wrapped, "f").content; }
            /** The suffix fragment. */
            get suffix() { return __classPrivateFieldGet(this, _BaseAssembly_wrapped, "f").suffix; }
            /** The full, concatenated text of the assembly. */
            get text() {
                return __classPrivateFieldSet(this, _BaseAssembly_text, __classPrivateFieldGet(this, _BaseAssembly_text, "f") ?? queryOps.getText(this, true), "f");
            }
            /** The concatenated text of the assembly's `content`. */
            get contentText() {
                return __classPrivateFieldSet(this, _BaseAssembly_contentText, __classPrivateFieldGet(this, _BaseAssembly_contentText, "f") ?? queryOps.getContentText(this, true), "f");
            }
            /** The stats for this assembly. */
            get stats() {
                return __classPrivateFieldSet(this, _BaseAssembly_assemblyStats, __classPrivateFieldGet(this, _BaseAssembly_assemblyStats, "f") ?? queryOps.getStats(this, true), "f");
            }
            /** The stats for only the {@link content} portion of the assembly. */
            get contentStats() {
                return __classPrivateFieldSet(this, _BaseAssembly_contentStats, __classPrivateFieldGet(this, _BaseAssembly_contentStats, "f") ?? queryOps.getContentStats(this, true), "f");
            }
            /**
             * The source of this assembly.  If `isSource` is `true`, this
             * will return itself, so this will always get a source assembly.
             */
            get source() {
                const source = queryOps.getSource(__classPrivateFieldGet(this, _BaseAssembly_wrapped, "f"));
                return source === __classPrivateFieldGet(this, _BaseAssembly_wrapped, "f") ? this : source;
            }
            /** Whether this assembly was generated directly from a source text. */
            get isSource() {
                return this.source === this;
            }
            /** Whether either `prefix` and `suffix` are non-empty. */
            get isAffixed() {
                return queryOps.isAffixed(__classPrivateFieldGet(this, _BaseAssembly_wrapped, "f"));
            }
            /** Whether `content` is contiguous. */
            get isContiguous() {
                return __classPrivateFieldGet(this, _BaseAssembly_isContiguous, "f");
            }
            /** Whether this assembly is entirely empty or not. */
            get isEmpty() {
                return !this.isAffixed && !this.content.length;
            }
            /**
             * Iterator that yields all fragments that are not empty.  This can
             * include both the {@link prefix} and the {@link suffix}.
             */
            [(_BaseAssembly_wrapped = new WeakMap(), _BaseAssembly_text = new WeakMap(), _BaseAssembly_contentText = new WeakMap(), _BaseAssembly_assemblyStats = new WeakMap(), _BaseAssembly_contentStats = new WeakMap(), _BaseAssembly_isContiguous = new WeakMap(), Symbol.iterator)]() {
                return queryOps.iterateOn(__classPrivateFieldGet(this, _BaseAssembly_wrapped, "f"));
            }
        }
        return Object.assign(exports, {
            BaseAssembly
        });
    });

    const defaultMakeOptions = {
        prefix: "",
        suffix: "",
        assumeContinuity: false
    };
    const theModule$6 = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        const cursorOps = $CursorOps(require);
        const manipOps = $ManipOps(require);
        const queryOps = $QueryOps(require);
        const { BaseAssembly } = theModule$7(require);
        /**
         * A class fitting {@link IFragmentAssembly} that provides caching facilities
         * and convenient access to the limited set of operators used for context
         * content sourcing.
         *
         * It essentially acts as a wrapper around a plain-object assembly.
         */
        class FragmentAssembly extends BaseAssembly {
            constructor(wrapped, isContiguous) {
                super(wrapped, isContiguous);
            }
            /** Bound version of {@link queryOps.checkRelated}. */
            isRelatedTo(other) {
                return queryOps.checkRelated(this, other);
            }
            /** Bound version of {@link cursorOps.isFoundIn}. */
            isFoundIn(cursor) {
                return cursorOps.isFoundIn(this, cursor);
            }
            /** Bound version of {@link cursorOps.findBest}. */
            findBest(cursor) {
                return cursorOps.findBest(this, cursor);
            }
            /** Bound version of {@link manipOps.splitAt}. */
            splitAt(
            /** The cursor demarking the position of the cut. */
            cursor) {
                return manipOps.splitAt(this, cursor)?.assemblies.map((a) => {
                    return new FragmentAssembly(a, this.isContiguous);
                });
            }
            /** Bound version of {@link manipOps.removeAffix}. */
            asOnlyContent() {
                const result = manipOps.removeAffix(this);
                // If we're already only-content, `removeAffix` will return its input.
                if (result === this)
                    return this;
                return new FragmentAssembly(result, this.isContiguous);
            }
        }
        /**
         * Checks if the given `assembly` is a {@link FragmentAssembly}.
         *
         * Specifically, the class; it may still be an object that fits the
         * interface, but it's not a {@link FragmentAssembly}.
         */
        function isInstance(assembly) {
            return assembly instanceof FragmentAssembly;
        }
        /**
         * Converts the given assembly into a {@link FragmentAssembly}.
         *
         * Warning: This will not defragment the contents of the assembly.
         */
        function castTo(assembly) {
            if (isInstance(assembly))
                return assembly;
            return new FragmentAssembly(assembly, queryOps.isContiguous(assembly));
        }
        /**
         * Creates a new source assembly from a single string or {@link TextFragment}.
         */
        function fromSource(sourceText, options) {
            const { prefix, suffix } = { ...defaultMakeOptions, ...options };
            const prefixFragment = ss.createFragment(prefix, 0);
            const sourceFragment = dew(() => {
                let content;
                let offset = ss.afterFragment(prefixFragment);
                if (typeof sourceText === "string")
                    content = sourceText;
                else {
                    content = sourceText.content;
                    offset += sourceText.offset;
                }
                if (!content)
                    return undefined;
                return ss.createFragment(content, offset);
            });
            const suffixOffset = ss.afterFragment(sourceFragment ?? prefixFragment);
            const suffixFragment = ss.createFragment(suffix, suffixOffset);
            const rawAssembly = {
                prefix: prefixFragment,
                content: toImmutable(sourceFragment ? [sourceFragment] : []),
                suffix: suffixFragment,
            };
            // Can only be contiguous.
            return new FragmentAssembly(rawAssembly, true);
        }
        /**
         * Creates a new source assembly from a collection of {@link TextFragment}.
         */
        function fromFragments(sourceFrags, options) {
            const { prefix, suffix, assumeContinuity } = { ...defaultMakeOptions, ...options };
            const adjustedFrags = chain(sourceFrags)
                .filter((f) => Boolean(f.content))
                .thru((frags) => {
                if (!prefix)
                    return frags;
                return mapIter(frags, (f) => ss.createFragment(f.content, prefix.length + f.offset));
            })
                .thru(ss.defragment)
                .value(toImmutable);
            const maxOffset = chain(adjustedFrags)
                .map(ss.afterFragment)
                .reduce(0, Math.max);
            const rawAssembly = {
                prefix: ss.createFragment(prefix, 0),
                content: adjustedFrags,
                suffix: ss.createFragment(suffix, maxOffset),
            };
            return new FragmentAssembly(rawAssembly, assumeContinuity ? true : ss.isContiguous(adjustedFrags));
        }
        /**
         * Creates a new assembly derived from the given `originAssembly`.  The given
         * `fragments` should have originated from the origin assembly's
         * {@link IFragmentAssembly.content content}.
         *
         * If `fragments` contains the origin's `prefix` and `suffix`, they are
         * filtered out automatically.  This is because `FragmentAssembly` is itself
         * an `Iterable<TextFragment>` and sometimes you just wanna apply a simple
         * transformation on its fragments, like a filter.
         */
        function fromDerived(
        /** The fragments making up the derivative's content. */
        fragments, 
        /**
         * The assembly whose fragments were used to make the given fragments.
         * This assembly does not need to be a source assembly.
         */
        originAssembly, 
        /**
         * Whether to make assumptions on if the fragments are contiguous.
         *
         * Setting this to `true` can save time when creating a lot of derived
         * assemblies by skipping the iteration to check for continuity in the
         * fragments.
         */
        options) {
            // Fast path: the underlying data of `FragmentAssembly` is immutable, so if
            // we're given one, just spit it right back out.
            if (isInstance(fragments)) {
                // But make sure we're still internally consistent.
                assert("Expected the assembly to be related to `originAssembly`.", queryOps.checkRelated(fragments, originAssembly));
                return fragments;
            }
            // Make sure we actually have the source assembly.
            const source = queryOps.getSource(originAssembly);
            // Use the given instance's prefix and suffix, though.  It may now
            // differ from the source due to splitting and the like.
            const { prefix, suffix } = originAssembly;
            const localFrags = chain(fragments)
                // Make sure the prefix and suffix fragments are not included.
                .filter((v) => v !== prefix && v !== suffix)
                // And defragment them.
                .thru(ss.defragment)
                .value(toImmutable);
            const assumeContinuity = options?.assumeContinuity ?? false;
            const assembly = new FragmentAssembly({ prefix, content: localFrags, suffix, source }, 
            // We'll assume the derived assembly has the same continuity as
            // its origin assembly.
            assumeContinuity ? queryOps.isContiguous(originAssembly) : ss.isContiguous(localFrags));
            // Also sanity check the content if thorough logging is enabled.
            {
                const oldStats = queryOps.getContentStats(source);
                const newStats = assembly.contentStats;
                assert("Expected minimum offset to be in range of source.", newStats.minOffset >= oldStats.minOffset);
                assert("Expected maximum offset to be in range of source.", newStats.maxOffset <= oldStats.maxOffset);
            }
            return assembly;
        }
        return Object.assign(exports, {
            isInstance,
            castTo,
            fromSource,
            fromFragments,
            fromDerived
        });
    });

    /**
     * Given a {@link Cursor.Fragment} or a {@link Cursor.Selection},
     * produces the cursor suited for the given `direction`.
     */
    function cursorForDir(
    /** A cursor or selection marking the position of the iteration. */
    position, 
    /** Which direction to iterate. */
    direction) {
        if (!isArray$4(position))
            return position;
        return direction === "toTop" ? position[0] : position[1];
    }

    var $SplitToSelections = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        const providers = $TrimmingProviders(require);
        const cursors = $Cursors(require);
        const queryOps = $QueryOps(require);
        const cursorOps = $CursorOps(require);
        /**
         * Split up the input fragments and yields the result fragments starting
         * from the fragment identified by a `offset`.
         *
         * Helper function for {@link splitToSelections}.
         */
        const sequenceFragments = (
        /** The offset that will identify the starting fragment. */
        offset, 
        /** The input fragments to process. */
        inFrags, 
        /** The sequencers left to run. */
        sequencers) => {
            // Skip fragments while we have not found the cursor that
            // indicates the start of iteration.  This needs to be done
            // regardless of if we're doing further splitting.
            const theFrags = skipUntil(inFrags, (f) => ss.isOffsetInside(offset, f));
            if (!sequencers.length)
                return theFrags;
            const [sequencer, ...restSeq] = sequencers;
            // Split them up.
            const splitFrags = flatMap(theFrags, sequencer.splitUp);
            // Recurse to split them up further until we're out of sequencers.
            return sequenceFragments(offset, splitFrags, restSeq);
        };
        /**
         * Uses the given {@link TrimType} to split the given assembly into
         * selections that represent the start and end of those split fragments.
         *
         * This allows us to deal with oddities in the assembly, like gaps, while
         * splitting it like its fragments were all concatenated.
         */
        function* splitToSelections(
        /** The assembly to split. */
        assembly, 
        /** The type of splitting to perform. */
        splitType, 
        /** Which direction to iterate. */
        direction, 
        /** The cursor that will identify the starting fragment. */
        cursor) {
            const provider = direction === "toTop" ? "trimTop" : "trimBottom";
            const sequencers = providers.getSequencersFrom(provider, splitType);
            // We're going to switch into the full-text perspective, split that
            // into fragments, and then switch back to the fragment perspective.
            const fullText = ss.createFragment(queryOps.getText(assembly), 0);
            const ftCursor = dew(() => {
                if (cursor) {
                    const bestCursor = cursorOps.findBest(assembly, cursor, false, false);
                    return cursorOps.toFullText(assembly, bestCursor);
                }
                else {
                    const offsetFn = direction === "toTop" ? ss.afterFragment : ss.beforeFragment;
                    return cursors.fullText(assembly, offsetFn(fullText));
                }
            });
            // Split the full-text into fragments.
            const frags = sequenceFragments(ftCursor.offset, [fullText], sequencers);
            // Now, we map the start and end of each fragment into a selection.
            for (const frag of frags) {
                const start = cursors.fullText(assembly, ss.beforeFragment(frag));
                const end = cursors.fullText(assembly, ss.afterFragment(frag));
                const selection = Object.freeze([
                    cursorOps.fromFullText(assembly, start),
                    cursorOps.fromFullText(assembly, end)
                ]);
                yield Object.freeze({ content: frag.content, selection });
            }
        }
        return Object.assign(exports, {
            splitToSelections
        });
    });

    const lineBatcher = (c, p) => c.content === p.content && c.content === "\n";
    var $PositionsFrom = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        const { splitToSelections } = $SplitToSelections(require);
        /**
         * Yields batches of normal fragments, but for batches of `\n` fragments,
         * it will insert a zero-length fragment between each of them then remove
         * the `\n` fragments.
         */
        const makeHandler = (toLineCursor) => {
            const emptyFrom = (f) => {
                const c = toLineCursor(f);
                return { content: "", selection: [c, c] };
            };
            return (iter) => flatMap(iter, (splitUp) => {
                // Batches with a length greater than `1` will contain only `\n`
                // fragments.  For anything else, nothing special needs to be done.
                if (splitUp.length === 1)
                    return splitUp;
                // Doing what was said above, but cleverly.
                return mapIter(skip(splitUp, 1), emptyFrom);
            });
        };
        const forDir = {
            toTop: {
                /** Direction of iteration ← \n|\n|~\n~ */
                handleNewlines: makeHandler(({ selection: s }) => s[1]),
                toPosition: (a, c) => (s) => {
                    if (s.content.length !== 0 && !ss.hasWords(s.content))
                        return undefined;
                    const { offset } = s.selection[0];
                    if (offset > c.offset)
                        return undefined;
                    return fragment(a, offset);
                }
            },
            toBottom: {
                /** Direction of iteration → ~\n~|\n|\n */
                handleNewlines: makeHandler(({ selection: s }) => s[0]),
                toPosition: (a, c) => (s) => {
                    if (s.content.length !== 0 && !ss.hasWords(s.content))
                        return undefined;
                    const { offset } = s.selection[0];
                    if (offset < c.offset)
                        return undefined;
                    return fragment(a, offset);
                }
            }
        };
        /**
         * Takes the given `assembly`, splits its full contents into fragments
         * based on the given `splitType`, then converts them into insertion
         * positions valid for `direction`.
         *
         * The positions are yielded from the given `cursor` toward the given
         * `direction`.
         *
         * Refer to the examples below to see the positions under a few different
         * circumstances.
         *
         * From top to bottom:
         * > [0]One sentence.  [1]Two sentence.  [2]This is another sentence.
         *   [3]Three sentence.  [4]Four sentence.
         *
         * From bottom to top:
         * > [-6]One sentence.  [-5]Two sentence.  [-4]This is another sentence.
         *   [-3]Three sentence.  [-2]Four sentence.[-1]
         *
         * Relative to the match `"another"`:
         * > [-4]One sentence.  [-3]Two sentence.  [-2]This is [-1]another[0]
         *   sentence.  [1]Three sentence.  [2]Four sentence.
         */
        const positionsFrom = (
        /** The assembly to query. */
        assembly, 
        /** The cursor that will identify the starting fragment. */
        cursor, 
        /** The type of splitting to perform. */
        splitType, 
        /** Which direction `fragments` is iterating. */
        direction) => {
            // Do the work splitting everything up.
            const splitUp = splitToSelections(assembly, splitType, direction, cursor);
            // Prepare the functions used by this option.
            const fns = forDir[direction];
            const handleNewlines = fns.handleNewlines;
            const toCursor = fns.toPosition(assembly, cursor);
            // There's really only three positions we care about for this process.
            // - The position before a fragment containing words.
            // - The zero-length position between two `\n` characters.
            // The position defined by the given cursor is handled by `locateInsertion`.
            return chain(splitUp)
                // Group consecutive `\n` characters together.
                .thru((iter) => batch(iter, lineBatcher))
                // Sort out and handle the `\n` batches from the normal fragments...
                .thru(handleNewlines)
                // Now apply this partial function to get our cursors...
                .collect(toCursor)
                .value();
        };
        return Object.assign(exports, {
            positionsFrom
        });
    });

    var $EntryPosition = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        const queryOps = $QueryOps(require);
        const { positionsFrom } = $PositionsFrom(require);
        /**
         * Gets a cursor for entering this assembly during iteration.
         */
        const entryPosition = (
        /** The assembly to query. */
        assembly, 
        /** Which direction to iterate. */
        direction, 
        /**
         * The type of insertion to be done.
         *
         * This may be omitted to produce a cursor:
         * - at the beginning of the assembly if `direction` is `"toBottom"`.
         * - at the end of the assembly if `direction` is `"toTop"`.
         *
         * When provided, it will provide a position valid for the
         * insertion type:
         * - the earliest possible position if `direction` is `"toBottom"`.
         * - the latest possible position if `direction` is `"toTop"`.
         *
         * If there is no valid position, it will return the same value as
         * though it were omitted; this will be the case if the assembly is
         * empty.  It should be the prefix or suffix, doing their job as
         * positional anchors.
         */
        insertionType) => {
            if (insertionType) {
                const initCursor = entryPosition(assembly, direction);
                const c = [...positionsFrom(assembly, initCursor, insertionType, direction)];
                return first(c) ?? initCursor;
            }
            else if (direction === "toTop") {
                const frag = queryOps.getLastFragment(assembly) ?? assembly.prefix;
                return fragment(assembly, ss.afterFragment(frag));
            }
            else {
                const frag = queryOps.getFirstFragment(assembly) ?? assembly.suffix;
                return fragment(assembly, ss.beforeFragment(frag));
            }
        };
        return Object.assign(exports, {
            entryPosition
        });
    });

    var $LocateInsertion = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        const queryOps = $QueryOps(require);
        const cursorOps = $CursorOps(require);
        const { positionsFrom } = $PositionsFrom(require);
        /**
         * Handles some edge-cases regarding the insertion position indicated
         * by a cursor.
         */
        const fixCursor = (
        /** The assembly of the cursor. */
        assembly, 
        /** The cursor to check. */
        cursor) => {
            // If the cursor is on the outer boundary of the assembly, then
            // we need to insert before or after the assembly.
            const firstFrag = queryOps.getFirstFragment(assembly);
            if (firstFrag && cursor.offset <= ss.beforeFragment(firstFrag))
                return { type: "insertBefore", shunted: 0 };
            const lastFrag = queryOps.getLastFragment(assembly);
            if (lastFrag && cursor.offset >= ss.afterFragment(lastFrag))
                return { type: "insertAfter", shunted: 0 };
            // We're not going to split on the prefix or suffix, just to avoid
            // the complexity of it, so we need to check where we are.
            switch (cursorOps.positionOf(assembly, cursor)) {
                // This is the best case; everything is just fine, but this
                // fragment will need to be split.
                case "content": return { type: "inside", cursor };
                // This tells it to insert before this fragment.
                case "prefix": return {
                    type: "insertBefore",
                    shunted: cursor.offset - ss.beforeFragment(assembly.prefix)
                };
                // And this after this fragment.
                case "suffix": return {
                    type: "insertAfter",
                    shunted: ss.afterFragment(assembly.suffix) - cursor.offset
                };
                default: throw new Error("Unexpected position.");
            }
        };
        /**
         * Locates a position relative to the given `position`.
         *
         * This is intended to be used during the insertion phase to find
         * a key-relative position to split an assembly at to insert another
         * entry in the middle of it.
         *
         * It will not provide cursors inside of the prefix or suffix, as
         * I did not want to deal with the added complexity of splitting
         * on those fragments.
         *
         * If you get a result where `remainder === 0`, that is an indication
         * to place the entry immediately before or after this assembly.
         */
        const locateInsertion = (
        /** The assembly to query. */
        assembly, 
        /** The type of insertion being done. */
        insertionType, 
        /** An object describing how to locate the insertion. */
        positionData) => {
            const { cursor: initCursor, direction, offset } = positionData;
            assert("Expected `offset` to be a positive number.", offset >= 0);
            // Fast-path: If this assembly is empty, tell it to carry on.
            if (queryOps.isEmpty(assembly))
                return { type: direction, remainder: offset };
            // Fast-path: If we're given an offset of 0, we don't need to move
            // the cursor at all.
            if (offset === 0)
                return fixCursor(assembly, initCursor);
            const result = dew(() => {
                // Tracks how many elements we still need to pass.
                let remainder = offset;
                const cursors = chain(positionsFrom(assembly, initCursor, insertionType, direction))
                    // ...but if we find the initial cursor, skip it...
                    .pipe(skipUntil, (c) => c.offset !== initCursor.offset)
                    // ...because we're adding it into the first position here.
                    .prependVal(initCursor)
                    .value();
                for (const cursor of cursors) {
                    if (remainder <= 0)
                        return cursor;
                    remainder -= 1;
                }
                // If we get here, we couldn't find a good fragment within the assembly.
                return remainder;
            });
            // If we got a remainder, we tell it to carry on.
            if (isNumber(result))
                return { type: direction, remainder: result };
            return fixCursor(assembly, result);
        };
        return Object.assign(exports, {
            locateInsertion
        });
    });

    var $ShuntOut = usModule((require, exports) => {
        const queryOps = $QueryOps(require);
        const cursorOps = $CursorOps(require);
        /**
         * When we have a cursor inside this assembly, but we can't split it
         * due to the entry's configuration, this will tell us the nearest side
         * to insert it adjacent to this assembly.
         *
         * If the cursor could go either way, it will favor toward the top.
         */
        const shuntOut = (
        /** The assembly to work with. */
        assembly, 
        /** The cursor defining the location we're being shunt from. */
        cursor, 
        /** The shunt mode to use. */
        mode = "nearest") => {
            // We actually want to convert this to a full-text cursor, as it
            // simplifies a lot of this.
            const { offset } = cursorOps.toFullText(assembly, cursor);
            const fullLength = queryOps.getText(assembly).length;
            const type = mode === "toTop" ? "insertBefore"
                : mode === "toBottom" ? "insertAfter"
                    : offset <= fullLength / 2 ? "insertBefore" : "insertAfter";
            const shunted = type === "insertBefore" ? offset : fullLength - offset;
            return { type, shunted };
        };
        return Object.assign(exports, {
            shuntOut
        });
    });

    /**
     * Module related to locating insertion positions on `IFragmentAssembly`.
     */
    var $PositionOps = usModule((require, exports) => {
        return Object.assign(exports, {
            cursorForDir,
            ...$EntryPosition(require),
            ...$LocateInsertion(require),
            ...$PositionsFrom(require),
            ...$ShuntOut(require),
            ...$SplitToSelections(require)
        });
    });

    /**
     * The amount of tokens used for mending when the split occurs inside
     * a single token.  (`5` is a bit overkill, but most of the performance
     * hit is from marshalling the background worker, anyways.)
     */
    const TOKEN_MENDING_RANGE = 5;
    /** Just an immutable, empty tokens array. */
    const EMPTY_TOKENS$1 = Object.freeze([]);
    /**
     * Splits an array of `tokens` into two.
     *
     * The `offset` is in characters relative to the string decoded from
     * `tokens`.
     */
    async function getTokensForSplit(
    /** The token codec to use. */
    codec, 
    /** The offset of characters to split at. */
    offset, 
    /** The tokens array to split. */
    tokens, 
    /**
     * If available, the decoded text.  If not provided, the text will
     * be decoded from the tokens, which takes a small performance hit.
     */
    decodedText) {
        // Fast-path: This is the only case we will allow for an empty split.
        // Naturally, you probably should not even bother.
        if (tokens.length === 0 && offset === 0)
            return [EMPTY_TOKENS$1, EMPTY_TOKENS$1];
        const result = assertExists("Expected to locate the offset in the tokens.", await codec.findOffset(tokens, offset, decodedText));
        switch (result.type) {
            // Easy cases; one is empty and the other is our given tokens.
            case "before": return [EMPTY_TOKENS$1, tokens];
            case "after": return [tokens, EMPTY_TOKENS$1];
            // We don't need to do anything special in this case because the
            // cursor falls between two sets of tokens.
            case "double": {
                const index = result.max.index;
                return [
                    tokens.slice(0, index),
                    tokens.slice(index)
                ];
            }
            // In this case, we're splitting a single token into two parts,
            // which means we will need two new tokens, and the ends at the
            // cut could even encode differently.
            case "single": {
                const splitToken = result.data.value;
                const left = splitToken.slice(0, result.remainder);
                const right = splitToken.slice(result.remainder);
                const index = result.data.index;
                return Promise.all([
                    codec.mendTokens([tokens.slice(0, index), left], TOKEN_MENDING_RANGE),
                    codec.mendTokens([right, tokens.slice(index + 1)], TOKEN_MENDING_RANGE)
                ]);
            }
            // @ts-ignore - We'll want to know if this happens.
            default: throw new Error(`Unexpected result type: ${result.type}`);
        }
    }

    var $SplitAt = usModule((require, exports) => {
        const cursorOps = $CursorOps(require);
        const manipOps = $ManipOps(require);
        /**
         * Given a cursor placed within this assembly's content, splits this
         * assembly into two assemblies.  The result is a tuple where the
         * first element is the text before the cut and the second element
         * is the text after the cut.
         *
         * The `suffix` of the first assembly and the `prefix` of the second
         * assembly will be empty, and so may differ from their shared source.
         *
         * If a cut cannot be made, `undefined` is returned.
         *
         * This version handles the `tokens` of the assembly as well.
         */
        const splitAt = async (
        /** The assembly to split. */
        assembly, 
        /** The token codec to use. */
        tokenCodec, 
        /**
         * The cursor demarking the position of the cut.
         *
         * Must be a cursor within the assembly's content.
         */
        cursor) => {
            const result = manipOps.splitAt(assembly, cursor);
            if (!result)
                return undefined;
            const [beforeTokens, afterTokens] = await getTokensForSplit(tokenCodec, cursorOps.toFullText(assembly, result.cursor).offset, assembly.tokens, getText(assembly));
            return {
                assemblies: [
                    protoExtend(result.assemblies[0], { tokens: beforeTokens }),
                    protoExtend(result.assemblies[1], { tokens: afterTokens })
                ],
                cursor: result.cursor
            };
        };
        return Object.assign(exports, {
            splitAt
        });
    });

    const NO_TOKENS = Object.freeze({ tokens: Object.freeze([]) });
    var $RemoveAffix = usModule((require, exports) => {
        const ss = $TextSplitterService(require);
        const manipOps = $ManipOps(require);
        const queryOps = $QueryOps(require);
        const { splitAt } = $SplitAt(require);
        const removePrefix = async (assembly, tokenCodec) => {
            if (!assembly.prefix.content)
                return assembly;
            // This needs to be a cursor on the content, so the position
            // after the prefix is the one before the first content fragment.
            const offset = ss.beforeFragment(first(assembly.content));
            const cursor = fragment(assembly, offset);
            const { assemblies } = assertExists("Expected to split after the prefix.", await splitAt(assembly, tokenCodec, cursor));
            // We want the part after the cursor.
            return assemblies[1];
        };
        const removeSuffix = async (assembly, tokenCodec) => {
            if (!assembly.suffix.content)
                return assembly;
            // This needs to be a cursor on the content, so the position
            // before the suffix is the one after the last content fragment.
            const offset = ss.afterFragment(last(assembly.content));
            const cursor = fragment(assembly, offset);
            const { assemblies } = assertExists("Expected to split before the suffix.", await splitAt(assembly, tokenCodec, cursor));
            // We want the part before the cursor.
            return assemblies[0];
        };
        /**
         * Generates a version of the given assembly that has no prefix or suffix.
         *
         * It still has the same source, so cursors for that source will still
         * work as expected.
         *
         * This version handles the `tokens` of the assembly as well.
         */
        const removeAffix = async (
        /** The assembly to manipulate. */
        assembly, 
        /** The token codec to use. */
        tokenCodec) => {
            // No need if we don't have a prefix or suffix.
            if (!queryOps.isAffixed(assembly))
                return assembly;
            // If we have no content, we'll end up with an empty assembly.
            if (isEmpty$1(assembly.content))
                return protoExtend(manipOps.removeAffix(assembly), NO_TOKENS);
            // This can basically be considered two splits: one after the prefix,
            // and one before the suffix.  We'll isolate these into their own helpers.
            assembly = await removePrefix(assembly, tokenCodec);
            return await removeSuffix(assembly, tokenCodec);
        };
        return Object.assign(exports, {
            removeAffix
        });
    });

    /**
     * Module related to manipulating `ITokenizedAssembly`.
     */
    var $TokenOps = usModule((require, exports) => {
        return Object.assign(exports, {
            getTokensForSplit,
            ...$RemoveAffix(require),
            ...$SplitAt(require)
        });
    });

    const theModule$5 = usModule((require, exports) => {
        var _TokenizedAssembly_tokens, _TokenizedAssembly_codec;
        const ss = $TextSplitterService(require);
        const cursorOps = $CursorOps(require);
        const manipOps = $ManipOps(require);
        const posOps = $PositionOps(require);
        const queryOps = $QueryOps(require);
        const tokenOps = $TokenOps(require);
        const { BaseAssembly } = theModule$7(require);
        const fragAssembly = theModule$6(require);
        /**
         * A class fitting {@link IFragmentAssembly} that provides caching facilities
         * and convenient access to the limited set of operators used for context
         * content sourcing.
         *
         * It essentially acts as a wrapper around a plain-object assembly.
         */
        class TokenizedAssembly extends BaseAssembly {
            constructor(wrapped, codec, isContiguous) {
                super(wrapped, isContiguous);
                _TokenizedAssembly_tokens.set(this, void 0);
                _TokenizedAssembly_codec.set(this, void 0);
                __classPrivateFieldSet(this, _TokenizedAssembly_tokens, toImmutable(wrapped.tokens), "f");
                __classPrivateFieldSet(this, _TokenizedAssembly_codec, codec, "f");
            }
            /**
             * The array of tokens for the assembly, built from the concatenation
             * of `prefix`, `content`, and `suffix`.
             */
            get tokens() {
                return __classPrivateFieldGet(this, _TokenizedAssembly_tokens, "f");
            }
            /** The codec we're using for manipulation. */
            get codec() {
                return __classPrivateFieldGet(this, _TokenizedAssembly_codec, "f");
            }
            /** Bound version of {@link queryOps.checkRelated}. */
            isRelatedTo(other) {
                return queryOps.checkRelated(this, other);
            }
            /** Bound version of {@link cursorOps.isFoundIn}. */
            isFoundIn(cursor) {
                return cursorOps.isFoundIn(this, cursor);
            }
            /** Bound version of {@link cursorOps.findBest}. */
            findBest(cursor) {
                return cursorOps.findBest(this, cursor);
            }
            /** Bound version of {@link posOps.entryPosition}. */
            entryPosition(
            /** Which direction to iterate. */
            direction, 
            /** The type of insertion to be done. */
            insertionType) {
                return posOps.entryPosition(this, direction, insertionType);
            }
            /** Bound version of {@link posOps.locateInsertion}. */
            locateInsertion(
            /** The type of insertion being done. */
            insertionType, 
            /** An object describing how to locate the insertion. */
            positionData) {
                return posOps.locateInsertion(this, insertionType, positionData);
            }
            /** Bound version of {@link posOps.shuntOut}. */
            shuntOut(
            /** The cursor defining the location we're being shunt from. */
            cursor, 
            /** The shunt mode to use. */
            mode) {
                return posOps.shuntOut(this, cursor, mode);
            }
            /** Bound version of {@link tokenOps.splitAt}. */
            async splitAt(
            /** The cursor demarking the position of the cut. */
            cursor) {
                const result = await tokenOps.splitAt(this, __classPrivateFieldGet(this, _TokenizedAssembly_codec, "f"), cursor);
                return result?.assemblies.map((a) => {
                    return new TokenizedAssembly(a, __classPrivateFieldGet(this, _TokenizedAssembly_codec, "f"), this.isContiguous);
                });
            }
            /** Bound version of {@link tokenOps.removeAffix}. */
            async asOnlyContent() {
                const result = await tokenOps.removeAffix(this, __classPrivateFieldGet(this, _TokenizedAssembly_codec, "f"));
                // If we're already only-content, `removeAffix` will return its input.
                if (result === this)
                    return this;
                return new TokenizedAssembly(result, __classPrivateFieldGet(this, _TokenizedAssembly_codec, "f"), this.isContiguous);
            }
        }
        _TokenizedAssembly_tokens = new WeakMap(), _TokenizedAssembly_codec = new WeakMap();
        /**
         * Checks if the given `assembly` is a {@link TokenizedAssembly}.
         *
         * Specifically, the class; it may still be an object that fits the
         * interface, but it's not a {@link TokenizedAssembly}.
         */
        function isInstance(assembly) {
            return assembly instanceof TokenizedAssembly;
        }
        /** Helper to ensure we have tokens on the assembly. */
        async function asRootAssembly(tokenCodec, assembly, tokens) {
            tokens = tokens ?? await dew(() => {
                if ("tokens" in assembly)
                    return assembly.tokens;
                return tokenCodec.encode(queryOps.getText(assembly));
            });
            return protoExtend(manipOps.makeSafe(assembly), { tokens });
        }
        /**
         * Converts the given assembly into a {@link TokenizedAssembly}.
         *
         * A token codec is required, in case a conversion needs to be made;
         * the assembly's text will need to be encoded.
         *
         * Warning: This will not defragment the contents of the assembly.
         */
        async function castTo(
        /** The token codec to use when a conversion is needed. */
        tokenCodec, 
        /** The assembly to cast. */
        assembly) {
            if (isInstance(assembly))
                return assembly;
            return new TokenizedAssembly(await asRootAssembly(tokenCodec, assembly), tokenCodec, queryOps.isContiguous(assembly));
        }
        /**
         * Creates a new assembly derived from the given `originAssembly`.  The given
         * `fragments` should have originated from the origin assembly's
         * {@link IFragmentAssembly.content content}.
         *
         * If `fragments` contains the origin's `prefix` and `suffix`, they are
         * filtered out automatically.  This is because `FragmentAssembly` is itself
         * an `Iterable<TextFragment>` and sometimes you just wanna apply a simple
         * transformation on its fragments, like a filter.
         */
        async function fromDerived(
        /** The fragments making up the derivative's content. */
        fragments, 
        /**
         * The assembly whose fragments were used to make the given fragments.
         * This assembly does not need to be a source assembly.
         */
        originAssembly, 
        /** The options for creating a derived assembly. */
        options) {
            // Fast path: the underlying data of `FragmentAssembly` is immutable, so if
            // we're given one, just spit it right back out.
            if (isInstance(fragments)) {
                // But make sure we're still internally consistent.
                assert("Expected the assembly to be related to `originAssembly`.", queryOps.checkRelated(fragments, originAssembly));
                assert("Expected the assembly to have identical tokens.", dew(() => {
                    const gTokens = options?.tokens;
                    if (!gTokens)
                        return true;
                    const aTokens = fragments.tokens;
                    if (aTokens === gTokens)
                        return true;
                    if (aTokens.length !== gTokens.length)
                        return false;
                    for (let i = 0; i < aTokens.length; i++)
                        if (aTokens[i] !== gTokens[i])
                            return false;
                    return true;
                }));
                return fragments;
            }
            const tokenCodec = dew(() => {
                if (isInstance(originAssembly))
                    return originAssembly.codec;
                return assertExists("A codec is required unless deriving from a tokenized assembly.", options?.codec);
            });
            const isContiguous = dew(() => {
                // Our assumption is the derived assembly has the same continuity as
                // its origin assembly.
                if (!options?.assumeContinuity)
                    return queryOps.isContiguous(originAssembly);
                // Otherwise, we check off the content.
                return ss.isContiguous(theRoot.content);
            });
            // Being lazy; this will do all the checks we want done.
            const theRoot = await asRootAssembly(tokenCodec, fragAssembly.fromDerived(fragments, originAssembly, {
                assumeContinuity: true
            }), options?.tokens);
            return new TokenizedAssembly(theRoot, tokenCodec, isContiguous);
        }
        return Object.assign(exports, {
            isInstance,
            castTo,
            fromDerived
        });
    });

    /**
     * Provides services for trimming content to fit a budget.
     *
     * The functions provided here act as the "small, simple" entry-point into
     * this "big, dumb" trimming process.
     */
    const EMPTY = async function* () { };
    var $TrimmingService = usModule((require, exports) => {
        const providers = $TrimmingProviders(require);
        const { hasWords, asEmptyFragment } = $TextSplitterService(require);
        const { appendEncoder } = $TokenizerService(require);
        const fragAssembly = theModule$6(require);
        const tokenAssembly = theModule$5(require);
        const optionDefaults = {
            provider: "doNotTrim",
            maximumTrimType: "token",
            preserveMode: "both"
        };
        /** Constructs a result, with an assembly, from the given parameters. */
        const makeTrimResult = async (origin, encodeResult, split, codec) => {
            const { fragments, tokens } = encodeResult;
            assert("Expected at least one text fragment.", fragments.length > 0);
            const assembly = await tokenAssembly.fromDerived(fragments, origin, { codec, tokens });
            return Object.freeze({ assembly, split });
        };
        /** Constructs an empty result, a special case. */
        const makeEmptyResult = async (origin, codec) => {
            const assembly = await tokenAssembly.castTo(codec, {
                source: origin,
                prefix: asEmptyFragment(origin.prefix),
                content: [],
                suffix: asEmptyFragment(origin.suffix),
                tokens: []
            });
            return Object.freeze({ assembly, split: EMPTY });
        };
        /** Fixes the preserve mode in case of reverse iteration. */
        const fixPreserveMode = (provider, preserveMode) => {
            if (!provider.reversed)
                return preserveMode;
            switch (preserveMode) {
                case "leading": return "trailing";
                case "trailing": return "leading";
                default: return preserveMode;
            }
        };
        /**
         * Private function that handles preparations for trimming.  It applies
         * the sequencer with the given ending preservation mode, splitting up
         * the fragments, and determines what preservation mode to use for the
         * next sequencer.
         */
        const sequenceFrags = (content, sequencer, preserveMode) => {
            const nextMode = preserveMode === "both" ? "both"
                : preserveMode === "trailing" ? "both"
                    // Use "leading" for "none" on recursion.
                    : "leading";
            const splitFrags = flatMap(content, sequencer.splitUp);
            switch (preserveMode) {
                case "both": return [splitFrags, nextMode];
                case "leading": return [flatten(buffer(splitFrags, hasWords, false)), nextMode];
                case "trailing": return [skipUntil(splitFrags, hasWords), nextMode];
                default: return [journey(splitFrags, hasWords), nextMode];
            }
        };
        // Actual implementation.
        function createTrimmer(assembly, contextParams, options, doReplay = false) {
            const { tokenCodec } = contextParams;
            const config = { ...optionDefaults, ...options };
            const provider = providers.asProvider(config.provider);
            if (provider.noSequencing) {
                // When we're not sequencing, we'll just run the append encoder
                // directly and immediately encode all the fragments.  We could
                // potentially just use `tokenCodec.encode` instead, but I would
                // prefer to keep things consistent.
                async function* unSequenced() {
                    const encoding = appendEncoder(tokenCodec, provider.preProcess(assembly), {
                        prefix: assembly.prefix.content,
                        suffix: assembly.suffix.content
                    });
                    const result = await lastValueOrUndef(encoding);
                    // Undefined with `lastValueOrUndef` means the assembly was or became
                    // empty (such as due to comment removal).  Indicate this by yielding
                    // only an entirely empty result.
                    if (!result) {
                        yield await makeEmptyResult(assembly, tokenCodec);
                        return;
                    }
                    yield await makeTrimResult(assembly, result, EMPTY, tokenCodec);
                }
                return Object.assign(doReplay ? toReplay(unSequenced) : unSequenced, { origin: assembly, provider });
            }
            const sequencers = providers.getSequencersFrom(provider, config.maximumTrimType);
            const nextSplit = (content, sequencers, preserveMode, seedResult) => {
                if (sequencers.length === 0)
                    return EMPTY;
                const [sequencer, ...restSequencers] = sequencers;
                return async function* () {
                    const [fragments, nextMode] = sequenceFrags(content, sequencer, preserveMode);
                    const encoding = sequencer.encode(tokenCodec, fragments, {
                        prefix: assembly.prefix.content,
                        suffix: assembly.suffix.content,
                        seedResult
                    });
                    let lastResult = seedResult;
                    for await (const curResult of encoding) {
                        const innerSplit = nextSplit(sequencer.prepareInnerChunk(curResult, lastResult), restSequencers, nextMode, lastResult);
                        yield await makeTrimResult(assembly, curResult, doReplay ? toReplay(innerSplit) : innerSplit, tokenCodec);
                        lastResult = curResult;
                    }
                    // If the trimmer never yields anything and we're still on the first
                    // sequencer (as evidenced by having no seed result), it had nothing
                    // to actually encode, which means the origin assembly is or became
                    // empty (like due to comment removal).  We'll indicate this by
                    // yielding an entirely empty result.
                    if (!lastResult && !seedResult)
                        yield await makeEmptyResult(assembly, tokenCodec);
                };
            };
            const outerSplit = nextSplit(provider.preProcess(assembly), sequencers, fixPreserveMode(provider, config.preserveMode));
            return Object.assign(doReplay ? toReplay(outerSplit) : outerSplit, { origin: assembly, provider });
        }
        /**
         * Executes the given `trimmer`, searching for a result that is below the
         * given `tokenBudget`.
         */
        async function execTrimTokens(trimmer, tokenBudget) {
            // Ensue the budget is valid.
            tokenBudget = Math.max(0, tokenBudget);
            /** The current iterator; we'll change this when we split. */
            let iterable = trimmer();
            /** The last in-budget result. */
            let lastResult = undefined;
            trimLoop: while (iterable) {
                for await (const curResult of iterable) {
                    if (curResult.assembly.tokens.length <= tokenBudget) {
                        lastResult = curResult;
                        continue;
                    }
                    // We've busted the budget.  We can simply attempt to split into
                    // the current result.  If it yields something, this loop may
                    // continue.  If not, we'll end it here.
                    iterable = curResult.split();
                    continue trimLoop;
                }
                // If we get here, everything in the iterable fit in the budget.
                iterable = undefined;
            }
            return lastResult?.assembly;
        }
        /**
         * Trims the given `content` so it fits within a certain `tokenBudget`.
         * Provide options to tailor the trimming to your needs.
         *
         * Returns `undefined` if the content could not be trimmed to fit the
         * desired budget with the given constraints.
         *
         * This function creates a new {@link Trimmer} on the fly.  If you have a
         * {@link ReplayTrimmer} for this content already, call {@link execTrimTokens}
         * directly and pass it in to avoid repeat work.
         */
        async function trimByTokens(
        /** The content to trim. */
        assembly, 
        /** The token budget. */
        tokenBudget, 
        /** The context parameters object. */
        contextParams, 
        /** Trimming options. */
        options) {
            // Create a single-use trimmer and execute.
            const trimmer = createTrimmer(assembly, contextParams, options);
            return await execTrimTokens(trimmer, tokenBudget);
        }
        function* execTrimLength(sequencers, content, maximumLength, preserveMode, currentLength = 0) {
            // If we have no sequencers left, end recursion.
            if (!sequencers.length)
                return;
            // Split the current sequencer from the rest.
            const [sequencer, ...restSequencers] = sequencers;
            // Split up those fragments.
            const [fragments, nextMode] = sequenceFrags(content, sequencer, preserveMode);
            for (const buffered of buffer(fragments, hasWords)) {
                const contentLength = buffered.reduce((p, c) => p + c.content.length, 0);
                const nextLength = currentLength + contentLength;
                if (nextLength <= maximumLength) {
                    currentLength = nextLength;
                    yield* buffered;
                }
                else {
                    // Reverse the buffer if the sequencer is reversed.
                    if (sequencer.reversed)
                        buffered.reverse();
                    yield* execTrimLength(restSequencers, buffered, maximumLength, nextMode, currentLength);
                    return;
                }
            }
        }
        /**
         * Trims the given `content` so it is below a certain `maximumLength`.
         * Provide options to tailor the trimming to your needs.
         *
         * Returns `undefined` if the content could not be trimmed to the desired
         * length with the given constraints.
         *
         * If the {@link TrimOptions.prefix prefix} or {@link TrimOptions.suffix suffix}
         * options are provided, their length will be subtracted from `maximumLength`
         * prior to performing the trim.
         */
        function trimByLength(assembly, maximumLength, options) {
            const { preserveMode, provider: srcProvider, maximumTrimType } = { ...optionDefaults, ...options };
            const provider = providers.asProvider(srcProvider);
            const fragments = provider.preProcess(assembly);
            const prefixLength = assembly.prefix.content.length;
            const suffixLength = assembly.suffix.content.length;
            maximumLength = Math.max(0, maximumLength - (prefixLength + suffixLength));
            // Now we can trim.
            if (provider.noSequencing) {
                // If we can't use sequencing, we'll just concatenate the all
                // the fragments and check if it's below the `maximumLength`.
                // Start by making a copy of our fragments; we'll need a stable
                // iterable for this.
                const theFrags = [...fragments];
                const totalLength = reduceIter(theFrags, 0, (acc, frag) => frag.content.length + acc);
                if (totalLength > maximumLength)
                    return undefined;
                // Un-reverse if the provider runs in reverse.
                if (provider.reversed)
                    theFrags.reverse();
                // We should still create a derived assembly, as the pre-processor
                // could have altered the fragments.
                return fragAssembly.fromDerived(theFrags, assembly);
            }
            // Otherwise, we do our thorough trim.
            const sequencers = providers.getSequencersFrom(provider, maximumTrimType);
            const trimmedFrags = [...execTrimLength(sequencers, fragments, maximumLength, fixPreserveMode(provider, preserveMode))];
            if (trimmedFrags.length === 0)
                return undefined;
            // Un-reverse if the provider runs in reverse.
            if (provider.reversed)
                trimmedFrags.reverse();
            return fragAssembly.fromDerived(trimmedFrags, assembly);
        }
        return Object.assign(exports, {
            createTrimmer,
            execTrimTokens,
            trimByTokens,
            trimByLength
        });
    });

    /**
     * This module has the abstraction for any kind of content for a
     * context.  Notably, this is where the methods that setup the
     * story and lorebook content live.
     */
    const reComment = /^##/m;
    const theModule$4 = usModule((require, exports) => {
        var _ContextContent_instances, _ContextContent_uniqueId, _ContextContent_field, _ContextContent_fieldConfig, _ContextContent_contextConfig, _ContextContent_trimmer, _ContextContent_searchText, _ContextContent_maxTokenCount, _ContextContent_budgetStats, _ContextContent_initialBudget, _ContextContent_reservedTokens, _ContextContent_currentBudget, _ContextContent_otherWorkers, _ContextContent_currentResult, _ContextContent_doWork;
        const uuid = require(UUID$1);
        const eventModule = require(EventModule$1);
        const { ContextField } = require(ContextModule$1);
        const providers = $TrimmingProviders(require);
        const cursorOps = $CursorOps(require);
        const queryOps = $QueryOps(require);
        const { createTrimmer, execTrimTokens, trimByLength } = $TrimmingService(require);
        const assembly = theModule$6(require);
        const getBudget = ({ tokenBudget }, contextParams) => {
            // Invalid values default to `contextSize`.
            if (!isNumber(tokenBudget))
                return contextParams.contextSize;
            if (tokenBudget <= 0)
                return contextParams.contextSize;
            // 1 or more is converted into an integer, if needed.
            if (tokenBudget >= 1)
                return tokenBudget | 0;
            // Values less than 1 are scaled by the context size.
            return (tokenBudget * contextParams.contextSize) | 0;
        };
        const getReservation = ({ reservedTokens }, contextParams) => {
            // Invalid values default to `0`.
            if (!isNumber(reservedTokens))
                return 0;
            if (reservedTokens <= 0)
                return 0;
            // 1 or more is converted into an integer, if needed.
            if (reservedTokens >= 1)
                return reservedTokens | 0;
            // Values less than 1 are scaled by the context size.
            return (reservedTokens * contextParams.contextSize) | 0;
        };
        /**
         * Gets the provider, given the needs of the provider and the configuration.
         */
        const getProvider = (forSearch, trimDirection) => {
            if (forSearch && config$1.activation.searchComments)
                return providers.basic[trimDirection];
            return providers.removeComments[trimDirection];
        };
        /**
         * Does the nasty business of getting the {@link Assembly.Fragment} that will
         * be used for keyword searching.
         */
        const getSearchAssembly = dew(() => {
            const _forStory = async (trimmer, contextConfig, contextParams) => {
                // For the story, we will always need to trim it to size.  What varies
                // is whether we trim by tokens or length.  We also need to sort out
                // whether to remove comments or not.
                if (contextParams.storyLength > 0) {
                    const { trimDirection, maximumTrimType } = contextConfig;
                    const provider = getProvider(true, trimDirection);
                    const trimConfig = { provider, maximumTrimType, preserveEnds: true };
                    const result = trimByLength(trimmer.origin, contextParams.storyLength, trimConfig);
                    if (result)
                        return result;
                    // Fallback to an empty story block.
                    return assembly.fromDerived([], trimmer.origin);
                }
                const innerTrimmer = dew(() => {
                    const { trimDirection, maximumTrimType } = contextConfig;
                    const provider = getProvider(true, trimDirection);
                    // We can re-use the current trimmer.
                    if (trimmer.provider === provider)
                        return trimmer;
                    // We need a different trimmer.
                    return createTrimmer(trimmer.origin, contextParams, { provider, maximumTrimType, preserveMode: "trailing" }, false);
                });
                const result = await execTrimTokens(innerTrimmer, contextParams.contextSize);
                if (result)
                    return result;
                // Fallback to an empty story block.
                return assembly.fromDerived([], trimmer.origin);
            };
            const _forLore = (trimmer, contextParams) => {
                const origin = trimmer.origin;
                // The trimmer has the unmodified origin assembly.  We only need to
                // change things up if we need to remove comments for search.
                if (!reComment.test(queryOps.getContentText(origin)))
                    return origin;
                const provider = getProvider(true, "doNotTrim");
                // The do-not-trim provider does all its work in `preProcess`.
                const fragments = provider.preProcess(origin);
                // If we get the `content` reference back, we removed nothing.
                if (fragments === origin.content)
                    return origin;
                return assembly.fromDerived(fragments, origin);
            };
            return async (forStory, trimmer, contextConfig, contextParams) => {
                const result = forStory ? await _forStory(trimmer, contextConfig, contextParams)
                    : _forLore(trimmer);
                const keepAffix = !forStory ? true : config$1.story.standardizeHandling;
                return keepAffix ? result : await result.asOnlyContent();
            };
        });
        /**
         * This abstraction deals with the internal management of trimming and
         * budgeting for a single entry's content.
         *
         * It also manages some of the normalization options in the user-script
         * configuration.
         */
        class ContextContent {
            constructor(origField, searchText, trimmer, contextParams) {
                _ContextContent_instances.add(this);
                _ContextContent_uniqueId.set(this, void 0);
                _ContextContent_field.set(this, void 0);
                _ContextContent_fieldConfig.set(this, void 0);
                _ContextContent_contextConfig.set(this, void 0);
                _ContextContent_trimmer.set(this, void 0);
                _ContextContent_searchText.set(this, void 0);
                /** Storage for the maximum token count allowed by the budget. */
                _ContextContent_maxTokenCount.set(this, void 0);
                /** Storage for the normalized budgeting stats. */
                _ContextContent_budgetStats.set(this, void 0);
                /** Configured token budget. */
                _ContextContent_initialBudget.set(this, void 0);
                /** Configured token reservation. */
                _ContextContent_reservedTokens.set(this, void 0);
                /** Current token budget; this is stateful. */
                _ContextContent_currentBudget.set(this, void 0);
                /** Other promises end up here. */
                _ContextContent_otherWorkers.set(this, void 0);
                /** Current trim results of the current budget applied. */
                _ContextContent_currentResult.set(this, void 0);
                const { text, contextConfig, ...fieldConfig } = origField;
                __classPrivateFieldSet(this, _ContextContent_uniqueId, uuid.v4(), "f");
                __classPrivateFieldSet(this, _ContextContent_field, origField, "f");
                __classPrivateFieldSet(this, _ContextContent_fieldConfig, fieldConfig, "f");
                __classPrivateFieldSet(this, _ContextContent_contextConfig, contextConfig, "f");
                __classPrivateFieldSet(this, _ContextContent_searchText, searchText, "f");
                __classPrivateFieldSet(this, _ContextContent_trimmer, trimmer, "f");
                // Ensure the budget-related configs are integers.
                __classPrivateFieldSet(this, _ContextContent_initialBudget, getBudget(contextConfig, contextParams), "f");
                __classPrivateFieldSet(this, _ContextContent_reservedTokens, getReservation(contextConfig, contextParams), "f");
                __classPrivateFieldSet(this, _ContextContent_currentBudget, __classPrivateFieldGet(this, _ContextContent_initialBudget, "f"), "f");
                // Initial state for worker promises.
                __classPrivateFieldSet(this, _ContextContent_otherWorkers, new Set(), "f");
            }
            static async forField(field, contextParams) {
                const { text, contextConfig } = field;
                const { maximumTrimType, trimDirection } = contextConfig;
                const provider = getProvider(false, trimDirection);
                const trimmer = createTrimmer(assembly.fromSource(text, contextConfig), contextParams, { provider, maximumTrimType, preserveMode: "none" }, 
                // Token reservations are most likely to benefit from replay.
                contextConfig.reservedTokens > 0);
                const searchText = await getSearchAssembly(false, trimmer, contextConfig, contextParams);
                return new ContextContent(field, searchText, trimmer, contextParams);
            }
            static async forStory(contextParams) {
                const { storyState } = contextParams;
                const { storyContextConfig } = storyState.storyContent;
                const storyText = storyState.storyContent.getStoryText();
                const contextConfig = {
                    ...storyContextConfig,
                    // NovelAI has a hardcoded exception for the story.  We want to avoid
                    // setting to this object, though, so we'll make a copy.
                    allowInsertionInside: true
                };
                const { trimDirection, maximumTrimType } = contextConfig;
                const sourceText = dew(() => {
                    const ev = new eventModule.PreContextEvent(storyText);
                    const handled = storyState.handleEvent(ev);
                    return assembly.fromSource(handled.event.contextText, contextConfig);
                });
                const provider = getProvider(false, trimDirection);
                const trimmer = createTrimmer(sourceText, contextParams, { provider, maximumTrimType, preserveMode: "trailing" }, true);
                const searchText = await getSearchAssembly(true, trimmer, contextConfig, contextParams);
                const field = new ContextField(contextConfig, searchText.text);
                return new ContextContent(field, searchText, trimmer, contextParams);
            }
            /** The unique ID for this content. */
            get uniqueId() {
                return __classPrivateFieldGet(this, _ContextContent_uniqueId, "f");
            }
            /**
             * The original field used as the source.
             *
             * This is available for convenience, but you should favor `fieldConfig`
             * in most cases.  Under no circumstances should this object be mutated.
             */
            get field() {
                return __classPrivateFieldGet(this, _ContextContent_field, "f");
            }
            /** The raw text from the source. */
            get text() {
                return __classPrivateFieldGet(this, _ContextContent_field, "f").text;
            }
            /** The fragment assembly used for searching. */
            get searchedText() {
                return __classPrivateFieldGet(this, _ContextContent_searchText, "f");
            }
            /** The fragment assembly used for trimming/insertion. */
            get insertedText() {
                return __classPrivateFieldGet(this, _ContextContent_trimmer, "f").origin;
            }
            /**
             * The current token budget.
             *
             * This value is updated by calling {@link rebudget}.
             */
            get currentBudget() {
                return __classPrivateFieldGet(this, _ContextContent_currentBudget, "f");
            }
            /**
             * The trimmed content, at the current token budget.
             *
             * If this has not yet been calculated, this will begin that process.
             * If the promise resolves to `undefined`, the budget was too strict
             * and the content could not be trimmed using the configuration used
             * to construct the trimmer.
             */
            get trimmed() {
                return __classPrivateFieldGet(this, _ContextContent_currentResult, "f") ?? this.rebudget();
            }
            /** All additional properties that were on the context field. */
            get fieldConfig() {
                return __classPrivateFieldGet(this, _ContextContent_fieldConfig, "f");
            }
            /** The context configuration provided to the constructor. */
            get contextConfig() {
                return __classPrivateFieldGet(this, _ContextContent_contextConfig, "f");
            }
            /**
             * Indicates if the given cursor is in the search text but missing
             * from the inserted text.
             */
            isCursorLoose(cursor) {
                if (cursorOps.isFoundIn(this.insertedText, cursor))
                    return false;
                return cursorOps.isFoundIn(this.searchedText, cursor);
            }
            /** Gets stats related to this content's budget. */
            async getStats() {
                if (__classPrivateFieldGet(this, _ContextContent_budgetStats, "f"))
                    return __classPrivateFieldGet(this, _ContextContent_budgetStats, "f");
                const tokenBudget = __classPrivateFieldGet(this, _ContextContent_initialBudget, "f");
                const reservedTokens = __classPrivateFieldGet(this, _ContextContent_reservedTokens, "f");
                checks: {
                    // Fast-path: we don't need to trim when not reserving.
                    if (reservedTokens === 0)
                        break checks;
                    const trimBudget = Math.min(tokenBudget, reservedTokens);
                    const result = await __classPrivateFieldGet(this, _ContextContent_instances, "m", _ContextContent_doWork).call(this, () => execTrimTokens(__classPrivateFieldGet(this, _ContextContent_trimmer, "f"), trimBudget));
                    // Failed to fit in the budget, so can't even reserve anything.
                    if (!result)
                        break checks;
                    __classPrivateFieldSet(this, _ContextContent_budgetStats, {
                        reservedTokens, tokenBudget,
                        actualReservedTokens: result.tokens.length
                    }, "f");
                    return __classPrivateFieldGet(this, _ContextContent_budgetStats, "f");
                }
                // Fall-back: we have no reservation.
                __classPrivateFieldSet(this, _ContextContent_budgetStats, {
                    reservedTokens, tokenBudget,
                    actualReservedTokens: 0
                }, "f");
                return __classPrivateFieldGet(this, _ContextContent_budgetStats, "f");
            }
            /**
             * Determines the maximum possible number of tokens that could be
             * inserted if its full token budget were used.
             *
             * This does a trim to determine the true value the first time it
             * is called.
             */
            async getMaximumTokens() {
                if (isNumber(__classPrivateFieldGet(this, _ContextContent_maxTokenCount, "f")))
                    return __classPrivateFieldGet(this, _ContextContent_maxTokenCount, "f");
                const maxTokenBudget = __classPrivateFieldGet(this, _ContextContent_initialBudget, "f");
                const result = await dew(() => {
                    // Can we just use the current value?  This may still execute
                    // the trim, but it is also technically saving time later if we
                    // never call `rebudget`.
                    if (__classPrivateFieldGet(this, _ContextContent_currentBudget, "f") === maxTokenBudget)
                        return this.trimmed;
                    // Otherwise, we need to do this one under-the-table.
                    return __classPrivateFieldGet(this, _ContextContent_instances, "m", _ContextContent_doWork).call(this, () => execTrimTokens(__classPrivateFieldGet(this, _ContextContent_trimmer, "f"), maxTokenBudget));
                });
                // `undefined` means it couldn't even fit the budget, at all.
                __classPrivateFieldSet(this, _ContextContent_maxTokenCount, result?.tokens.length ?? 0, "f");
                return __classPrivateFieldGet(this, _ContextContent_maxTokenCount, "f");
            }
            /**
             * Invokes the trimmer, calculating a result that fits the `newBudget`.
             *
             * This method will also update the {@link trimmed} property with a
             * promise that will be the result of the job.
             *
             * If `newBudget` is not provided, it will use the current budget, which
             * will generally only kick of a trimming job when needed.
             */
            rebudget(newBudget = __classPrivateFieldGet(this, _ContextContent_currentBudget, "f")) {
                // If the budget isn't changing and we have an existing promise,
                // don't bother re-running the trimmer.
                if (newBudget === __classPrivateFieldGet(this, _ContextContent_currentBudget, "f") && __classPrivateFieldGet(this, _ContextContent_currentResult, "f"))
                    return __classPrivateFieldGet(this, _ContextContent_currentResult, "f");
                __classPrivateFieldSet(this, _ContextContent_currentBudget, newBudget, "f");
                __classPrivateFieldSet(this, _ContextContent_currentResult, __classPrivateFieldGet(this, _ContextContent_instances, "m", _ContextContent_doWork).call(this, () => execTrimTokens(__classPrivateFieldGet(this, _ContextContent_trimmer, "f"), newBudget)), "f");
                return __classPrivateFieldGet(this, _ContextContent_currentResult, "f");
            }
            /**
             * Relieves memory pressure by clearing the trimmer's cache.  This will only
             * be done after any currently calculating result has finished.
             *
             * This should be called whenever the instance is expected to no longer need
             * any further budget adjustments.
             */
            async finalize() {
                // Promises in `#otherWorkers` get removed from the set as they complete,
                // assuming they were added by `#doWork`, anyways.  We just need to wait
                // for all the promises to be cleared out.
                while (__classPrivateFieldGet(this, _ContextContent_otherWorkers, "f").size > 0) {
                    // Grab a local copy of the set, just in case.
                    for (const promise of [...__classPrivateFieldGet(this, _ContextContent_otherWorkers, "f")]) {
                        // We don't care if it fails; just that it is done.
                        try {
                            await promise;
                        }
                        catch {
                            continue;
                        }
                    }
                }
                // Now we can clear the trimmer's cache, is possible.
                if ("clear" in __classPrivateFieldGet(this, _ContextContent_trimmer, "f"))
                    __classPrivateFieldGet(this, _ContextContent_trimmer, "f").clear();
            }
        }
        _ContextContent_uniqueId = new WeakMap(), _ContextContent_field = new WeakMap(), _ContextContent_fieldConfig = new WeakMap(), _ContextContent_contextConfig = new WeakMap(), _ContextContent_trimmer = new WeakMap(), _ContextContent_searchText = new WeakMap(), _ContextContent_maxTokenCount = new WeakMap(), _ContextContent_budgetStats = new WeakMap(), _ContextContent_initialBudget = new WeakMap(), _ContextContent_reservedTokens = new WeakMap(), _ContextContent_currentBudget = new WeakMap(), _ContextContent_otherWorkers = new WeakMap(), _ContextContent_currentResult = new WeakMap(), _ContextContent_instances = new WeakSet(), _ContextContent_doWork = function _ContextContent_doWork(fn) {
            const theWork = fn();
            __classPrivateFieldGet(this, _ContextContent_otherWorkers, "f").add(theWork);
            return theWork.finally(() => __classPrivateFieldGet(this, _ContextContent_otherWorkers, "f").delete(theWork));
        };
        return Object.assign(exports, {
            ContextContent
        });
    });

    /**
     * Handles the conversion of content blocks into an observable.
     */
    var $SourceContent = usModule((require, exports) => {
        const { ContextContent } = theModule$4(require);
        const contextSource = $ContextSource(require);
        const toContextSource = (content, index) => {
            // THese are expected to come in an assumed order.
            switch (index) {
                case 0: return contextSource.create(content, "story");
                case 1: return contextSource.create(content, "memory");
                case 2: return contextSource.create(content, "an");
                default: return contextSource.create(content, "unknown");
            }
        };
        const createStream = (contextParams) => {
            const contextChunks = dew(() => {
                const { context } = contextParams.storyContent;
                const chunks = [
                    ContextContent.forStory(contextParams),
                    ...context.map((f) => ContextContent.forField(f, contextParams))
                ];
                return chunks.map(async (content, i) => toContextSource(await content, i));
            });
            return from(contextChunks).pipe(mergeAll());
        };
        return Object.assign(exports, {
            createStream
        });
    });

    /**
     * Handles the conversion of ephemeral entries into an observable.
     */
    var $SourceEphemeral = usModule((require, exports) => {
        const { ContextContent } = theModule$4(require);
        const contextSource = $ContextSource(require);
        const createStream = (contextParams) => {
            const ephemeralContent = contextParams.storyContent.ephemeralContext
                .map((f) => ContextContent.forField(f, contextParams));
            return from(ephemeralContent).pipe(mergeAll(), map((c) => contextSource.create(c, "ephemeral")));
        };
        return Object.assign(exports, {
            createStream
        });
    });

    /**
     * Handles the conversion of lorebook entries into an observable.
     */
    var $SourceLore = usModule((require, exports) => {
        const { ContextContent } = theModule$4(require);
        const contextSource = $ContextSource(require);
        const createStream = (contextParams) => {
            const loreContent = contextParams.storyContent.lorebook.entries
                .map((f) => ContextContent.forField(f, contextParams));
            return from(loreContent).pipe(mergeAll(), map((c) => contextSource.create(c, "lore")));
        };
        return Object.assign(exports, {
            createStream
        });
    });

    var ListCache$2 = _ListCache;
    /**
     * Removes all key-value entries from the stack.
     *
     * @private
     * @name clear
     * @memberOf Stack
     */

    function stackClear$1() {
      this.__data__ = new ListCache$2();
      this.size = 0;
    }

    var _stackClear = stackClear$1;

    /**
     * Removes `key` and its value from the stack.
     *
     * @private
     * @name delete
     * @memberOf Stack
     * @param {string} key The key of the value to remove.
     * @returns {boolean} Returns `true` if the entry was removed, else `false`.
     */

    function stackDelete$1(key) {
      var data = this.__data__,
          result = data['delete'](key);
      this.size = data.size;
      return result;
    }

    var _stackDelete = stackDelete$1;

    /**
     * Gets the stack value for `key`.
     *
     * @private
     * @name get
     * @memberOf Stack
     * @param {string} key The key of the value to get.
     * @returns {*} Returns the entry value.
     */

    function stackGet$1(key) {
      return this.__data__.get(key);
    }

    var _stackGet = stackGet$1;

    /**
     * Checks if a stack value for `key` exists.
     *
     * @private
     * @name has
     * @memberOf Stack
     * @param {string} key The key of the entry to check.
     * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
     */

    function stackHas$1(key) {
      return this.__data__.has(key);
    }

    var _stackHas = stackHas$1;

    var ListCache$1 = _ListCache,
        Map$2 = _Map,
        MapCache$1 = _MapCache;
    /** Used as the size to enable large array optimizations. */

    var LARGE_ARRAY_SIZE = 200;
    /**
     * Sets the stack `key` to `value`.
     *
     * @private
     * @name set
     * @memberOf Stack
     * @param {string} key The key of the value to set.
     * @param {*} value The value to set.
     * @returns {Object} Returns the stack cache instance.
     */

    function stackSet$1(key, value) {
      var data = this.__data__;

      if (data instanceof ListCache$1) {
        var pairs = data.__data__;

        if (!Map$2 || pairs.length < LARGE_ARRAY_SIZE - 1) {
          pairs.push([key, value]);
          this.size = ++data.size;
          return this;
        }

        data = this.__data__ = new MapCache$1(pairs);
      }

      data.set(key, value);
      this.size = data.size;
      return this;
    }

    var _stackSet = stackSet$1;

    var ListCache = _ListCache,
        stackClear = _stackClear,
        stackDelete = _stackDelete,
        stackGet = _stackGet,
        stackHas = _stackHas,
        stackSet = _stackSet;
    /**
     * Creates a stack cache object to store key-value pairs.
     *
     * @private
     * @constructor
     * @param {Array} [entries] The key-value pairs to cache.
     */

    function Stack$3(entries) {
      var data = this.__data__ = new ListCache(entries);
      this.size = data.size;
    } // Add methods to `Stack`.


    Stack$3.prototype.clear = stackClear;
    Stack$3.prototype['delete'] = stackDelete;
    Stack$3.prototype.get = stackGet;
    Stack$3.prototype.has = stackHas;
    Stack$3.prototype.set = stackSet;
    var _Stack = Stack$3;

    /**
     * A specialized version of `_.forEach` for arrays without support for
     * iteratee shorthands.
     *
     * @private
     * @param {Array} [array] The array to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {Array} Returns `array`.
     */

    function arrayEach$1(array, iteratee) {
      var index = -1,
          length = array == null ? 0 : array.length;

      while (++index < length) {
        if (iteratee(array[index], index, array) === false) {
          break;
        }
      }

      return array;
    }

    var _arrayEach = arrayEach$1;

    var getNative$4 = _getNative;

    var defineProperty$1 = function () {
      try {
        var func = getNative$4(Object, 'defineProperty');
        func({}, '', {});
        return func;
      } catch (e) {}
    }();

    var _defineProperty = defineProperty$1;

    var defineProperty = _defineProperty;
    /**
     * The base implementation of `assignValue` and `assignMergeValue` without
     * value checks.
     *
     * @private
     * @param {Object} object The object to modify.
     * @param {string} key The key of the property to assign.
     * @param {*} value The value to assign.
     */

    function baseAssignValue$2(object, key, value) {
      if (key == '__proto__' && defineProperty) {
        defineProperty(object, key, {
          'configurable': true,
          'enumerable': true,
          'value': value,
          'writable': true
        });
      } else {
        object[key] = value;
      }
    }

    var _baseAssignValue = baseAssignValue$2;

    var baseAssignValue$1 = _baseAssignValue,
        eq$1 = eq_1;
    /** Used for built-in method references. */

    var objectProto$8 = Object.prototype;
    /** Used to check objects for own properties. */

    var hasOwnProperty$6 = objectProto$8.hasOwnProperty;
    /**
     * Assigns `value` to `key` of `object` if the existing value is not equivalent
     * using [`SameValueZero`](http://ecma-international.org/ecma-262/7.0/#sec-samevaluezero)
     * for equality comparisons.
     *
     * @private
     * @param {Object} object The object to modify.
     * @param {string} key The key of the property to assign.
     * @param {*} value The value to assign.
     */

    function assignValue$2(object, key, value) {
      var objValue = object[key];

      if (!(hasOwnProperty$6.call(object, key) && eq$1(objValue, value)) || value === undefined && !(key in object)) {
        baseAssignValue$1(object, key, value);
      }
    }

    var _assignValue = assignValue$2;

    var assignValue$1 = _assignValue,
        baseAssignValue = _baseAssignValue;
    /**
     * Copies properties of `source` to `object`.
     *
     * @private
     * @param {Object} source The object to copy properties from.
     * @param {Array} props The property identifiers to copy.
     * @param {Object} [object={}] The object to copy properties to.
     * @param {Function} [customizer] The function to customize copied values.
     * @returns {Object} Returns `object`.
     */

    function copyObject$4(source, props, object, customizer) {
      var isNew = !object;
      object || (object = {});
      var index = -1,
          length = props.length;

      while (++index < length) {
        var key = props[index];
        var newValue = customizer ? customizer(object[key], source[key], key, object, source) : undefined;

        if (newValue === undefined) {
          newValue = source[key];
        }

        if (isNew) {
          baseAssignValue(object, key, newValue);
        } else {
          assignValue$1(object, key, newValue);
        }
      }

      return object;
    }

    var _copyObject = copyObject$4;

    /**
     * The base implementation of `_.times` without support for iteratee shorthands
     * or max array length checks.
     *
     * @private
     * @param {number} n The number of times to invoke `iteratee`.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {Array} Returns the array of results.
     */

    function baseTimes$1(n, iteratee) {
      var index = -1,
          result = Array(n);

      while (++index < n) {
        result[index] = iteratee(index);
      }

      return result;
    }

    var _baseTimes = baseTimes$1;

    var isBuffer$3 = {exports: {}};

    /**
     * This method returns `false`.
     *
     * @static
     * @memberOf _
     * @since 4.13.0
     * @category Util
     * @returns {boolean} Returns `false`.
     * @example
     *
     * _.times(2, _.stubFalse);
     * // => [false, false]
     */

    function stubFalse() {
      return false;
    }

    var stubFalse_1 = stubFalse;

    (function (module, exports) {
      var root = _root,
          stubFalse = stubFalse_1;
      /** Detect free variable `exports`. */

      var freeExports = exports && !exports.nodeType && exports;
      /** Detect free variable `module`. */

      var freeModule = freeExports && 'object' == 'object' && module && !module.nodeType && module;
      /** Detect the popular CommonJS extension `module.exports`. */

      var moduleExports = freeModule && freeModule.exports === freeExports;
      /** Built-in value references. */

      var Buffer = moduleExports ? root.Buffer : undefined;
      /* Built-in method references for those with the same name as other `lodash` methods. */

      var nativeIsBuffer = Buffer ? Buffer.isBuffer : undefined;
      /**
       * Checks if `value` is a buffer.
       *
       * @static
       * @memberOf _
       * @since 4.3.0
       * @category Lang
       * @param {*} value The value to check.
       * @returns {boolean} Returns `true` if `value` is a buffer, else `false`.
       * @example
       *
       * _.isBuffer(new Buffer(2));
       * // => true
       *
       * _.isBuffer(new Uint8Array(2));
       * // => false
       */

      var isBuffer = nativeIsBuffer || stubFalse;
      module.exports = isBuffer;
    })(isBuffer$3, isBuffer$3.exports);

    var baseGetTag$1 = _baseGetTag,
        isLength$1 = isLength_1,
        isObjectLike$3 = isObjectLike_1;
    /** `Object#toString` result references. */

    var argsTag$2 = '[object Arguments]',
        arrayTag$2 = '[object Array]',
        boolTag$3 = '[object Boolean]',
        dateTag$3 = '[object Date]',
        errorTag$2 = '[object Error]',
        funcTag$1 = '[object Function]',
        mapTag$5 = '[object Map]',
        numberTag$3 = '[object Number]',
        objectTag$3 = '[object Object]',
        regexpTag$3 = '[object RegExp]',
        setTag$5 = '[object Set]',
        stringTag$3 = '[object String]',
        weakMapTag$2 = '[object WeakMap]';
    var arrayBufferTag$3 = '[object ArrayBuffer]',
        dataViewTag$4 = '[object DataView]',
        float32Tag$2 = '[object Float32Array]',
        float64Tag$2 = '[object Float64Array]',
        int8Tag$2 = '[object Int8Array]',
        int16Tag$2 = '[object Int16Array]',
        int32Tag$2 = '[object Int32Array]',
        uint8Tag$2 = '[object Uint8Array]',
        uint8ClampedTag$2 = '[object Uint8ClampedArray]',
        uint16Tag$2 = '[object Uint16Array]',
        uint32Tag$2 = '[object Uint32Array]';
    /** Used to identify `toStringTag` values of typed arrays. */

    var typedArrayTags = {};
    typedArrayTags[float32Tag$2] = typedArrayTags[float64Tag$2] = typedArrayTags[int8Tag$2] = typedArrayTags[int16Tag$2] = typedArrayTags[int32Tag$2] = typedArrayTags[uint8Tag$2] = typedArrayTags[uint8ClampedTag$2] = typedArrayTags[uint16Tag$2] = typedArrayTags[uint32Tag$2] = true;
    typedArrayTags[argsTag$2] = typedArrayTags[arrayTag$2] = typedArrayTags[arrayBufferTag$3] = typedArrayTags[boolTag$3] = typedArrayTags[dataViewTag$4] = typedArrayTags[dateTag$3] = typedArrayTags[errorTag$2] = typedArrayTags[funcTag$1] = typedArrayTags[mapTag$5] = typedArrayTags[numberTag$3] = typedArrayTags[objectTag$3] = typedArrayTags[regexpTag$3] = typedArrayTags[setTag$5] = typedArrayTags[stringTag$3] = typedArrayTags[weakMapTag$2] = false;
    /**
     * The base implementation of `_.isTypedArray` without Node.js optimizations.
     *
     * @private
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
     */

    function baseIsTypedArray$1(value) {
      return isObjectLike$3(value) && isLength$1(value.length) && !!typedArrayTags[baseGetTag$1(value)];
    }

    var _baseIsTypedArray = baseIsTypedArray$1;

    /**
     * The base implementation of `_.unary` without support for storing metadata.
     *
     * @private
     * @param {Function} func The function to cap arguments for.
     * @returns {Function} Returns the new capped function.
     */

    function baseUnary$3(func) {
      return function (value) {
        return func(value);
      };
    }

    var _baseUnary = baseUnary$3;

    var _nodeUtil = {exports: {}};

    (function (module, exports) {
      var freeGlobal = _freeGlobal;
      /** Detect free variable `exports`. */

      var freeExports = exports && !exports.nodeType && exports;
      /** Detect free variable `module`. */

      var freeModule = freeExports && 'object' == 'object' && module && !module.nodeType && module;
      /** Detect the popular CommonJS extension `module.exports`. */

      var moduleExports = freeModule && freeModule.exports === freeExports;
      /** Detect free variable `process` from Node.js. */

      var freeProcess = moduleExports && freeGlobal.process;
      /** Used to access faster Node.js helpers. */

      var nodeUtil = function () {
        try {
          // Use `util.types` for Node.js 10+.
          var types = freeModule && freeModule.require && freeModule.require('util').types;

          if (types) {
            return types;
          } // Legacy `process.binding('util')` for Node.js < 10.


          return freeProcess && freeProcess.binding && freeProcess.binding('util');
        } catch (e) {}
      }();

      module.exports = nodeUtil;
    })(_nodeUtil, _nodeUtil.exports);

    var baseIsTypedArray = _baseIsTypedArray,
        baseUnary$2 = _baseUnary,
        nodeUtil$2 = _nodeUtil.exports;
    /* Node.js helper references. */

    var nodeIsTypedArray = nodeUtil$2 && nodeUtil$2.isTypedArray;
    /**
     * Checks if `value` is classified as a typed array.
     *
     * @static
     * @memberOf _
     * @since 3.0.0
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a typed array, else `false`.
     * @example
     *
     * _.isTypedArray(new Uint8Array);
     * // => true
     *
     * _.isTypedArray([]);
     * // => false
     */

    var isTypedArray$2 = nodeIsTypedArray ? baseUnary$2(nodeIsTypedArray) : baseIsTypedArray;
    var isTypedArray_1 = isTypedArray$2;

    var baseTimes = _baseTimes,
        isArguments = isArguments_1,
        isArray$3 = isArray_1,
        isBuffer$2 = isBuffer$3.exports,
        isIndex = _isIndex,
        isTypedArray$1 = isTypedArray_1;
    /** Used for built-in method references. */

    var objectProto$7 = Object.prototype;
    /** Used to check objects for own properties. */

    var hasOwnProperty$5 = objectProto$7.hasOwnProperty;
    /**
     * Creates an array of the enumerable property names of the array-like `value`.
     *
     * @private
     * @param {*} value The value to query.
     * @param {boolean} inherited Specify returning inherited property names.
     * @returns {Array} Returns the array of property names.
     */

    function arrayLikeKeys$2(value, inherited) {
      var isArr = isArray$3(value),
          isArg = !isArr && isArguments(value),
          isBuff = !isArr && !isArg && isBuffer$2(value),
          isType = !isArr && !isArg && !isBuff && isTypedArray$1(value),
          skipIndexes = isArr || isArg || isBuff || isType,
          result = skipIndexes ? baseTimes(value.length, String) : [],
          length = result.length;

      for (var key in value) {
        if ((inherited || hasOwnProperty$5.call(value, key)) && !(skipIndexes && ( // Safari 9 has enumerable `arguments.length` in strict mode.
        key == 'length' || // Node.js 0.10 has enumerable non-index properties on buffers.
        isBuff && (key == 'offset' || key == 'parent') || // PhantomJS 2 has enumerable non-index properties on typed arrays.
        isType && (key == 'buffer' || key == 'byteLength' || key == 'byteOffset') || // Skip index properties.
        isIndex(key, length)))) {
          result.push(key);
        }
      }

      return result;
    }

    var _arrayLikeKeys = arrayLikeKeys$2;

    /** Used for built-in method references. */
    var objectProto$6 = Object.prototype;
    /**
     * Checks if `value` is likely a prototype object.
     *
     * @private
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a prototype, else `false`.
     */

    function isPrototype$3(value) {
      var Ctor = value && value.constructor,
          proto = typeof Ctor == 'function' && Ctor.prototype || objectProto$6;
      return value === proto;
    }

    var _isPrototype = isPrototype$3;

    /**
     * Creates a unary function that invokes `func` with its argument transformed.
     *
     * @private
     * @param {Function} func The function to wrap.
     * @param {Function} transform The argument transform.
     * @returns {Function} Returns the new function.
     */

    function overArg$2(func, transform) {
      return function (arg) {
        return func(transform(arg));
      };
    }

    var _overArg = overArg$2;

    var overArg$1 = _overArg;
    /* Built-in method references for those with the same name as other `lodash` methods. */

    var nativeKeys$1 = overArg$1(Object.keys, Object);
    var _nativeKeys = nativeKeys$1;

    var isPrototype$2 = _isPrototype,
        nativeKeys = _nativeKeys;
    /** Used for built-in method references. */

    var objectProto$5 = Object.prototype;
    /** Used to check objects for own properties. */

    var hasOwnProperty$4 = objectProto$5.hasOwnProperty;
    /**
     * The base implementation of `_.keys` which doesn't treat sparse arrays as dense.
     *
     * @private
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of property names.
     */

    function baseKeys$1(object) {
      if (!isPrototype$2(object)) {
        return nativeKeys(object);
      }

      var result = [];

      for (var key in Object(object)) {
        if (hasOwnProperty$4.call(object, key) && key != 'constructor') {
          result.push(key);
        }
      }

      return result;
    }

    var _baseKeys = baseKeys$1;

    var isFunction = isFunction_1,
        isLength = isLength_1;
    /**
     * Checks if `value` is array-like. A value is considered array-like if it's
     * not a function and has a `value.length` that's an integer greater than or
     * equal to `0` and less than or equal to `Number.MAX_SAFE_INTEGER`.
     *
     * @static
     * @memberOf _
     * @since 4.0.0
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is array-like, else `false`.
     * @example
     *
     * _.isArrayLike([1, 2, 3]);
     * // => true
     *
     * _.isArrayLike(document.body.children);
     * // => true
     *
     * _.isArrayLike('abc');
     * // => true
     *
     * _.isArrayLike(_.noop);
     * // => false
     */

    function isArrayLike$2(value) {
      return value != null && isLength(value.length) && !isFunction(value);
    }

    var isArrayLike_1 = isArrayLike$2;

    var arrayLikeKeys$1 = _arrayLikeKeys,
        baseKeys = _baseKeys,
        isArrayLike$1 = isArrayLike_1;
    /**
     * Creates an array of the own enumerable property names of `object`.
     *
     * **Note:** Non-object values are coerced to objects. See the
     * [ES spec](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
     * for more details.
     *
     * @static
     * @since 0.1.0
     * @memberOf _
     * @category Object
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of property names.
     * @example
     *
     * function Foo() {
     *   this.a = 1;
     *   this.b = 2;
     * }
     *
     * Foo.prototype.c = 3;
     *
     * _.keys(new Foo);
     * // => ['a', 'b'] (iteration order is not guaranteed)
     *
     * _.keys('hi');
     * // => ['0', '1']
     */

    function keys$5(object) {
      return isArrayLike$1(object) ? arrayLikeKeys$1(object) : baseKeys(object);
    }

    var keys_1 = keys$5;

    var copyObject$3 = _copyObject,
        keys$4 = keys_1;
    /**
     * The base implementation of `_.assign` without support for multiple sources
     * or `customizer` functions.
     *
     * @private
     * @param {Object} object The destination object.
     * @param {Object} source The source object.
     * @returns {Object} Returns `object`.
     */

    function baseAssign$1(object, source) {
      return object && copyObject$3(source, keys$4(source), object);
    }

    var _baseAssign = baseAssign$1;

    /**
     * This function is like
     * [`Object.keys`](http://ecma-international.org/ecma-262/7.0/#sec-object.keys)
     * except that it includes inherited enumerable properties.
     *
     * @private
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of property names.
     */

    function nativeKeysIn$1(object) {
      var result = [];

      if (object != null) {
        for (var key in Object(object)) {
          result.push(key);
        }
      }

      return result;
    }

    var _nativeKeysIn = nativeKeysIn$1;

    var isObject$4 = isObject_1,
        isPrototype$1 = _isPrototype,
        nativeKeysIn = _nativeKeysIn;
    /** Used for built-in method references. */

    var objectProto$4 = Object.prototype;
    /** Used to check objects for own properties. */

    var hasOwnProperty$3 = objectProto$4.hasOwnProperty;
    /**
     * The base implementation of `_.keysIn` which doesn't treat sparse arrays as dense.
     *
     * @private
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of property names.
     */

    function baseKeysIn$1(object) {
      if (!isObject$4(object)) {
        return nativeKeysIn(object);
      }

      var isProto = isPrototype$1(object),
          result = [];

      for (var key in object) {
        if (!(key == 'constructor' && (isProto || !hasOwnProperty$3.call(object, key)))) {
          result.push(key);
        }
      }

      return result;
    }

    var _baseKeysIn = baseKeysIn$1;

    var arrayLikeKeys = _arrayLikeKeys,
        baseKeysIn = _baseKeysIn,
        isArrayLike = isArrayLike_1;
    /**
     * Creates an array of the own and inherited enumerable property names of `object`.
     *
     * **Note:** Non-object values are coerced to objects.
     *
     * @static
     * @memberOf _
     * @since 3.0.0
     * @category Object
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of property names.
     * @example
     *
     * function Foo() {
     *   this.a = 1;
     *   this.b = 2;
     * }
     *
     * Foo.prototype.c = 3;
     *
     * _.keysIn(new Foo);
     * // => ['a', 'b', 'c'] (iteration order is not guaranteed)
     */

    function keysIn$3(object) {
      return isArrayLike(object) ? arrayLikeKeys(object, true) : baseKeysIn(object);
    }

    var keysIn_1 = keysIn$3;

    var copyObject$2 = _copyObject,
        keysIn$2 = keysIn_1;
    /**
     * The base implementation of `_.assignIn` without support for multiple sources
     * or `customizer` functions.
     *
     * @private
     * @param {Object} object The destination object.
     * @param {Object} source The source object.
     * @returns {Object} Returns `object`.
     */

    function baseAssignIn$1(object, source) {
      return object && copyObject$2(source, keysIn$2(source), object);
    }

    var _baseAssignIn = baseAssignIn$1;

    var _cloneBuffer = {exports: {}};

    (function (module, exports) {
      var root = _root;
      /** Detect free variable `exports`. */

      var freeExports = exports && !exports.nodeType && exports;
      /** Detect free variable `module`. */

      var freeModule = freeExports && 'object' == 'object' && module && !module.nodeType && module;
      /** Detect the popular CommonJS extension `module.exports`. */

      var moduleExports = freeModule && freeModule.exports === freeExports;
      /** Built-in value references. */

      var Buffer = moduleExports ? root.Buffer : undefined,
          allocUnsafe = Buffer ? Buffer.allocUnsafe : undefined;
      /**
       * Creates a clone of  `buffer`.
       *
       * @private
       * @param {Buffer} buffer The buffer to clone.
       * @param {boolean} [isDeep] Specify a deep clone.
       * @returns {Buffer} Returns the cloned buffer.
       */

      function cloneBuffer(buffer, isDeep) {
        if (isDeep) {
          return buffer.slice();
        }

        var length = buffer.length,
            result = allocUnsafe ? allocUnsafe(length) : new buffer.constructor(length);
        buffer.copy(result);
        return result;
      }

      module.exports = cloneBuffer;
    })(_cloneBuffer, _cloneBuffer.exports);

    /**
     * Copies the values of `source` to `array`.
     *
     * @private
     * @param {Array} source The array to copy values from.
     * @param {Array} [array=[]] The array to copy values to.
     * @returns {Array} Returns `array`.
     */

    function copyArray$1(source, array) {
      var index = -1,
          length = source.length;
      array || (array = Array(length));

      while (++index < length) {
        array[index] = source[index];
      }

      return array;
    }

    var _copyArray = copyArray$1;

    /**
     * A specialized version of `_.filter` for arrays without support for
     * iteratee shorthands.
     *
     * @private
     * @param {Array} [array] The array to iterate over.
     * @param {Function} predicate The function invoked per iteration.
     * @returns {Array} Returns the new filtered array.
     */

    function arrayFilter$1(array, predicate) {
      var index = -1,
          length = array == null ? 0 : array.length,
          resIndex = 0,
          result = [];

      while (++index < length) {
        var value = array[index];

        if (predicate(value, index, array)) {
          result[resIndex++] = value;
        }
      }

      return result;
    }

    var _arrayFilter = arrayFilter$1;

    /**
     * This method returns a new empty array.
     *
     * @static
     * @memberOf _
     * @since 4.13.0
     * @category Util
     * @returns {Array} Returns the new empty array.
     * @example
     *
     * var arrays = _.times(2, _.stubArray);
     *
     * console.log(arrays);
     * // => [[], []]
     *
     * console.log(arrays[0] === arrays[1]);
     * // => false
     */

    function stubArray$2() {
      return [];
    }

    var stubArray_1 = stubArray$2;

    var arrayFilter = _arrayFilter,
        stubArray$1 = stubArray_1;
    /** Used for built-in method references. */

    var objectProto$3 = Object.prototype;
    /** Built-in value references. */

    var propertyIsEnumerable = objectProto$3.propertyIsEnumerable;
    /* Built-in method references for those with the same name as other `lodash` methods. */

    var nativeGetSymbols$1 = Object.getOwnPropertySymbols;
    /**
     * Creates an array of the own enumerable symbols of `object`.
     *
     * @private
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of symbols.
     */

    var getSymbols$3 = !nativeGetSymbols$1 ? stubArray$1 : function (object) {
      if (object == null) {
        return [];
      }

      object = Object(object);
      return arrayFilter(nativeGetSymbols$1(object), function (symbol) {
        return propertyIsEnumerable.call(object, symbol);
      });
    };
    var _getSymbols = getSymbols$3;

    var copyObject$1 = _copyObject,
        getSymbols$2 = _getSymbols;
    /**
     * Copies own symbols of `source` to `object`.
     *
     * @private
     * @param {Object} source The object to copy symbols from.
     * @param {Object} [object={}] The object to copy symbols to.
     * @returns {Object} Returns `object`.
     */

    function copySymbols$1(source, object) {
      return copyObject$1(source, getSymbols$2(source), object);
    }

    var _copySymbols = copySymbols$1;

    /**
     * Appends the elements of `values` to `array`.
     *
     * @private
     * @param {Array} array The array to modify.
     * @param {Array} values The values to append.
     * @returns {Array} Returns `array`.
     */

    function arrayPush$2(array, values) {
      var index = -1,
          length = values.length,
          offset = array.length;

      while (++index < length) {
        array[offset + index] = values[index];
      }

      return array;
    }

    var _arrayPush = arrayPush$2;

    var overArg = _overArg;
    /** Built-in value references. */

    var getPrototype$2 = overArg(Object.getPrototypeOf, Object);
    var _getPrototype = getPrototype$2;

    var arrayPush$1 = _arrayPush,
        getPrototype$1 = _getPrototype,
        getSymbols$1 = _getSymbols,
        stubArray = stubArray_1;
    /* Built-in method references for those with the same name as other `lodash` methods. */

    var nativeGetSymbols = Object.getOwnPropertySymbols;
    /**
     * Creates an array of the own and inherited enumerable symbols of `object`.
     *
     * @private
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of symbols.
     */

    var getSymbolsIn$2 = !nativeGetSymbols ? stubArray : function (object) {
      var result = [];

      while (object) {
        arrayPush$1(result, getSymbols$1(object));
        object = getPrototype$1(object);
      }

      return result;
    };
    var _getSymbolsIn = getSymbolsIn$2;

    var copyObject = _copyObject,
        getSymbolsIn$1 = _getSymbolsIn;
    /**
     * Copies own and inherited symbols of `source` to `object`.
     *
     * @private
     * @param {Object} source The object to copy symbols from.
     * @param {Object} [object={}] The object to copy symbols to.
     * @returns {Object} Returns `object`.
     */

    function copySymbolsIn$1(source, object) {
      return copyObject(source, getSymbolsIn$1(source), object);
    }

    var _copySymbolsIn = copySymbolsIn$1;

    var arrayPush = _arrayPush,
        isArray$2 = isArray_1;
    /**
     * The base implementation of `getAllKeys` and `getAllKeysIn` which uses
     * `keysFunc` and `symbolsFunc` to get the enumerable property names and
     * symbols of `object`.
     *
     * @private
     * @param {Object} object The object to query.
     * @param {Function} keysFunc The function to get the keys of `object`.
     * @param {Function} symbolsFunc The function to get the symbols of `object`.
     * @returns {Array} Returns the array of property names and symbols.
     */

    function baseGetAllKeys$2(object, keysFunc, symbolsFunc) {
      var result = keysFunc(object);
      return isArray$2(object) ? result : arrayPush(result, symbolsFunc(object));
    }

    var _baseGetAllKeys = baseGetAllKeys$2;

    var baseGetAllKeys$1 = _baseGetAllKeys,
        getSymbols = _getSymbols,
        keys$3 = keys_1;
    /**
     * Creates an array of own enumerable property names and symbols of `object`.
     *
     * @private
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of property names and symbols.
     */

    function getAllKeys$2(object) {
      return baseGetAllKeys$1(object, keys$3, getSymbols);
    }

    var _getAllKeys = getAllKeys$2;

    var baseGetAllKeys = _baseGetAllKeys,
        getSymbolsIn = _getSymbolsIn,
        keysIn$1 = keysIn_1;
    /**
     * Creates an array of own and inherited enumerable property names and
     * symbols of `object`.
     *
     * @private
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of property names and symbols.
     */

    function getAllKeysIn$1(object) {
      return baseGetAllKeys(object, keysIn$1, getSymbolsIn);
    }

    var _getAllKeysIn = getAllKeysIn$1;

    var getNative$3 = _getNative,
        root$4 = _root;
    /* Built-in method references that are verified to be native. */

    var DataView$1 = getNative$3(root$4, 'DataView');
    var _DataView = DataView$1;

    var getNative$2 = _getNative,
        root$3 = _root;
    /* Built-in method references that are verified to be native. */

    var Promise$2 = getNative$2(root$3, 'Promise');
    var _Promise = Promise$2;

    var getNative$1 = _getNative,
        root$2 = _root;
    /* Built-in method references that are verified to be native. */

    var Set$2 = getNative$1(root$2, 'Set');
    var _Set = Set$2;

    var getNative = _getNative,
        root$1 = _root;
    /* Built-in method references that are verified to be native. */

    var WeakMap$2 = getNative(root$1, 'WeakMap');
    var _WeakMap = WeakMap$2;

    var DataView = _DataView,
        Map$1 = _Map,
        Promise$1 = _Promise,
        Set$1 = _Set,
        WeakMap$1 = _WeakMap,
        baseGetTag = _baseGetTag,
        toSource = _toSource;
    /** `Object#toString` result references. */

    var mapTag$4 = '[object Map]',
        objectTag$2 = '[object Object]',
        promiseTag = '[object Promise]',
        setTag$4 = '[object Set]',
        weakMapTag$1 = '[object WeakMap]';
    var dataViewTag$3 = '[object DataView]';
    /** Used to detect maps, sets, and weakmaps. */

    var dataViewCtorString = toSource(DataView),
        mapCtorString = toSource(Map$1),
        promiseCtorString = toSource(Promise$1),
        setCtorString = toSource(Set$1),
        weakMapCtorString = toSource(WeakMap$1);
    /**
     * Gets the `toStringTag` of `value`.
     *
     * @private
     * @param {*} value The value to query.
     * @returns {string} Returns the `toStringTag`.
     */

    var getTag$4 = baseGetTag; // Fallback for data views, maps, sets, and weak maps in IE 11 and promises in Node.js < 6.

    if (DataView && getTag$4(new DataView(new ArrayBuffer(1))) != dataViewTag$3 || Map$1 && getTag$4(new Map$1()) != mapTag$4 || Promise$1 && getTag$4(Promise$1.resolve()) != promiseTag || Set$1 && getTag$4(new Set$1()) != setTag$4 || WeakMap$1 && getTag$4(new WeakMap$1()) != weakMapTag$1) {
      getTag$4 = function (value) {
        var result = baseGetTag(value),
            Ctor = result == objectTag$2 ? value.constructor : undefined,
            ctorString = Ctor ? toSource(Ctor) : '';

        if (ctorString) {
          switch (ctorString) {
            case dataViewCtorString:
              return dataViewTag$3;

            case mapCtorString:
              return mapTag$4;

            case promiseCtorString:
              return promiseTag;

            case setCtorString:
              return setTag$4;

            case weakMapCtorString:
              return weakMapTag$1;
          }
        }

        return result;
      };
    }

    var _getTag = getTag$4;

    /** Used for built-in method references. */
    var objectProto$2 = Object.prototype;
    /** Used to check objects for own properties. */

    var hasOwnProperty$2 = objectProto$2.hasOwnProperty;
    /**
     * Initializes an array clone.
     *
     * @private
     * @param {Array} array The array to clone.
     * @returns {Array} Returns the initialized clone.
     */

    function initCloneArray$1(array) {
      var length = array.length,
          result = new array.constructor(length); // Add properties assigned by `RegExp#exec`.

      if (length && typeof array[0] == 'string' && hasOwnProperty$2.call(array, 'index')) {
        result.index = array.index;
        result.input = array.input;
      }

      return result;
    }

    var _initCloneArray = initCloneArray$1;

    var root = _root;
    /** Built-in value references. */

    var Uint8Array$2 = root.Uint8Array;
    var _Uint8Array = Uint8Array$2;

    var Uint8Array$1 = _Uint8Array;
    /**
     * Creates a clone of `arrayBuffer`.
     *
     * @private
     * @param {ArrayBuffer} arrayBuffer The array buffer to clone.
     * @returns {ArrayBuffer} Returns the cloned array buffer.
     */

    function cloneArrayBuffer$3(arrayBuffer) {
      var result = new arrayBuffer.constructor(arrayBuffer.byteLength);
      new Uint8Array$1(result).set(new Uint8Array$1(arrayBuffer));
      return result;
    }

    var _cloneArrayBuffer = cloneArrayBuffer$3;

    var cloneArrayBuffer$2 = _cloneArrayBuffer;
    /**
     * Creates a clone of `dataView`.
     *
     * @private
     * @param {Object} dataView The data view to clone.
     * @param {boolean} [isDeep] Specify a deep clone.
     * @returns {Object} Returns the cloned data view.
     */

    function cloneDataView$1(dataView, isDeep) {
      var buffer = isDeep ? cloneArrayBuffer$2(dataView.buffer) : dataView.buffer;
      return new dataView.constructor(buffer, dataView.byteOffset, dataView.byteLength);
    }

    var _cloneDataView = cloneDataView$1;

    /** Used to match `RegExp` flags from their coerced string values. */
    var reFlags = /\w*$/;
    /**
     * Creates a clone of `regexp`.
     *
     * @private
     * @param {Object} regexp The regexp to clone.
     * @returns {Object} Returns the cloned regexp.
     */

    function cloneRegExp$1(regexp) {
      var result = new regexp.constructor(regexp.source, reFlags.exec(regexp));
      result.lastIndex = regexp.lastIndex;
      return result;
    }

    var _cloneRegExp = cloneRegExp$1;

    var Symbol$2 = _Symbol;
    /** Used to convert symbols to primitives and strings. */

    var symbolProto$1 = Symbol$2 ? Symbol$2.prototype : undefined,
        symbolValueOf$1 = symbolProto$1 ? symbolProto$1.valueOf : undefined;
    /**
     * Creates a clone of the `symbol` object.
     *
     * @private
     * @param {Object} symbol The symbol object to clone.
     * @returns {Object} Returns the cloned symbol object.
     */

    function cloneSymbol$1(symbol) {
      return symbolValueOf$1 ? Object(symbolValueOf$1.call(symbol)) : {};
    }

    var _cloneSymbol = cloneSymbol$1;

    var cloneArrayBuffer$1 = _cloneArrayBuffer;
    /**
     * Creates a clone of `typedArray`.
     *
     * @private
     * @param {Object} typedArray The typed array to clone.
     * @param {boolean} [isDeep] Specify a deep clone.
     * @returns {Object} Returns the cloned typed array.
     */

    function cloneTypedArray$1(typedArray, isDeep) {
      var buffer = isDeep ? cloneArrayBuffer$1(typedArray.buffer) : typedArray.buffer;
      return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
    }

    var _cloneTypedArray = cloneTypedArray$1;

    var cloneArrayBuffer = _cloneArrayBuffer,
        cloneDataView = _cloneDataView,
        cloneRegExp = _cloneRegExp,
        cloneSymbol = _cloneSymbol,
        cloneTypedArray = _cloneTypedArray;
    /** `Object#toString` result references. */

    var boolTag$2 = '[object Boolean]',
        dateTag$2 = '[object Date]',
        mapTag$3 = '[object Map]',
        numberTag$2 = '[object Number]',
        regexpTag$2 = '[object RegExp]',
        setTag$3 = '[object Set]',
        stringTag$2 = '[object String]',
        symbolTag$2 = '[object Symbol]';
    var arrayBufferTag$2 = '[object ArrayBuffer]',
        dataViewTag$2 = '[object DataView]',
        float32Tag$1 = '[object Float32Array]',
        float64Tag$1 = '[object Float64Array]',
        int8Tag$1 = '[object Int8Array]',
        int16Tag$1 = '[object Int16Array]',
        int32Tag$1 = '[object Int32Array]',
        uint8Tag$1 = '[object Uint8Array]',
        uint8ClampedTag$1 = '[object Uint8ClampedArray]',
        uint16Tag$1 = '[object Uint16Array]',
        uint32Tag$1 = '[object Uint32Array]';
    /**
     * Initializes an object clone based on its `toStringTag`.
     *
     * **Note:** This function only supports cloning values with tags of
     * `Boolean`, `Date`, `Error`, `Map`, `Number`, `RegExp`, `Set`, or `String`.
     *
     * @private
     * @param {Object} object The object to clone.
     * @param {string} tag The `toStringTag` of the object to clone.
     * @param {boolean} [isDeep] Specify a deep clone.
     * @returns {Object} Returns the initialized clone.
     */

    function initCloneByTag$1(object, tag, isDeep) {
      var Ctor = object.constructor;

      switch (tag) {
        case arrayBufferTag$2:
          return cloneArrayBuffer(object);

        case boolTag$2:
        case dateTag$2:
          return new Ctor(+object);

        case dataViewTag$2:
          return cloneDataView(object, isDeep);

        case float32Tag$1:
        case float64Tag$1:
        case int8Tag$1:
        case int16Tag$1:
        case int32Tag$1:
        case uint8Tag$1:
        case uint8ClampedTag$1:
        case uint16Tag$1:
        case uint32Tag$1:
          return cloneTypedArray(object, isDeep);

        case mapTag$3:
          return new Ctor();

        case numberTag$2:
        case stringTag$2:
          return new Ctor(object);

        case regexpTag$2:
          return cloneRegExp(object);

        case setTag$3:
          return new Ctor();

        case symbolTag$2:
          return cloneSymbol(object);
      }
    }

    var _initCloneByTag = initCloneByTag$1;

    var isObject$3 = isObject_1;
    /** Built-in value references. */

    var objectCreate = Object.create;
    /**
     * The base implementation of `_.create` without support for assigning
     * properties to the created object.
     *
     * @private
     * @param {Object} proto The object to inherit from.
     * @returns {Object} Returns the new object.
     */

    var baseCreate$1 = function () {
      function object() {}

      return function (proto) {
        if (!isObject$3(proto)) {
          return {};
        }

        if (objectCreate) {
          return objectCreate(proto);
        }

        object.prototype = proto;
        var result = new object();
        object.prototype = undefined;
        return result;
      };
    }();

    var _baseCreate = baseCreate$1;

    var baseCreate = _baseCreate,
        getPrototype = _getPrototype,
        isPrototype = _isPrototype;
    /**
     * Initializes an object clone.
     *
     * @private
     * @param {Object} object The object to clone.
     * @returns {Object} Returns the initialized clone.
     */

    function initCloneObject$1(object) {
      return typeof object.constructor == 'function' && !isPrototype(object) ? baseCreate(getPrototype(object)) : {};
    }

    var _initCloneObject = initCloneObject$1;

    var getTag$3 = _getTag,
        isObjectLike$2 = isObjectLike_1;
    /** `Object#toString` result references. */

    var mapTag$2 = '[object Map]';
    /**
     * The base implementation of `_.isMap` without Node.js optimizations.
     *
     * @private
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a map, else `false`.
     */

    function baseIsMap$1(value) {
      return isObjectLike$2(value) && getTag$3(value) == mapTag$2;
    }

    var _baseIsMap = baseIsMap$1;

    var baseIsMap = _baseIsMap,
        baseUnary$1 = _baseUnary,
        nodeUtil$1 = _nodeUtil.exports;
    /* Node.js helper references. */

    var nodeIsMap = nodeUtil$1 && nodeUtil$1.isMap;
    /**
     * Checks if `value` is classified as a `Map` object.
     *
     * @static
     * @memberOf _
     * @since 4.3.0
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a map, else `false`.
     * @example
     *
     * _.isMap(new Map);
     * // => true
     *
     * _.isMap(new WeakMap);
     * // => false
     */

    var isMap$1 = nodeIsMap ? baseUnary$1(nodeIsMap) : baseIsMap;
    var isMap_1 = isMap$1;

    var getTag$2 = _getTag,
        isObjectLike$1 = isObjectLike_1;
    /** `Object#toString` result references. */

    var setTag$2 = '[object Set]';
    /**
     * The base implementation of `_.isSet` without Node.js optimizations.
     *
     * @private
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a set, else `false`.
     */

    function baseIsSet$1(value) {
      return isObjectLike$1(value) && getTag$2(value) == setTag$2;
    }

    var _baseIsSet = baseIsSet$1;

    var baseIsSet = _baseIsSet,
        baseUnary = _baseUnary,
        nodeUtil = _nodeUtil.exports;
    /* Node.js helper references. */

    var nodeIsSet = nodeUtil && nodeUtil.isSet;
    /**
     * Checks if `value` is classified as a `Set` object.
     *
     * @static
     * @memberOf _
     * @since 4.3.0
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a set, else `false`.
     * @example
     *
     * _.isSet(new Set);
     * // => true
     *
     * _.isSet(new WeakSet);
     * // => false
     */

    var isSet$1 = nodeIsSet ? baseUnary(nodeIsSet) : baseIsSet;
    var isSet_1 = isSet$1;

    var Stack$2 = _Stack,
        arrayEach = _arrayEach,
        assignValue = _assignValue,
        baseAssign = _baseAssign,
        baseAssignIn = _baseAssignIn,
        cloneBuffer = _cloneBuffer.exports,
        copyArray = _copyArray,
        copySymbols = _copySymbols,
        copySymbolsIn = _copySymbolsIn,
        getAllKeys$1 = _getAllKeys,
        getAllKeysIn = _getAllKeysIn,
        getTag$1 = _getTag,
        initCloneArray = _initCloneArray,
        initCloneByTag = _initCloneByTag,
        initCloneObject = _initCloneObject,
        isArray$1 = isArray_1,
        isBuffer$1 = isBuffer$3.exports,
        isMap = isMap_1,
        isObject$2 = isObject_1,
        isSet = isSet_1,
        keys$2 = keys_1,
        keysIn = keysIn_1;
    /** Used to compose bitmasks for cloning. */

    var CLONE_DEEP_FLAG$2 = 1,
        CLONE_FLAT_FLAG = 2,
        CLONE_SYMBOLS_FLAG = 4;
    /** `Object#toString` result references. */

    var argsTag$1 = '[object Arguments]',
        arrayTag$1 = '[object Array]',
        boolTag$1 = '[object Boolean]',
        dateTag$1 = '[object Date]',
        errorTag$1 = '[object Error]',
        funcTag = '[object Function]',
        genTag = '[object GeneratorFunction]',
        mapTag$1 = '[object Map]',
        numberTag$1 = '[object Number]',
        objectTag$1 = '[object Object]',
        regexpTag$1 = '[object RegExp]',
        setTag$1 = '[object Set]',
        stringTag$1 = '[object String]',
        symbolTag$1 = '[object Symbol]',
        weakMapTag = '[object WeakMap]';
    var arrayBufferTag$1 = '[object ArrayBuffer]',
        dataViewTag$1 = '[object DataView]',
        float32Tag = '[object Float32Array]',
        float64Tag = '[object Float64Array]',
        int8Tag = '[object Int8Array]',
        int16Tag = '[object Int16Array]',
        int32Tag = '[object Int32Array]',
        uint8Tag = '[object Uint8Array]',
        uint8ClampedTag = '[object Uint8ClampedArray]',
        uint16Tag = '[object Uint16Array]',
        uint32Tag = '[object Uint32Array]';
    /** Used to identify `toStringTag` values supported by `_.clone`. */

    var cloneableTags = {};
    cloneableTags[argsTag$1] = cloneableTags[arrayTag$1] = cloneableTags[arrayBufferTag$1] = cloneableTags[dataViewTag$1] = cloneableTags[boolTag$1] = cloneableTags[dateTag$1] = cloneableTags[float32Tag] = cloneableTags[float64Tag] = cloneableTags[int8Tag] = cloneableTags[int16Tag] = cloneableTags[int32Tag] = cloneableTags[mapTag$1] = cloneableTags[numberTag$1] = cloneableTags[objectTag$1] = cloneableTags[regexpTag$1] = cloneableTags[setTag$1] = cloneableTags[stringTag$1] = cloneableTags[symbolTag$1] = cloneableTags[uint8Tag] = cloneableTags[uint8ClampedTag] = cloneableTags[uint16Tag] = cloneableTags[uint32Tag] = true;
    cloneableTags[errorTag$1] = cloneableTags[funcTag] = cloneableTags[weakMapTag] = false;
    /**
     * The base implementation of `_.clone` and `_.cloneDeep` which tracks
     * traversed objects.
     *
     * @private
     * @param {*} value The value to clone.
     * @param {boolean} bitmask The bitmask flags.
     *  1 - Deep clone
     *  2 - Flatten inherited properties
     *  4 - Clone symbols
     * @param {Function} [customizer] The function to customize cloning.
     * @param {string} [key] The key of `value`.
     * @param {Object} [object] The parent object of `value`.
     * @param {Object} [stack] Tracks traversed objects and their clone counterparts.
     * @returns {*} Returns the cloned value.
     */

    function baseClone$2(value, bitmask, customizer, key, object, stack) {
      var result,
          isDeep = bitmask & CLONE_DEEP_FLAG$2,
          isFlat = bitmask & CLONE_FLAT_FLAG,
          isFull = bitmask & CLONE_SYMBOLS_FLAG;

      if (customizer) {
        result = object ? customizer(value, key, object, stack) : customizer(value);
      }

      if (result !== undefined) {
        return result;
      }

      if (!isObject$2(value)) {
        return value;
      }

      var isArr = isArray$1(value);

      if (isArr) {
        result = initCloneArray(value);

        if (!isDeep) {
          return copyArray(value, result);
        }
      } else {
        var tag = getTag$1(value),
            isFunc = tag == funcTag || tag == genTag;

        if (isBuffer$1(value)) {
          return cloneBuffer(value, isDeep);
        }

        if (tag == objectTag$1 || tag == argsTag$1 || isFunc && !object) {
          result = isFlat || isFunc ? {} : initCloneObject(value);

          if (!isDeep) {
            return isFlat ? copySymbolsIn(value, baseAssignIn(result, value)) : copySymbols(value, baseAssign(result, value));
          }
        } else {
          if (!cloneableTags[tag]) {
            return object ? value : {};
          }

          result = initCloneByTag(value, tag, isDeep);
        }
      } // Check for circular references and return its corresponding clone.


      stack || (stack = new Stack$2());
      var stacked = stack.get(value);

      if (stacked) {
        return stacked;
      }

      stack.set(value, result);

      if (isSet(value)) {
        value.forEach(function (subValue) {
          result.add(baseClone$2(subValue, bitmask, customizer, subValue, value, stack));
        });
      } else if (isMap(value)) {
        value.forEach(function (subValue, key) {
          result.set(key, baseClone$2(subValue, bitmask, customizer, key, value, stack));
        });
      }

      var keysFunc = isFull ? isFlat ? getAllKeysIn : getAllKeys$1 : isFlat ? keysIn : keys$2;
      var props = isArr ? undefined : keysFunc(value);
      arrayEach(props || value, function (subValue, key) {
        if (props) {
          key = subValue;
          subValue = value[key];
        } // Recursively populate clone (susceptible to call stack limits).


        assignValue(result, key, baseClone$2(subValue, bitmask, customizer, key, value, stack));
      });
      return result;
    }

    var _baseClone = baseClone$2;

    /**
     * The base implementation of `_.conformsTo` which accepts `props` to check.
     *
     * @private
     * @param {Object} object The object to inspect.
     * @param {Object} source The object of property predicates to conform to.
     * @returns {boolean} Returns `true` if `object` conforms, else `false`.
     */

    function baseConformsTo$1(object, source, props) {
      var length = props.length;

      if (object == null) {
        return !length;
      }

      object = Object(object);

      while (length--) {
        var key = props[length],
            predicate = source[key],
            value = object[key];

        if (value === undefined && !(key in object) || !predicate(value)) {
          return false;
        }
      }

      return true;
    }

    var _baseConformsTo = baseConformsTo$1;

    var baseConformsTo = _baseConformsTo,
        keys$1 = keys_1;
    /**
     * The base implementation of `_.conforms` which doesn't clone `source`.
     *
     * @private
     * @param {Object} source The object of property predicates to conform to.
     * @returns {Function} Returns the new spec function.
     */

    function baseConforms$1(source) {
      var props = keys$1(source);
      return function (object) {
        return baseConformsTo(object, source, props);
      };
    }

    var _baseConforms = baseConforms$1;

    var baseClone$1 = _baseClone,
        baseConforms = _baseConforms;
    /** Used to compose bitmasks for cloning. */

    var CLONE_DEEP_FLAG$1 = 1;
    /**
     * Creates a function that invokes the predicate properties of `source` with
     * the corresponding property values of a given object, returning `true` if
     * all predicates return truthy, else `false`.
     *
     * **Note:** The created function is equivalent to `_.conformsTo` with
     * `source` partially applied.
     *
     * @static
     * @memberOf _
     * @since 4.0.0
     * @category Util
     * @param {Object} source The object of property predicates to conform to.
     * @returns {Function} Returns the new spec function.
     * @example
     *
     * var objects = [
     *   { 'a': 2, 'b': 1 },
     *   { 'a': 1, 'b': 2 }
     * ];
     *
     * _.filter(objects, _.conforms({ 'b': function(n) { return n > 1; } }));
     * // => [{ 'a': 1, 'b': 2 }]
     */

    function conforms(source) {
      return baseConforms(baseClone$1(source, CLONE_DEEP_FLAG$1));
    }

    var conforms_1 = conforms;

    var $Activation$1 = usModule((_require, exports) => {
        /** Checks to see if the source is activated. */
        const isActivated = conforms_1({
            activated: (v) => v === true,
            activations: (v) => v instanceof Map
        });
        /** Checks to see if the source is not activated. */
        const isRejected = conforms_1({
            activated: (v) => v === false,
            activations: (v) => v instanceof Map
        });
        return Object.assign(exports, {
            isActivated,
            isRejected
        });
    });

    var $BiasGroups$1 = usModule((_require, exports) => {
        const whenActive = (biasGroup) => !biasGroup.whenInactive;
        const whenInactive = (biasGroup) => biasGroup.whenInactive;
        const hasValidPhrase = (biasGroup) => biasGroup.enabled && Boolean(biasGroup.phrases.length);
        const isBiased = conforms_1({
            entry: conforms_1({
                fieldConfig: conforms_1({
                    // Need a non-empty array to qualify.
                    loreBiasGroups: (v) => isArray$4(v) && Boolean(v.length)
                })
            })
        });
        return Object.assign(exports, {
            whenActive,
            whenInactive,
            hasValidPhrase,
            isBiased
        });
    });

    var $Categories = usModule((_require, exports) => {
        /** Checks to see if the entry of `source` has a `category` field. */
        const isCategorized = conforms_1({
            entry: conforms_1({
                fieldConfig: conforms_1({
                    // Need a non-empty string to qualify.
                    category: (v) => isString(v) && Boolean(v)
                })
            })
        });
        const isBiasedCategory = conforms_1({
            categoryBiasGroups: (v) => isArray$4(v) && Boolean(v.length)
        });
        const isSubContextCategory = conforms_1({
            createSubcontext: (v) => v === true,
            subcontextSettings: (v) => !isUndefined(v)
        });
        return Object.assign(exports, {
            isCategorized,
            isBiasedCategory,
            isSubContextCategory
        });
    });

    var $Selection$1 = usModule((_require, exports) => {
        /** Gets the budget stats we'll need for reporting later. */
        const asBudgeted = async (source) => Object.assign(source, { budgetStats: await source.entry.getStats() });
        /** Checks to see if `source` has a `budgetStats` field. */
        const isBudgetedSource = conforms_1({
            budgetStats: isInstance,
            activated: (v) => v === true
        });
        const isWeightedSource = dew(() => {
            const _check = conforms_1({
                selectionIndex: isNumber
            });
            const _impl = (source) => isBudgetedSource(source) && _check(source);
            return _impl;
        });
        /** Gets some budget stats from an insertable source. */
        const getBudgetStats = async (source) => {
            if (isBudgetedSource(source))
                return source.budgetStats;
            return {
                tokenBudget: (await source.entry.trimmed)?.tokens.length ?? 0,
                actualReservedTokens: 0
            };
        };
        return Object.assign(exports, {
            asBudgeted,
            isBudgetedSource,
            isWeightedSource,
            getBudgetStats
        });
    });

    /** Sorts sources by their budget priority, descending. */
    const budgetPriority = () => (a, b) => {
        const { budgetPriority: ap } = a.entry.contextConfig;
        const { budgetPriority: bp } = b.entry.contextConfig;
        return bp - ap;
    };

    var $SelectionIndex = usModule((require, exports) => {
        const { isWeightedSource } = $Selection$1(require);
        /**
         * Sorts sources by their `selectionIndex`, if they have one.
         *
         * If any source lacks a `selectionIndex`, they are treated equally.
         */
        const selectionIndex = () => {
            return (a, b) => {
                if (!isWeightedSource(a))
                    return 0;
                if (!isWeightedSource(b))
                    return 0;
                return a.selectionIndex - b.selectionIndex;
            };
        };
        return Object.assign(exports, { selectionIndex });
    });

    class LoreEntryHelpers$1 extends ModuleDef {
        constructor() {
            super(...arguments);
            this.moduleId = 33718;
            this.expectedExports = 5;
            this.mapping = {
                "nn": ["tryParseRegex", "function"],
                "P5": ["checkActivation", "function"]
            };
        }
    }
    var LoreEntryHelpers$2 = new LoreEntryHelpers$1();

    /** A {@link Subject} that signals the start of context construction. */
    new Subject();
    /** A {@link Subject} that signals the end of context construction. */
    const onEndContext = new Subject();

    /**
     * A service that handles the parsing of NovelAI's lorebook keys.
     *
     * It provides a short-lived caching layer to reduce parsing overhead
     * between individual context requests.  By short-lived, I mean that
     * if it wasn't used during the latest context request, it will be
     * discarded afterward.
     *
     * Currently supports:
     * - Simple keys (e.g. `king` `kingdom`)
     * - Regular expression keys (e.g. `/\bking(dom)?\b/i`)
     */
    const logger$3 = createLogger("Matcher Service");
    const RE_ESCAPE = /[$()*+.?[\\\]^{|}]/g;
    const RE_UNSAFE_LEADING = /^\W/;
    const RE_UNSAFE_TRAILING = /\W$/;
    var $MatcherService = usModule((require, exports) => {
        const loreEntryHelpers = require(LoreEntryHelpers$2);
        /** A set of keys used for matching since the last maintenance cycle. */
        let usedKeysCache = new Set();
        /** The internal matcher cache of the service. */
        const matcherCache = new Map();
        /** Event for when the used keys are being cleared. */
        const onMaintainMatchers = onEndContext.pipe(map(() => {
            const keysUsed = usedKeysCache;
            usedKeysCache = new Set();
            return keysUsed;
        }), share());
        /** Discards any matcher functions that were not used since last cycle. */
        onMaintainMatchers.subscribe((lastKeysUsed) => {
            const startSize = matcherCache.size;
            for (const key of matcherCache.keys())
                if (!lastKeysUsed.has(key))
                    matcherCache.delete(key);
            logger$3.info(`Cleared ${startSize - matcherCache.size} unused matchers.`);
        });
        const escapeForRegex = (str) => str.replace(RE_ESCAPE, "\\$&");
        /** Checks if the start is safe for the word boundary `\b` check. */
        const leading = (key) => RE_UNSAFE_LEADING.test(key) ? "" : "\\b";
        /** Checks if the end is safe for the word boundary `\b` check. */
        const trailing = (key) => RE_UNSAFE_TRAILING.test(key) ? "" : "\\b";
        /**
         * A semi-reimplementation of an internal NAI method.
         *
         * The original also allowed you to optionally force the global flag, but
         * since this system always finds all matches in the text, we don't need
         * to make that an option.
         */
        function toRegex(key) {
            const parseResult = loreEntryHelpers.tryParseRegex(key);
            if (!parseResult.isRegex) {
                const escapedKey = escapeForRegex(key.trim());
                const newSource = `${leading(key)}${escapedKey}${trailing(key)}`;
                return [new RegExp(newSource, "iug"), "simple"];
            }
            return [new RegExp(parseResult.regex, `${parseResult.flags.join("")}g`), "regex"];
        }
        const toMatchResult = (source) => (regexExec) => {
            const [match, ...groups] = regexExec;
            return Object.freeze({
                source, match,
                groups: Object.freeze(groups),
                index: assertExists("Expected an index.", regexExec.index),
                length: match.length,
                namedGroups: Object.freeze({ ...regexExec?.groups })
            });
        };
        /** Adds a key to the list of used keys. */
        function markKeyAsUsed(key) {
            usedKeysCache.add(key);
        }
        /** Gets a {@link MatcherFn matcher function} given a string. */
        function getMatcherFor(key) {
            usedKeysCache.add(key);
            const cached = matcherCache.get(key);
            if (cached)
                return cached;
            // For now, the only matcher we support is regex.  We wrap it up in a
            // function so that we can maybe add new ones in the future.
            const matcher = dew(() => {
                const [regex, type] = toRegex(key);
                // Regular expressions are unsafe to use in single-line mode.
                const multiline = type === "regex";
                // Build the result transformer.
                const toResult = toMatchResult(key);
                const impl = (haystack, mode = "all") => {
                    // Make sure the regex internal state is reset.
                    regex.lastIndex = 0;
                    switch (mode) {
                        case "all": {
                            return Array.from(haystack.matchAll(regex)).map(toResult);
                        }
                        case "first": {
                            const match = regex.exec(haystack);
                            return match ? [toResult(match)] : [];
                        }
                        case "last": {
                            let lastMatch = null;
                            for (const match of haystack.matchAll(regex))
                                lastMatch = match;
                            return lastMatch ? [toResult(lastMatch)] : [];
                        }
                        default:
                            return [];
                    }
                };
                return Object.assign(impl, { source: key, type, multiline });
            });
            matcherCache.set(key, matcher);
            return matcher;
        }
        return Object.assign(exports, {
            onMaintainMatchers,
            markKeyAsUsed,
            getMatcherFor
        });
    });

    /**
     * Provides keyword matching services with an expandable cache.
     * Maintains its internal caches after every context constructed,
     * resizing them so that they hold the memoized match results of
     * around `n * 1.1` pieces of text that were previously searched.
     *
     * Scaling down the size is done over time using the formula:
     * `nextSize = (currentSize + (totalSearches * 1.1)) / 2`
     *
     * It will discard match data for the oldest text that had not
     * been provided for matching.
     */
    const logger$2 = createLogger("Search Service");
    const RETENTION_RATE = 1.1;
    var SearchService = usModule((require, exports) => {
        const matcherService = $MatcherService(require);
        const splitterService = $TextSplitterService(require);
        const cursors = $Cursors(require);
        const queryOps = $QueryOps(require);
        /** A set of texts search since the last maintenance cycle. */
        let textsSearched = new Set();
        /** The internal results cache of the service. */
        let resultsCache = new Map();
        /** Handles rescaling of the cache. */
        function rescaleCache() {
            const totalUnique = textsSearched.size;
            const curSize = resultsCache.size;
            // Maintain an overflow of 110% the demand placed on the service.
            const desiredOverflow = ((totalUnique * RETENTION_RATE) - totalUnique) | 0;
            // But we'll keep a minimum size of 50 entries.  That's actually
            // NAI's vanilla retainment for their memoization.
            const idealSize = Math.max(50, totalUnique + desiredOverflow);
            // If the cache is already within bounds of the ideal, do nothing.
            if (curSize <= idealSize)
                return;
            // When rescaling, we do it over several runs.  This better accommodates
            // undo/redo and other kinds of story manipulation the user may do.
            const nextSize = Math.floor((curSize + idealSize) / 2);
            // Sanity check; we only need to rescale if we're shrinking the cache.
            if (nextSize >= curSize)
                return;
            // The cache has been maintained with an order from least-recently-seen
            // to most-recently-seen.  We should be able to just take the last entries
            // to discard an amount of least-recently-seen entries.
            const retainedEntries = [...resultsCache].slice(-nextSize);
            resultsCache = new Map(retainedEntries);
            {
                // Because this map is mutated, I want to make sure the console gets
                // an isolated instance.
                logger$2.info("Cache state:", new Map(retainedEntries));
                logger$2.info({ curSize, idealSize, nextSize });
            }
        }
        /** Discards results for keys that were not seen since last cycle. */
        function discardUnusedResults(keysUsed) {
            // Just delete all results for keys that were not searched in the last run.
            // In the case of long-living results, this keeps them from growing out of
            // control and hogging a bunch of memory.
            for (const [text, results] of resultsCache) {
                for (const key of results.keys())
                    if (!keysUsed.has(key))
                        results.delete(key);
                // If it's now empty, delete the entry.
                if (results.size === 0)
                    resultsCache.delete(text);
            }
        }
        /** Performs maintenance on the cache. */
        matcherService.onMaintainMatchers.subscribe((keysUsed) => {
            rescaleCache();
            discardUnusedResults(keysUsed);
            // Setup for the next run-through.
            textsSearched = new Set();
        });
        /** Internal function that actually does the searching. */
        function doMatching(textToSearch, matchers) {
            if (!matchers.length)
                return new Map();
            const cachedResults = resultsCache.get(textToSearch) ?? new Map();
            const searchResults = new Map();
            for (const matcher of matchers) {
                const { source } = matcher;
                const cached = cachedResults.get(source);
                if (cached) {
                    // Only add the result if it has at least one match.
                    if (cached.length)
                        searchResults.set(source, cached);
                    continue;
                }
                // These results are shared; make sure the array is immutable.
                const results = Object.freeze(matcher(textToSearch));
                // We do want to store empty results in the cache, but we will omit
                // them from the search result.
                if (results.length)
                    searchResults.set(source, results);
                cachedResults.set(source, results);
            }
            if (!textsSearched.has(textToSearch)) {
                textsSearched.add(textToSearch);
                // Shift this text so it'll be reinserted at the end.  We only need
                // to do this once as that's enough to preserve the data into the
                // next run.
                resultsCache.delete(textToSearch);
            }
            resultsCache.set(textToSearch, cachedResults);
            return searchResults;
        }
        /** Internal function that acts as the entry point to searching. */
        function findMatches(haystack, matchers) {
            if (isString(haystack))
                return doMatching(haystack, matchers);
            // For fragments, we need to apply the offset to the results so
            // they line up with the fragment's source string.
            const { content, offset } = haystack;
            const theResults = doMatching(content, matchers);
            for (const [k, raw] of theResults) {
                if (raw.length === 0)
                    continue;
                theResults.set(k, raw.map((m) => ({ ...m, index: offset + m.index })));
            }
            return theResults;
        }
        /** Makes sure we have an iterable of strings from something matchable. */
        function getKeys(v) {
            checks: {
                if (isIterable(v))
                    return v;
                if (!("fieldConfig" in v))
                    break checks;
                if (!("keys" in v.fieldConfig))
                    break checks;
                return v.fieldConfig.keys;
            }
            return [];
        }
        function doSearching(
        /** Text used for full-text searching. */
        fullText, 
        /** Text used for per-line searching; provide `undefined` to force full-text. */
        lineText, 
        /** The set of keys, or something that can provide keys, to match with. */
        matchable) {
            // No need to partition the matchers if we're only doing full-text.
            if (lineText == null)
                return {
                    matchFull: findMatches(fullText, [...mapIter(getKeys(matchable), matcherService.getMatcherFor)]),
                    matchLine: new Map()
                };
            const { matchFull = [], matchLine = [] } = chain(getKeys(matchable))
                .map(matcherService.getMatcherFor)
                .map((m) => [m.multiline ? "matchFull" : "matchLine", m])
                .thru(partition)
                .value(fromPairs);
            return {
                matchFull: dew(() => {
                    if (!matchFull.length)
                        return new Map();
                    return findMatches(fullText, matchFull);
                }),
                matchLine: dew(() => {
                    if (!matchLine.length)
                        return new Map();
                    return chain(lineText)
                        .flatMap(splitterService.byLine)
                        .filter(splitterService.hasWords)
                        .flatMap((f) => findMatches(f, matchLine))
                        .value((kvps) => new Map(kvps));
                })
            };
        }
        const toAssemblyResult = (assembly, type) => (theMatch) => {
            return Object.freeze(Object.assign(Object.create(theMatch), {
                selection: cursors.toSelection(theMatch, assembly, type)
            }));
        };
        /**
         * Searches `assembly` using the given `matchable`, which will source the
         * matchers necessary to perform the search.
         */
        function search(
        /** The assembly to search. */
        assembly, 
        /** The set of keys, or something that can provide keys, to match with. */
        matchable, 
        /**
         * Whether to force full-text mode for all matchers.  Generally best
         * to provide `true` for text that is expected to be generally static.
         */
        forceFullText = false) {
            const fullText = queryOps.getText(assembly);
            const lineText = forceFullText ? undefined : queryOps.iterateOn(assembly);
            const results = doSearching(fullText, lineText, matchable);
            // We need to convert these matches into a variant using the more
            // generalized cursors.
            const fullResultFn = toAssemblyResult(assembly, "fullText");
            const lineResultFn = toAssemblyResult(assembly, "fragment");
            return new Map(concat(mapValuesOf(results.matchFull, (m) => Object.freeze(m.map(fullResultFn))), mapValuesOf(results.matchLine, (m) => Object.freeze(m.map(lineResultFn)))));
        }
        /**
         * Searches `text` using the given `matchable`, which will source the
         * matchers necessary to perform the search.
         */
        function searchText(
        /** The text or fragment to search. */
        textToSearch, 
        /** The set of keys, or something that can provide keys, to match with. */
        matchable, 
        /**
         * Whether to force full-text mode for all matchers.  Generally best
         * to provide `true` for text that is expected to be generally static.
         */
        forceFullText = false) {
            const fullText = textToSearch;
            const lineText = forceFullText ? undefined : [textToSearch];
            const { matchFull, matchLine } = doSearching(fullText, lineText, matchable);
            // For regular text searches, we can just merge the results.
            return new Map([...matchFull, ...matchLine]);
        }
        /**
         * Searches `assembly` using the collective keys of `entries`.  This is
         * a little faster than calling {@link search search()} with each entry
         * individually as the matchers can be batched.
         */
        function searchForLore(
        /** The text-like thing to search. */
        assembly, 
        /** The entries to include in the search. */
        entries, 
        /**
         * Whether to force full-text mode for all matchers.  Generally best
         * to provide `true` for text that is expected to be static.
         */
        forceFullText = false) {
            // We just need to grab all the keys from the entries and pull their
            // collective matches.  We'll only run each key once.
            const keySet = new Set(flatMap(entries, getKeys));
            const keyResults = search(assembly, keySet, forceFullText);
            // Now, we can just grab the results for each entry's keys and assemble
            // the results into a final map.
            const entryResults = new Map();
            for (const entry of entries) {
                const entryResult = new Map();
                for (const key of entry.fieldConfig.keys) {
                    const result = keyResults.get(key);
                    if (!result?.length)
                        continue;
                    entryResult.set(key, result);
                }
                entryResults.set(entry, entryResult);
            }
            return entryResults;
        }
        function findLowestIndex(results) {
            if (!results)
                return undefined;
            return chain(results)
                .collect(([k, v]) => {
                const first$1 = first(v);
                return first$1 ? [k, first$1] : undefined;
            })
                .value((kvps) => {
                let best = undefined;
                for (const kvp of kvps) {
                    checks: {
                        if (!best)
                            break checks;
                        if (kvp[1].index < best[1].index)
                            break checks;
                        continue;
                    }
                    best = kvp;
                }
                return best;
            });
        }
        function findHighestIndex(results) {
            if (!results)
                return undefined;
            return chain(results)
                .collect(([k, v]) => {
                const last$1 = last(v);
                return last$1 ? [k, last$1] : undefined;
            })
                .value((kvps) => {
                let best = undefined;
                for (const kvp of kvps) {
                    checks: {
                        if (!best)
                            break checks;
                        if (kvp[1].index > best[1].index)
                            break checks;
                        continue;
                    }
                    best = kvp;
                }
                return best;
            });
        }
        /**
         * Finds the first key in `entryKeys` with a valid match.
         * This emulates NovelAI's "fail fast" search order that it uses in quick-checks.
         */
        const findLowestInOrder = (results, entryKeys) => {
            if (!results.size)
                return undefined;
            if (!entryKeys.length)
                return undefined;
            for (const key of entryKeys)
                if (results.get(key)?.length)
                    return key;
            return undefined;
        };
        /** Build a result for NAI that represents a failure or quick-check result. */
        const makeQuickResult = (index, key = "") => ({ key, length: 0, index });
        /**
         * A replacement for {@link LoreEntryHelpers.checkActivation} that allows it
         * to make use of this service instead.
         *
         * Good for testing and benefits from the same caching layer.
         */
        function naiCheckActivation(
        /** The lorebook entry to check. */
        entry, 
        /** The text available to search for keyword matches. */
        textToSearch, 
        /**
         * Whether to do a quick test only.  When `true` and a match is found,
         * this will return a result where `index` and `length` are both `0`.
         * Only the `key` property is really of use.  Defaults to `false`.
         */
        quickCheck, 
        /** An object providing an alternative `searchRange` to use. */
        searchRangeDonor, 
        /**
         * Forces an entry that would force-activate to instead check its keys.
         * The entry must still be enabled.  Defaults to `false`.
         */
        forceKeyChecks) {
            if (!entry.enabled)
                return makeQuickResult(-1);
            if (entry.forceActivation && !forceKeyChecks)
                return makeQuickResult(Number.POSITIVE_INFINITY);
            const searchRange = searchRangeDonor?.searchRange ?? entry.searchRange;
            const textFragment = dew(() => {
                // No offset correction for whole string searches.
                if (searchRange >= textToSearch.length)
                    return textToSearch;
                const content = textToSearch.slice(-1 * searchRange);
                // No offset correction for quick checks.
                if (quickCheck)
                    return content;
                return splitterService.createFragment(content, textToSearch.length - content.length);
            });
            const results = searchText(textFragment, entry.keys);
            if (quickCheck) {
                const bestKey = findLowestInOrder(results, entry.keys);
                const offset = Math.max(0, textToSearch.length - searchRange);
                return makeQuickResult(bestKey ? offset : -1, bestKey);
            }
            // Locate the the result with the highest index.
            const kvpHi = findHighestIndex(results);
            if (!kvpHi)
                return makeQuickResult(-1);
            const [bestKey, bestMatch] = kvpHi;
            let { index, length } = bestMatch;
            // A special case for non-regex keys where they have 0 to 2 capture groups.
            // I'm not sure what the purpose here is.  There is the special code-point
            // checks in `toRegex`; there's some non-capturing groups used in those.
            // Perhaps this was once used by that but has since been disabled by
            // making those groups non-capturing?
            if (matcherService.getMatcherFor(bestKey).type !== "regex")
                return {
                    key: bestKey,
                    index: (bestMatch.groups[0]?.length ?? 0) + index,
                    length: bestMatch.groups[1]?.length ?? length
                };
            // We have another special case here using a named capture group called `hl`.
            // A feature not really detailed outside the Discord group, this "highlight"
            // feature allows you to narrow the portion of text that is used for the match.
            // I believe this was intended for story-text highlighting, but it can clearly
            // also affect key-relative insertion positions as well.
            if ("hl" in bestMatch.namedGroups) {
                const highlight = bestMatch.namedGroups["hl"];
                index += bestMatch.match.indexOf(highlight);
                length = highlight.length;
            }
            return { key: bestKey, index, length };
        }
        return Object.assign(exports, {
            getKeys,
            search,
            searchText,
            searchForLore,
            findLowestIndex,
            findHighestIndex,
            naiCheckActivation
        });
    });

    const isAdjacentResult = (result) => result.type !== "inside";
    const isSuccessResult = (result) => result.type === "inside";
    const getInsertionData = (source) => {
        const { fieldConfig, contextConfig } = source.entry;
        const { insertionType, insertionPosition } = contextConfig;
        const direction = insertionPosition < 0 ? "toTop" : "toBottom";
        const remOffset = direction === "toTop" ? 1 : 0;
        const isKeyRelative = Boolean(fieldConfig?.keyRelative ?? false);
        const offset = Math.abs(insertionPosition + remOffset);
        return { insertionType, direction, offset, isKeyRelative };
    };
    function toLocation(data, matchedKey) {
        if (!matchedKey)
            return Object.freeze({ ...data, isKeyRelative: false });
        return Object.freeze({ ...data, isKeyRelative: true, matchedKey });
    }
    const theModule$3 = usModule((require, exports) => {
        var _CompoundAssembly_instances, _CompoundAssembly_groups, _CompoundAssembly_knownSources, _CompoundAssembly_textToSource, _CompoundAssembly_codec, _CompoundAssembly_assemblies, _CompoundAssembly_tokens, _CompoundAssembly_tokenBudget, _CompoundAssembly_getActivator, _CompoundAssembly_handleSelection, _CompoundAssembly_findStart, _CompoundAssembly_getAssembly, _CompoundAssembly_makeTarget, _CompoundAssembly_doInsertInitial, _CompoundAssembly_doInsertAdjacent, _CompoundAssembly_doShuntOut, _CompoundAssembly_doInsertInside, _CompoundAssembly_iterateInsertion;
        const { REASONS } = require(ContextBuilder$2);
        const { findHighestIndex } = SearchService(require);
        const ss = $TextSplitterService(require);
        const tokenized = theModule$5(require);
        const baseReject = { type: "rejected", tokensUsed: 0, shunted: 0 };
        const NO_TEXT = Object.freeze({ ...baseReject, reason: REASONS.NoText });
        const NO_SPACE = Object.freeze({ ...baseReject, reason: REASONS.NoSpace });
        const NO_KEY = Object.freeze({ ...baseReject, reason: REASONS.NoContextKey });
        const toTokens = (f) => f.tokens;
        const toAssembly = async (codec, inserted) => {
            if (inserted instanceof CompoundAssembly)
                return await inserted.toAssembly();
            if (tokenized.isInstance(inserted))
                return inserted;
            return await tokenized.castTo(codec, inserted);
        };
        /**
         * This class tracks and assists the context assembly process, tracking
         * consumed tokens and handling the insertion of {@link ContextContent}
         * into the location it needs to be.
         *
         * This is essentially a collection of {@link TokenizedAssembly}.
         *
         * Unlike a normal assembly, this type of assembly is not immutable and
         * does not work with the standard assembly operators.
         */
        class CompoundAssembly {
            constructor(codec, tokenBudget) {
                _CompoundAssembly_instances.add(this);
                _CompoundAssembly_groups.set(this, void 0);
                _CompoundAssembly_knownSources.set(this, void 0);
                _CompoundAssembly_textToSource.set(this, void 0);
                _CompoundAssembly_codec.set(this, void 0);
                _CompoundAssembly_assemblies.set(this, void 0);
                _CompoundAssembly_tokens.set(this, void 0);
                _CompoundAssembly_tokenBudget.set(this, void 0);
                __classPrivateFieldSet(this, _CompoundAssembly_codec, codec, "f");
                __classPrivateFieldSet(this, _CompoundAssembly_tokenBudget, tokenBudget, "f");
                __classPrivateFieldSet(this, _CompoundAssembly_assemblies, [], "f");
                __classPrivateFieldSet(this, _CompoundAssembly_tokens, [], "f");
                __classPrivateFieldSet(this, _CompoundAssembly_groups, new Set(), "f");
                __classPrivateFieldSet(this, _CompoundAssembly_knownSources, new Set(), "f");
                __classPrivateFieldSet(this, _CompoundAssembly_textToSource, new Map(), "f");
            }
            /** The codec used to encode the tokens in this assembly. */
            get codec() {
                return __classPrivateFieldGet(this, _CompoundAssembly_codec, "f");
            }
            /**
             * The assemblies that make up this assembly.
             *
             * Do not mutate this array directly.  Don't do it!
             */
            get assemblies() {
                // Scout's honor you won't mutate this array.
                return __classPrivateFieldGet(this, _CompoundAssembly_assemblies, "f");
            }
            /** The full, concatenated text of the assembly. */
            get text() {
                return __classPrivateFieldGet(this, _CompoundAssembly_assemblies, "f").map((a) => a.text).join("");
            }
            /** The current tokens of the assembly. */
            get tokens() {
                return __classPrivateFieldGet(this, _CompoundAssembly_tokens, "f");
            }
            get tokenBudget() {
                return __classPrivateFieldGet(this, _CompoundAssembly_tokenBudget, "f");
            }
            get availableTokens() {
                return Math.max(0, this.tokenBudget - this.tokens.length);
            }
            /**
             * Inserts an assembly into this compound assembly as a sub-assembly.
             */
            async insert(source, budget) {
                // Ensure the budget works for the current state of the assembly.
                budget = this.validateBudget(budget);
                // Fast-path: No budget, instant rejection.
                // We perform this check before even checking for the `NO_TEXT` case
                // to avoid the cost of the `getAssembly` call.  This can result in
                // "no space" being presented to the user when "no text" would
                // technically be more informative.
                if (!budget)
                    return NO_SPACE;
                // Fast-path: no fancy stuff for the first thing inserted.
                if (!__classPrivateFieldGet(this, _CompoundAssembly_assemblies, "f").length) {
                    const inserted = await __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_getAssembly).call(this, source.entry, budget);
                    if (!inserted)
                        return NO_SPACE;
                    // Fast-path: No content, instant rejection (unless it's a group).
                    if (inserted.contentText === "")
                        if (!(source instanceof CompoundAssembly))
                            return NO_TEXT;
                    // We'll need at least one assembly to do anything key-relative.
                    const data = getInsertionData(source);
                    if (data.isKeyRelative)
                        return NO_KEY;
                    return await __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_doInsertInitial).call(this, source, inserted, toLocation(data));
                }
                // Can we locate a place to start our search for its insertion location?
                const startState = __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_findStart).call(this, source);
                if (!startState)
                    return NO_KEY;
                // Can we fit it into the budget?
                const inserted = await __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_getAssembly).call(this, source.entry, budget);
                if (!inserted)
                    return NO_SPACE;
                // Fast-path: No content, instant rejection (unless it's a group).
                if (inserted.contentText === "")
                    if (!(source instanceof CompoundAssembly))
                        return NO_TEXT;
                for (const iterResult of __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_iterateInsertion).call(this, startState)) {
                    const { result } = iterResult;
                    switch (result.type) {
                        case "insertBefore":
                        case "insertAfter":
                            return await __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_doShuntOut).call(this, iterResult, source, inserted, result);
                        case "inside":
                            return await __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_doInsertInside).call(this, iterResult, source, inserted);
                        default:
                            throw new Error(`Unexpected insertion type: ${result.type}`);
                    }
                }
                // Should not happen, but let me know if it does.
                throw new Error("Unexpected end of iteration.");
            }
            /** Determines if an assembly has been inserted. */
            hasAssembly(assembly) {
                return __classPrivateFieldGet(this, _CompoundAssembly_assemblies, "f").includes(assembly);
            }
            /** Determines if some assembly was inserted with the given source. */
            hasSource(source) {
                return __classPrivateFieldGet(this, _CompoundAssembly_knownSources, "f").has(source);
            }
            /**
             * Called when a context-group that is contained within this assembly has
             * its tokens updated.  This brings the compound assembly's tokens up to
             * date.
             *
             * No error is thrown if the group is not yet contained within this
             * assembly; it just will not update in that case.
             */
            async updatedGroup(group) {
                // We only need to update if we have this assembly.
                if (!this.hasAssembly(group))
                    return 0;
                const newTokens = await this.mendTokens(__classPrivateFieldGet(this, _CompoundAssembly_assemblies, "f").map(toTokens));
                const diffLength = newTokens.length - __classPrivateFieldGet(this, _CompoundAssembly_tokens, "f").length;
                __classPrivateFieldSet(this, _CompoundAssembly_tokens, newTokens, "f");
                return diffLength;
            }
            /**
             * Lorebook entries can configure when they can split other entries
             * apart and if they themselves may be split apart.  This function
             * runs those checks.
             */
            canSplitInto(toInsert, toSplit) {
                // The thing being split can hard veto the split.
                const canSplit = Boolean(toSplit.contextConfig.allowInsertionInside ?? false);
                if (!canSplit)
                    return false;
                // Otherwise, the thing being inserted can explicitly choose to avoid
                // the split, but will insert if it has no opinion.
                return Boolean(toInsert.contextConfig.allowInnerInsertion ?? canSplit);
            }
            /**
             * Converts this compound assembly into a static {@link TokenizedAssembly}.
             *
             * The conversion is a destructive process.  All information about assemblies
             * that were inserted will be lost and cursors targeting those assemblies will
             * not be able to be used with this assembly.
             */
            toAssembly() {
                const { text } = this;
                return tokenized.castTo(this.codec, {
                    prefix: ss.createFragment("", 0),
                    content: Object.freeze([ss.createFragment(text, 0)]),
                    suffix: ss.createFragment("", text.length),
                    tokens: this.tokens
                });
            }
            /** Yields the structured output of the assembly. */
            *structuredOutput() {
                for (const assembly of __classPrivateFieldGet(this, _CompoundAssembly_assemblies, "f")) {
                    if (assembly instanceof CompoundAssembly) {
                        yield* assembly.structuredOutput();
                    }
                    else {
                        const { text } = assembly;
                        const { uniqueId: identifier, type } = assertExists("Expected to find source for an assembly.", this.findSource(assembly));
                        yield { identifier, type, text };
                    }
                }
            }
            /** Gets all sources that are within this compound assembly. */
            enumerateSources() {
                if (!__classPrivateFieldGet(this, _CompoundAssembly_groups, "f").size)
                    return __classPrivateFieldGet(this, _CompoundAssembly_knownSources, "f");
                return chain(__classPrivateFieldGet(this, _CompoundAssembly_groups, "f"))
                    .flatMap((c) => c.enumerateSources())
                    .prepend(__classPrivateFieldGet(this, _CompoundAssembly_knownSources, "f"))
                    .value((sources) => new Set(sources));
            }
            /**
             * Maps an assembly back to its {@link SourceLike}.
             */
            findSource(assembly) {
                // First, try the sources we are holding.
                const direct = __classPrivateFieldGet(this, _CompoundAssembly_textToSource, "f").get(assembly.source ?? assembly);
                if (direct)
                    return direct;
                // It's possible that it could be in a context-group.
                for (const asm of __classPrivateFieldGet(this, _CompoundAssembly_groups, "f")) {
                    const source = asm.findSource(assembly);
                    if (source)
                        return source;
                }
                return undefined;
            }
            /** Ensures that the provided budget works for the assembly. */
            validateBudget(budget) {
                return Math.min(this.availableTokens, budget);
            }
            /** Handle the mending of the tokens. */
            async mendTokens(tokensToMend) {
                return await this.codec.mendTokens(tokensToMend);
            }
            /** Updates the internal state for a successful insertion. */
            async updateState(newAssemblies, tokens, source, inserted) {
                const diffLength = tokens.length - __classPrivateFieldGet(this, _CompoundAssembly_tokens, "f").length;
                __classPrivateFieldSet(this, _CompoundAssembly_assemblies, newAssemblies, "f");
                __classPrivateFieldSet(this, _CompoundAssembly_tokens, tokens, "f");
                __classPrivateFieldGet(this, _CompoundAssembly_knownSources, "f").add(source);
                __classPrivateFieldGet(this, _CompoundAssembly_textToSource, "f").set(inserted.source ?? inserted, source);
                if (inserted instanceof CompoundAssembly)
                    __classPrivateFieldGet(this, _CompoundAssembly_groups, "f").add(inserted);
                // Make sure we clean up the entry.
                await source.entry.finalize?.();
                return diffLength;
            }
        }
        _CompoundAssembly_groups = new WeakMap(), _CompoundAssembly_knownSources = new WeakMap(), _CompoundAssembly_textToSource = new WeakMap(), _CompoundAssembly_codec = new WeakMap(), _CompoundAssembly_assemblies = new WeakMap(), _CompoundAssembly_tokens = new WeakMap(), _CompoundAssembly_tokenBudget = new WeakMap(), _CompoundAssembly_instances = new WeakSet(), _CompoundAssembly_getActivator = function _CompoundAssembly_getActivator(source, target) {
            const { activations } = source;
            if (!activations)
                return undefined;
            if (target.type === "story")
                return activations.get("keyed");
            return activations.get("cascade")?.matches.get(target);
        }, _CompoundAssembly_handleSelection = function _CompoundAssembly_handleSelection(selection, direction, assembly, content) {
            const cursor = cursorForDir(selection, direction);
            if (assembly.isFoundIn(cursor))
                return cursor;
            // The assembly can adapt the cursor itself.  This is used by groups
            // to convert a cursor for a sub-assembly into one for itself.
            const adapted = assembly.adaptCursor?.(cursor);
            if (adapted)
                return adapted;
            // A loose cursor is one that referenced searchable text, but that text
            // was absent from the insertable text.  If that's not the case, we can't
            // use this cursor.
            if (!content.isCursorLoose?.(cursor))
                return undefined;
            // Otherwise, we'll give it some additional leeway when used in a
            // key-relative context.
            return assembly.findBest?.(cursor);
        }, _CompoundAssembly_findStart = function _CompoundAssembly_findStart(source) {
            assert("Must have at least one assembly to find a starting location.", __classPrivateFieldGet(this, _CompoundAssembly_assemblies, "f").length > 0);
            const data = getInsertionData(source);
            if (data.isKeyRelative) {
                // We want to find the match closest to the bottom of all content
                // currently in the assembly.
                const matches = chain(this.enumerateSources())
                    .collect((origin) => {
                    const activator = __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_getActivator).call(this, source, origin);
                    if (!activator)
                        return undefined;
                    const latestMatch = findHighestIndex(activator);
                    if (!latestMatch)
                        return undefined;
                    return [origin, latestMatch[1]];
                })
                    .value((iter) => new Map(iter));
                if (matches.size === 0)
                    return undefined;
                // To get the one closest to the bottom, iterate in reverse.
                const assemblies = chain(__classPrivateFieldGet(this, _CompoundAssembly_assemblies, "f"))
                    .thru(iterPosition)
                    .thru(iterReverse)
                    .value();
                for (const [index, asm] of assemblies) {
                    const asmSource = this.findSource(asm);
                    if (!asmSource)
                        continue;
                    const matchedKey = matches.get(asmSource);
                    if (!matchedKey)
                        continue;
                    const cursor = __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_handleSelection).call(this, matchedKey.selection, data.direction, asm, asmSource.entry);
                    if (!cursor)
                        continue;
                    const target = assertExists(`Expected assembly at ${index} to exist.`, __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_makeTarget).call(this, index));
                    return {
                        cursor, source, target,
                        direction: data.direction,
                        offset: data.offset,
                        location: toLocation(data, matchedKey)
                    };
                }
                return undefined;
            }
            else {
                const index = data.direction === "toTop" ? __classPrivateFieldGet(this, _CompoundAssembly_assemblies, "f").length - 1 : 0;
                const target = assertExists(`Expected assembly at ${index} to exist.`, __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_makeTarget).call(this, index));
                // We specifically want the position without the insertion type.
                // This places the cursor at the start/end of all the text.
                const cursor = target.assembly.entryPosition(data.direction);
                return {
                    cursor, source, target,
                    direction: data.direction,
                    offset: data.offset,
                    location: toLocation(data)
                };
            }
        }, _CompoundAssembly_getAssembly = async function _CompoundAssembly_getAssembly(content, budget) {
            if (isFunction$1(content.rebudget))
                return await content.rebudget(budget);
            // If it can't rebudget, the `trimmed` assembly must both exist
            // and fit within the given budget.
            const assembly = await content.trimmed;
            if (!assembly)
                return undefined;
            if (assembly.tokens.length > budget)
                return undefined;
            return assembly;
        }, _CompoundAssembly_makeTarget = function _CompoundAssembly_makeTarget(index) {
            const assembly = __classPrivateFieldGet(this, _CompoundAssembly_assemblies, "f").at(index);
            if (!assembly)
                return undefined;
            const source = this.findSource(assembly);
            return Object.freeze({ index, assembly, source });
        }, _CompoundAssembly_doInsertInitial = async function _CompoundAssembly_doInsertInitial(source, inserted, location) {
            assert("Expected to be empty.", __classPrivateFieldGet(this, _CompoundAssembly_assemblies, "f").length === 0);
            const tokensUsed = await this.updateState([inserted], inserted.tokens, source, inserted);
            return {
                type: "initial",
                tokensUsed,
                shunted: 0,
                location,
                assembly: await toAssembly(__classPrivateFieldGet(this, _CompoundAssembly_codec, "f"), inserted)
            };
        }, _CompoundAssembly_doInsertAdjacent = 
        /** Inserts adjacent to `index`, based on `iterState.result.type`. */
        async function _CompoundAssembly_doInsertAdjacent(iterState, source, inserted, overrideType) {
            const { target, location } = iterState;
            const oldAsm = __classPrivateFieldGet(this, _CompoundAssembly_assemblies, "f");
            const type = overrideType ?? assertAs("Expected `iterState.result` to be an `InsertResult`.", isAdjacentResult, iterState.result).type;
            const index = target.index + (type === "insertAfter" ? 1 : 0);
            const asmBefore = oldAsm.slice(0, index);
            const asmAfter = oldAsm.slice(index);
            const newAsm = [...asmBefore, inserted, ...asmAfter];
            const tokens = await this.mendTokens(newAsm.map(toTokens));
            const tokensUsed = await this.updateState(newAsm, tokens, source, inserted);
            return {
                type, target, location, tokensUsed,
                shunted: 0,
                assembly: await toAssembly(__classPrivateFieldGet(this, _CompoundAssembly_codec, "f"), inserted)
            };
        }, _CompoundAssembly_doShuntOut = async function _CompoundAssembly_doShuntOut(iterResult, source, inserted, shuntRef) {
            const { assembly } = iterResult.target;
            const result = dew(() => {
                if (shuntRef.type !== "fragment")
                    return shuntRef;
                const { shuntingMode } = config$1.assembly;
                const direction = shuntingMode === "inDirection" ? iterResult.direction
                    : assembly.isEmpty ? iterResult.direction
                        : "nearest";
                return assembly.shuntOut(shuntRef, direction);
            });
            // This should not be possible unless the implementation of `shuntOut`
            // changes to allow it...  In which case, this error will hopefully
            // let us know something needs to change here.
            if (!isAdjacentResult(result))
                throw new Error(`Unexpected shunt direction: ${result.type}`);
            return {
                ...await __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_doInsertAdjacent).call(this, iterResult, source, inserted, result.type),
                shunted: result.shunted
            };
        }, _CompoundAssembly_doInsertInside = 
        /** Inserts into the assembly at `index`. */
        async function _CompoundAssembly_doInsertInside(iterResult, source, inserted) {
            const { target, location, result } = iterResult;
            const oldAsm = __classPrivateFieldGet(this, _CompoundAssembly_assemblies, "f");
            const { cursor } = assertAs("Expected `result.type` to be `\"inside\"`", isSuccessResult, result);
            checks: {
                // If there is no source, we can't check if we can even split.
                if (!target.source)
                    break checks;
                // If the entry does not support splitting, shunt it.
                if (!("splitAt" in target.assembly))
                    break checks;
                if (!isFunction$1(target.assembly.splitAt))
                    break checks;
                // If we are disallowed from splitting this entry, shunt it.
                if (!this.canSplitInto(source.entry, target.source.entry))
                    break checks;
                const splitResult = await target.assembly.splitAt(cursor);
                // If the split fails, we'll fail-over to bumping it out instead.
                // I don't think this can actually happen, in practice, but just
                // in case.
                if (!splitResult)
                    break checks;
                const asmBefore = oldAsm.slice(0, target.index);
                const asmAfter = oldAsm.slice(target.index + 1);
                const [splitBefore, splitAfter] = splitResult;
                const newAsm = [...asmBefore, splitBefore, inserted, splitAfter, ...asmAfter];
                const tokens = await this.mendTokens(newAsm.map(toTokens));
                const tokensUsed = await this.updateState(newAsm, tokens, source, inserted);
                return {
                    type: "inside",
                    target, location, tokensUsed,
                    shunted: 0,
                    assembly: await toAssembly(__classPrivateFieldGet(this, _CompoundAssembly_codec, "f"), inserted)
                };
            }
            // If we got kicked out of the `checks` block, we must do a shunt.
            return await __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_doShuntOut).call(this, iterResult, source, inserted, cursor);
        }, _CompoundAssembly_iterateInsertion = function* _CompoundAssembly_iterateInsertion(initState) {
            let state = initState;
            const { insertionType } = initState.source.entry.contextConfig;
            // Until we find a non-empty assembly or the insertion offset is `0`,
            // we must use the arity-1 version of `entryPosition`.
            let foundNonEmpty = false;
            // We'll allow only one reversal to avoid infinite loops.
            let didReversal = false;
            const nextPosition = (target) => {
                if (!foundNonEmpty)
                    return target.entryPosition(state.direction);
                return target.entryPosition(state.direction, insertionType);
            };
            while (true) {
                const curAsm = state.target.assembly;
                const asmIsEmpty = curAsm.isEmpty;
                foundNonEmpty || (foundNonEmpty = !asmIsEmpty);
                // Check for emptiness; `ContextGroup` will report empty when it
                // has no assemblies inside it, in which case we should skip it,
                // unless this position is actually our target.
                if (!asmIsEmpty || state.offset === 0) {
                    const result = curAsm.locateInsertion(insertionType, state);
                    switch (result.type) {
                        case "toTop":
                        case "toBottom":
                            state.offset = result.remainder;
                            if (state.direction === result.type)
                                break;
                            if (didReversal)
                                return;
                            state.direction = result.type;
                            didReversal = true;
                            break;
                        default:
                            yield Object.freeze({ ...state, result });
                            break;
                    }
                }
                const idxOffset = state.direction === "toTop" ? -1 : 1;
                const nextIndex = state.target.index + idxOffset;
                const nextTarget = __classPrivateFieldGet(this, _CompoundAssembly_instances, "m", _CompoundAssembly_makeTarget).call(this, nextIndex);
                if (!nextTarget) {
                    // We hit the end.  Insert it before or after the last target.
                    const type = state.direction === "toTop" ? "insertBefore" : "insertAfter";
                    yield Object.freeze({ ...state, result: { type, shunted: 0 } });
                    return;
                }
                state.target = nextTarget;
                state.cursor = nextPosition(nextTarget.assembly);
            }
        };
        return Object.assign(exports, {
            CompoundAssembly
        });
    });

    const EMPTY_TOKENS = Object.freeze([]);
    const theModule$2 = usModule((require, exports) => {
        var _ContextGroup_instances, _ContextGroup_trimmedFrag, _ContextGroup_identifier, _ContextGroup_uniqueId, _ContextGroup_type, _ContextGroup_contextConfig, _ContextGroup_prefix, _ContextGroup_suffix, _ContextGroup_trimEnds, _ContextGroup_dropLeft, _ContextGroup_dropRight;
        const uuid = require(UUID$1);
        const ss = $TextSplitterService(require);
        const tokenized = theModule$5(require);
        const cursorOps = $CursorOps(require);
        const posOps = $PositionOps(require);
        const { CompoundAssembly } = theModule$3(require);
        /**
         * A class that represents a group within a context; these are used as
         * an alternative to the pre-assembled sub-context.
         *
         * Everything in this is implemented pretty lazily and could be optimized
         * better.  Accessing most properties of {@link IFragmentAssembly} will
         * instantiate objects and perform iterations on the sub-assemblies.
         */
        class ContextGroup extends CompoundAssembly {
            constructor(codec, identifier, uniqueId, type, contextConfig, prefix, suffix) {
                super(codec, contextConfig.tokenBudget);
                _ContextGroup_instances.add(this);
                _ContextGroup_trimmedFrag.set(this, void 0);
                _ContextGroup_identifier.set(this, void 0);
                _ContextGroup_uniqueId.set(this, void 0);
                _ContextGroup_type.set(this, void 0);
                _ContextGroup_contextConfig.set(this, void 0);
                _ContextGroup_prefix.set(this, void 0);
                _ContextGroup_suffix.set(this, void 0);
                __classPrivateFieldSet(this, _ContextGroup_identifier, identifier, "f");
                __classPrivateFieldSet(this, _ContextGroup_uniqueId, uniqueId, "f");
                __classPrivateFieldSet(this, _ContextGroup_type, type, "f");
                __classPrivateFieldSet(this, _ContextGroup_contextConfig, contextConfig, "f");
                __classPrivateFieldSet(this, _ContextGroup_prefix, prefix, "f");
                __classPrivateFieldSet(this, _ContextGroup_suffix, suffix, "f");
                __classPrivateFieldSet(this, _ContextGroup_trimmedFrag, undefined, "f");
            }
            /**
             * Creates a fragment from {@link Compound.text}, but emulates the
             * behavior of trimming with {@link TrimOptions.preserveEnds} set
             * to `false`.
             *
             * This is the typical of lorebook entries.
             */
            get trimmedFrag() {
                return __classPrivateFieldSet(this, _ContextGroup_trimmedFrag, __classPrivateFieldGet(this, _ContextGroup_trimmedFrag, "f") ?? dew(() => {
                    const text = this.isEmpty ? "" : super.text;
                    const offset = __classPrivateFieldGet(this, _ContextGroup_prefix, "f").text.length;
                    return __classPrivateFieldGet(this, _ContextGroup_instances, "m", _ContextGroup_trimEnds).call(this, ss.createFragment(text, offset));
                }), "f");
            }
            // Implementations for `SourceLike`.
            get identifier() {
                return __classPrivateFieldGet(this, _ContextGroup_identifier, "f");
            }
            get uniqueId() {
                return __classPrivateFieldGet(this, _ContextGroup_uniqueId, "f");
            }
            get type() {
                return __classPrivateFieldGet(this, _ContextGroup_type, "f");
            }
            get entry() {
                return this;
            }
            get field() {
                return {
                    text: "",
                    id: __classPrivateFieldGet(this, _ContextGroup_uniqueId, "f"),
                    contextConfig: __classPrivateFieldGet(this, _ContextGroup_contextConfig, "f")
                };
            }
            // Implementations for `ContentLike`.
            get contextConfig() {
                return __classPrivateFieldGet(this, _ContextGroup_contextConfig, "f");
            }
            get trimmed() {
                return Promise.resolve(this);
            }
            // Implementations for `AssemblyLike`.
            /**
             * The full, concatenated text of the assembly.  If this assembly is
             * empty, its text will also be empty.
             */
            get text() {
                if (this.isEmpty)
                    return "";
                return [
                    __classPrivateFieldGet(this, _ContextGroup_prefix, "f").text,
                    this.trimmedFrag.content,
                    __classPrivateFieldGet(this, _ContextGroup_suffix, "f").text
                ].join("");
            }
            /**
             * The content text of the assembly.  If this assembly is empty, its
             * content will also be empty.
             */
            get contentText() {
                return this.trimmedFrag.content;
            }
            /**
             * The current tokens of the assembly.  If this assembly is empty,
             * its tokens will also be empty.
             */
            get tokens() {
                return this.isEmpty ? EMPTY_TOKENS : super.tokens;
            }
            get prefix() {
                return ss.createFragment(__classPrivateFieldGet(this, _ContextGroup_prefix, "f").text, 0);
            }
            get content() {
                const fragment = this.trimmedFrag;
                if (!fragment.content)
                    return Object.freeze([]);
                let offset = __classPrivateFieldGet(this, _ContextGroup_prefix, "f").text.length + fragment.offset;
                return Object.freeze([ss.createFragment(fragment.content, offset)]);
            }
            get suffix() {
                const offset = __classPrivateFieldGet(this, _ContextGroup_prefix, "f").text.length + super.text.length;
                return ss.createFragment(__classPrivateFieldGet(this, _ContextGroup_suffix, "f").text, offset);
            }
            /** A context-group is always its own source. */
            get source() {
                return this;
            }
            /**
             * A context-group is treated as empty until it has a non-empty assembly
             * inside it, regardless of if its `prefix` or `suffix` have content.
             */
            get isEmpty() {
                if (this.assemblies.length === 0)
                    return true;
                return this.assemblies.every((asm) => asm.isEmpty);
            }
            /**
             * Implementation of {@link AssemblyLike.adaptCursor}.
             *
             * This will adapt the cursor to this context-group's current `text` if
             * the cursor is targeting one of its sub-assemblies.
             *
             * This cursor is only valid for the current state of the group;
             * if the group is modified, the cursor may point to a different
             * position than intended.
             */
            adaptCursor(cursor) {
                if (cursor.origin === this)
                    return cursor;
                let offset = __classPrivateFieldGet(this, _ContextGroup_prefix, "f").text.length;
                for (const asm of this.assemblies) {
                    checks: {
                        if (!asm.isRelatedTo(cursor.origin))
                            break checks;
                        // It may still be in a split sub-assembly.
                        if (!asm.isFoundIn(cursor))
                            break checks;
                        // In case the cursor was in a trimmed portion at the start
                        // or end of the content, adjust the cursor so it's in a
                        // valid location for this assembly.
                        return cursorOps.findBest(this, fragment(this, offset), true);
                    }
                    offset += asm.text.length;
                }
                return undefined;
            }
            /** Implementation of {@link AssemblyLike.isRelatedTo}. */
            isRelatedTo(other) {
                if (other === this)
                    return true;
                for (const asm of this.assemblies)
                    if (asm.isRelatedTo(other))
                        return true;
                return false;
            }
            /** Implementation of {@link AssemblyLike.isFoundIn}. */
            isFoundIn(cursor) {
                if (cursor.origin !== this)
                    return false;
                return cursorOps.isFoundIn(this, cursor);
            }
            /** Implementation of {@link AssemblyLike.entryPosition}. */
            entryPosition(
            /** Which direction to iterate. */
            direction, 
            /** The type of insertion to be done. */
            insertionType) {
                return posOps.entryPosition(this, direction, insertionType);
            }
            /** Implementation of {@link AssemblyLike.locateInsertion}. */
            locateInsertion(
            /** The type of insertion being done. */
            insertionType, 
            /** An object describing how to locate the insertion. */
            positionData) {
                assert("Expected cursor to related to this assembly.", this.isRelatedTo(positionData.cursor.origin));
                const { cursor, direction } = positionData;
                // Just shunt in the current direction when we're empty.  There is no
                // "nearest" edge in an empty assembly.
                if (this.isEmpty)
                    return this.shuntOut(cursor, direction);
                // Context-groups cannot be inserted into using the same method as normal
                // fragment assemblies.  So, if the insertion point is within this assembly,
                // it's getting shunted out, period.
                const result = posOps.locateInsertion(this, insertionType, positionData);
                switch (result.type) {
                    case "insertAfter":
                    case "insertBefore":
                        return result;
                    default: {
                        const { shuntingMode } = config$1.assembly;
                        const newDirection = shuntingMode === "inDirection" ? direction : "nearest";
                        return this.shuntOut(cursor, newDirection);
                    }
                }
            }
            /** Implementation of {@link AssemblyLike.shuntOut}. */
            shuntOut(
            /** The cursor defining the location we're being shunt from. */
            cursor, 
            /** The shunt mode to use. */
            mode) {
                if (!this.isEmpty)
                    return posOps.shuntOut(this, cursor, mode);
                // `"insertAfter"` will be used for the `"nearest"` mode as well.
                // However, `locateInsertion`, which calls this, will always supply
                // the direction when we're empty.  This is more a safe value for
                // other odd calls.
                const type = mode === "toTop" ? "insertBefore" : "insertAfter";
                return { type, shunted: 0 };
            }
            /**
             * Converts this context-group into a into a static {@link TokenizedAssembly}.
             *
             * The conversion is a destructive process.  All information about assemblies
             * that were inserted will be lost and cursors targeting those assemblies will
             * not be able to be used with this assembly.
             */
            toAssembly() {
                return tokenized.castTo(this.codec, this);
            }
            /** Yields the structured output of the assembly. */
            *structuredOutput() {
                if (this.isEmpty)
                    return;
                // Similar to the problem outlined in `mendTokens`, the structured
                // output must also reflect the trimmed `text` or NovelAI will fail
                // an assertion.
                // Fortunately, `trimmedFrag` should be correct and `super.structuredOutput`
                // should concatenate into `super.text`.  So, we can just convert each
                // element into fragments, slice up `trimmedFrag` and replace the `text`
                // of the structured output.
                const { uniqueId: identifier, type } = this;
                // Yield the prefix, if needed.
                if (__classPrivateFieldGet(this, _ContextGroup_prefix, "f").text)
                    yield { identifier, type, text: __classPrivateFieldGet(this, _ContextGroup_prefix, "f").text };
                // Here we work on the content.
                let remaining = this.trimmedFrag;
                let offset = __classPrivateFieldGet(this, _ContextGroup_prefix, "f").text.length;
                for (const so of super.structuredOutput()) {
                    // There's probably no reason to yield empty elements.
                    if (!so.text)
                        continue;
                    const srcFrag = ss.createFragment(so.text, offset);
                    const splitOffset = srcFrag.offset + srcFrag.content.length;
                    if (ss.isOffsetInside(splitOffset, remaining)) {
                        const [left, right] = ss.splitFragmentAt(remaining, splitOffset);
                        yield { ...so, text: left.content };
                        remaining = right;
                    }
                    else {
                        // We'd better be done!
                        yield { ...so, text: remaining.content };
                        remaining = ss.createFragment("", splitOffset);
                    }
                    offset += so.text.length;
                }
                // Yield the suffix, if needed.
                if (__classPrivateFieldGet(this, _ContextGroup_suffix, "f").text)
                    yield { identifier, type, text: __classPrivateFieldGet(this, _ContextGroup_suffix, "f").text };
            }
            validateBudget(budget) {
                // When the assembly is empty, we are pretending that the prefix and suffix
                // do not exist; their tokens have not been being accounted for.  That
                // means the budget calculated earlier may not actually fit this assembly.
                // Let's make sure we rectify this.
                // Firstly, if we aren't empty, use the default behavior.
                if (!this.isEmpty)
                    return super.validateBudget(budget);
                // Now, let's adjust the budget to account for the prefix and suffix.
                // This isn't going to be 100% accurate, since the token mending process
                // can shave off a token or two, but it'll be close enough.
                const pLen = __classPrivateFieldGet(this, _ContextGroup_prefix, "f").tokens.length;
                const sLen = __classPrivateFieldGet(this, _ContextGroup_suffix, "f").tokens.length;
                const overhead = pLen + sLen;
                budget = super.validateBudget(budget - overhead);
                // We must have room to fit the prefix and suffix into the budget.
                return budget > overhead ? budget : 0;
            }
            async mendTokens(tokensToMend) {
                // We have a problem here; we need the tokens to decode into the
                // same text as will be in `this.text`, but these tokens may not
                // reflect that. The whitespace that is removed in `trimmedFrag`
                // is still present in the tokens.  Sadly, we must do work some
                // foul magic to get this internally consistent.
                // First, mend the tokens as they were given.
                const origTokens = await super.mendTokens(tokensToMend);
                // Now, we'll need to decode them, since the `assemblies` array is
                // not yet updated.  Accessing `text` or `trimmedText` will produce
                // an outdated result.
                const origFrag = ss.createFragment(await this.codec.decode(origTokens), 0);
                // And now apply the trimming behavior.  The fragment's offsets will
                // tell us how much was trimmed.  We can use this to trim the tokens.
                const trimmedFrag = __classPrivateFieldGet(this, _ContextGroup_instances, "m", _ContextGroup_trimEnds).call(this, origFrag);
                const [leftTokens, leftFrag] = await __classPrivateFieldGet(this, _ContextGroup_instances, "m", _ContextGroup_dropLeft).call(this, ss.beforeFragment(trimmedFrag), origTokens, origFrag);
                const [trimmedContent] = await __classPrivateFieldGet(this, _ContextGroup_instances, "m", _ContextGroup_dropRight).call(this, ss.afterFragment(trimmedFrag), leftTokens, leftFrag);
                // Now, we just need to mend once more with the prefix and suffix
                // tokens included.
                return await super.mendTokens([
                    __classPrivateFieldGet(this, _ContextGroup_prefix, "f").tokens,
                    trimmedContent,
                    __classPrivateFieldGet(this, _ContextGroup_suffix, "f").tokens
                ]);
            }
            async updateState(newAssemblies, tokens, source, inserted) {
                // Invalidate the cached trimmed-text.
                __classPrivateFieldSet(this, _ContextGroup_trimmedFrag, undefined, "f");
                return await super.updateState(newAssemblies, tokens, source, inserted);
            }
        }
        _ContextGroup_trimmedFrag = new WeakMap(), _ContextGroup_identifier = new WeakMap(), _ContextGroup_uniqueId = new WeakMap(), _ContextGroup_type = new WeakMap(), _ContextGroup_contextConfig = new WeakMap(), _ContextGroup_prefix = new WeakMap(), _ContextGroup_suffix = new WeakMap(), _ContextGroup_instances = new WeakSet(), _ContextGroup_trimEnds = function _ContextGroup_trimEnds(fragment) {
            if (!fragment.content)
                return fragment;
            return chain([fragment])
                .thru(ss.makeFragmenter(this.contextConfig.maximumTrimType))
                .pipe(journey, ss.hasWords)
                .value((iter) => ss.mergeFragments([...iter]));
        }, _ContextGroup_dropLeft = 
        /** Drops the characters before `offset`. */
        async function _ContextGroup_dropLeft(offset, curTokens, curFrag) {
            // No need if the offset is right at the start.
            if (offset === ss.beforeFragment(curFrag))
                return [curTokens, curFrag];
            const [, newFrag] = ss.splitFragmentAt(curFrag, offset);
            const [, newTokens] = await getTokensForSplit(this.codec, offset, curTokens, curFrag.content);
            return [newTokens, newFrag];
        }, _ContextGroup_dropRight = 
        /** Drops the characters after `offset`. */
        async function _ContextGroup_dropRight(offset, curTokens, curFrag) {
            // No need if the offset is right at the end.
            if (offset === ss.afterFragment(curFrag))
                return [curTokens, curFrag];
            const [newFrag] = ss.splitFragmentAt(curFrag, offset);
            const [newTokens] = await getTokensForSplit(this.codec, offset, curTokens, curFrag.content);
            return [newTokens, newFrag];
        };
        /** Creates an empty context-group for a category. */
        async function forCategory(codec, category) {
            const { name, id, subcontextSettings } = category;
            const { contextConfig } = subcontextSettings;
            const [prefix, suffix] = await Promise.all([
                dew(async () => {
                    const { prefix } = contextConfig;
                    if (!prefix)
                        return { text: "", tokens: EMPTY_TOKENS };
                    const tokens = await codec.encode(prefix);
                    return { text: prefix, tokens };
                }),
                dew(async () => {
                    const { suffix } = contextConfig;
                    if (!suffix)
                        return { text: "", tokens: EMPTY_TOKENS };
                    const tokens = await codec.encode(suffix);
                    return { text: suffix, tokens };
                })
            ]);
            return Object.assign(new ContextGroup(codec, `S:${name}`, id ?? uuid.v4(), "lore", contextConfig, prefix, suffix), { category });
        }
        function isContextGroup(value) {
            return value instanceof ContextGroup;
        }
        function isCategoryGroup(value) {
            if (!isContextGroup(value))
                return false;
            return "category" in value;
        }
        return Object.assign(exports, {
            ContextGroup,
            forCategory,
            isContextGroup,
            isCategoryGroup
        });
    });

    var $ContextGroup = usModule((require, exports) => {
        const { ContextGroup } = theModule$2(require);
        /** Sorts sources that are context-groups first. */
        const contextGroup = () => {
            return (a, b) => {
                const aIsGroup = a instanceof ContextGroup;
                const bIsGroup = b instanceof ContextGroup;
                if (aIsGroup === bIsGroup)
                    return 0;
                if (aIsGroup)
                    return -1;
                return 1;
            };
        };
        return Object.assign(exports, { contextGroup });
    });

    var $Reservation = usModule((require, exports) => {
        const { isBudgetedSource } = $Selection$1(require);
        const hasReservedTokens = (source) => {
            if (!isBudgetedSource(source))
                return false;
            return source.budgetStats.actualReservedTokens > 0;
        };
        /** Sorts sources by their budget priority, descending. */
        const reservation = () => (a, b) => {
            const aReserved = hasReservedTokens(a);
            const bReserved = hasReservedTokens(b);
            if (aReserved === bReserved)
                return 0;
            if (aReserved)
                return -1;
            return 1;
        };
        return Object.assign(exports, { reservation });
    });

    /** Sorts sources that were ephemerally-activated first. */
    const activationEphemeral = () => (a, b) => {
        const aEphemeral = a.activations?.has("ephemeral") ?? false;
        const bEphemeral = b.activations?.has("ephemeral") ?? false;
        if (aEphemeral === bEphemeral)
            return 0;
        if (aEphemeral)
            return -1;
        return 1;
    };

    /** Sorts sources that were force-activated first. */
    const activationForced = () => (a, b) => {
        const aForced = a.activations?.has("forced") ?? false;
        const bForced = b.activations?.has("forced") ?? false;
        if (aForced === bForced)
            return 0;
        if (aForced)
            return -1;
        return 1;
    };

    /** Sorts sources that were story-activated first. */
    const activationStory = () => (a, b) => {
        const aKeyed = a.activations?.has("keyed") ?? false;
        const bKeyed = b.activations?.has("keyed") ?? false;
        if (aKeyed === bKeyed)
            return 0;
        if (aKeyed)
            return -1;
        return 1;
    };

    /** Sorts sources that were NOT story-activated first. */
    const activationNonStory = () => (a, b) => {
        const aKeyed = a.activations?.has("keyed") ?? false;
        const bKeyed = b.activations?.has("keyed") ?? false;
        if (aKeyed === bKeyed)
            return 0;
        if (aKeyed)
            return 1;
        return -1;
    };

    var $StoryKeyOrder = usModule((require, exports) => {
        const { findHighestIndex } = SearchService(require);
        /**
         * Sorts sources that were story-activated:
         * - Before those that were not.
         * - In the order of where the match was found, later in the story first.
         *
         * This is a secret NovelAI feature and is controlled by
         * `orderByKeyLocations` in the lorebook config.
         */
        const storyKeyOrder = ({ orderByKeyLocations }) => {
            // Only sort when the feature is enabled.
            if (!orderByKeyLocations)
                return () => 0;
            return (a, b) => {
                // Keyed entries are higher priority than un-keyed entries.
                const aBest = findHighestIndex(a.activations?.get("keyed"));
                const bBest = findHighestIndex(b.activations?.get("keyed"));
                if (!aBest && !bBest)
                    return 0;
                if (!aBest)
                    return 1;
                if (!bBest)
                    return -1;
                // We want to prefer the match with the highest index.
                const [, { index: aIndex }] = aBest;
                const [, { index: bIndex }] = bBest;
                return bIndex - aIndex;
            };
        };
        return Object.assign(exports, { storyKeyOrder });
    });

    /**
     * Sorts sources that activated by cascade:
     * - Before those that did not.
     * - By the initial degree of the cascade, ascending.
     *
     * The initial degree of the cascade is how many other entries had
     * to activate by cascade before this entry could activate.
     *
     * This will order entries so any entries that an entry initially matched
     * come before that entry.
     */
    const cascadeInitDegree = () => (a, b) => {
        const aCascade = a.activations?.get("cascade");
        const bCascade = b.activations?.get("cascade");
        if (!aCascade && !bCascade)
            return 0;
        if (!aCascade)
            return 1;
        if (!bCascade)
            return -1;
        // Prefer the one with the lowest degree.
        return aCascade.initialDegree - bCascade.initialDegree;
    };

    /**
     * Sorts sources that activated by cascade:
     * - Before those that did not.
     * - By the final degree of the cascade, ascending.
     *
     * The final degree of cascade is how many layers deep into the cascade
     * we were when the last match was found.  Entries with a lower final
     * degree could have been matched by the entry.
     *
     * This will order entries so all entries that an entry matched come
     * before that entry.
     */
    const cascadeFinalDegree = () => (a, b) => {
        const aCascade = a.activations?.get("cascade");
        const bCascade = b.activations?.get("cascade");
        if (!aCascade && !bCascade)
            return 0;
        if (!aCascade)
            return 1;
        if (!bCascade)
            return -1;
        // Prefer the one with the lowest degree.
        return aCascade.finalDegree - bCascade.finalDegree;
    };

    /**
     * Sorts sources by their underlying type.
     *
     * Intended to be positioned before `naturalByPosition`.
     *
     * NovelAI has a natural, deterministic order to entries that is likely
     * lost due to all the asynchronous activity.  This helps to restore it.
     */
    const naturalByType = () => {
        const byType = new Map([
            "story", "memory", "an",
            "ephemeral", "lore", "unknown"
        ].map((type, i) => [type, i]));
        // Default to "unknown", basically.
        const defaultOrder = Math.max(...byType.values());
        return (a, b) => {
            const aType = byType.get(a.type) ?? defaultOrder;
            const bType = byType.get(b.type) ?? defaultOrder;
            return aType - bType;
        };
    };

    var $NaturalByPosition = usModule((require, exports) => {
        const { isBudgetedSource } = $Selection$1(require);
        /**
         * Sorts sources by their position in the lorebook.
         *
         * Intended to be positioned after `naturalByType`.
         *
         * NovelAI has a natural, deterministic order to entries that is likely
         * lost due to all the asynchronous activity.  This helps to restore it.
         */
        const naturalByPosition = ({ storyContent }) => {
            // This assumes that `naturalByType` has run, so multiple entries
            // with the same index won't matter, because only same types should
            // be being compared...
            const byPos = new Map([
                ...storyContent.lorebook.entries.map((entry, i) => [entry, i]),
                ...storyContent.ephemeralContext.map((entry, i) => [entry, i])
            ]);
            // Default to after everything else, basically.
            const defaultOrder = Math.max(0, ...byPos.values()) + 1;
            const getPos = (source) => {
                if (!isBudgetedSource(source))
                    return defaultOrder;
                return byPos.get(source.entry.field) ?? defaultOrder;
            };
            return (a, b) => getPos(a) - getPos(b);
        };
        return Object.assign(exports, { naturalByPosition });
    });

    const theModule$1 = usModule((require, exports) => {
        const sorters = Object.freeze({
            budgetPriority,
            ...$SelectionIndex(require),
            ...$ContextGroup(require),
            ...$Reservation(require),
            activationEphemeral,
            activationForced,
            activationStory,
            activationNonStory,
            ...$StoryKeyOrder(require),
            cascadeInitDegree,
            cascadeFinalDegree,
            naturalByType,
            ...$NaturalByPosition(require)
        });
        const assertConfig = (name) => (k) => assert(`Unknown sorter "${k}" for \`${name}\` config!`, k in sorters);
        /**
         * Creates a master insertion sorter based on the functions specified
         * in the `selection.insertionOrdering` config.
         */
        const forInsertion = (contextParams) => {
            const chosenSorters = chain(config$1.selection.insertionOrdering)
                // Force the natural sorters to be the last ones.
                .filter((k) => k !== "naturalByPosition" && k !== "naturalByType")
                .appendVal("naturalByType", "naturalByPosition")
                // Check to make sure there's a sorter for each key.
                .tap(assertConfig("selection.insertionOrdering"))
                .map((k) => sorters[k](contextParams))
                .toArray();
            return (a, b) => {
                for (let i = 0, len = chosenSorters.length; i < len; i++) {
                    const result = chosenSorters[i](a, b);
                    if (result !== 0)
                        return result;
                }
                return 0;
            };
        };
        /**
         * Creates a master weighted selection sorter based on the functions
         * specified in the `weightedRandom.selectionOrdering` config.
         */
        const forWeightedSelection = (contextParams) => {
            const chosenSorters = chain(config$1.weightedRandom.selectionOrdering)
                // Check to make sure there's a sorter for each key.
                .tap(assertConfig("weightedRandom.selectionOrdering"))
                .map((k) => sorters[k](contextParams))
                .toArray();
            return (a, b) => {
                for (let i = 0, len = chosenSorters.length; i < len; i++) {
                    const result = chosenSorters[i](a, b);
                    if (result !== 0)
                        return result;
                }
                return 0;
            };
        };
        return Object.assign(exports, {
            sorters,
            forInsertion,
            forWeightedSelection
        });
    });

    var $SubContexts$1 = usModule((_require, exports) => {
        /** Checks to see if `source` has a `subContext` field. */
        const isSubContextSource = conforms_1({
            subContext: (v) => isInstance(v),
            activated: (v) => v === true
        });
        return Object.assign(exports, {
            isSubContextSource
        });
    });

    /**
     * The base implementation of `_.clamp` which doesn't coerce arguments.
     *
     * @private
     * @param {number} number The number to clamp.
     * @param {number} [lower] The lower bound.
     * @param {number} upper The upper bound.
     * @returns {number} Returns the clamped number.
     */

    function baseClamp$1(number, lower, upper) {
      if (number === number) {
        if (upper !== undefined) {
          number = number <= upper ? number : upper;
        }

        if (lower !== undefined) {
          number = number >= lower ? number : lower;
        }
      }

      return number;
    }

    var _baseClamp = baseClamp$1;

    /** Used to match a single whitespace character. */
    var reWhitespace = /\s/;
    /**
     * Used by `_.trim` and `_.trimEnd` to get the index of the last non-whitespace
     * character of `string`.
     *
     * @private
     * @param {string} string The string to inspect.
     * @returns {number} Returns the index of the last non-whitespace character.
     */

    function trimmedEndIndex$1(string) {
      var index = string.length;

      while (index-- && reWhitespace.test(string.charAt(index))) {}

      return index;
    }

    var _trimmedEndIndex = trimmedEndIndex$1;

    var trimmedEndIndex = _trimmedEndIndex;
    /** Used to match leading whitespace. */

    var reTrimStart = /^\s+/;
    /**
     * The base implementation of `_.trim`.
     *
     * @private
     * @param {string} string The string to trim.
     * @returns {string} Returns the trimmed string.
     */

    function baseTrim$1(string) {
      return string ? string.slice(0, trimmedEndIndex(string) + 1).replace(reTrimStart, '') : string;
    }

    var _baseTrim = baseTrim$1;

    var baseTrim = _baseTrim,
        isObject$1 = isObject_1,
        isSymbol = isSymbol_1;
    /** Used as references for various `Number` constants. */

    var NAN = 0 / 0;
    /** Used to detect bad signed hexadecimal string values. */

    var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;
    /** Used to detect binary string values. */

    var reIsBinary = /^0b[01]+$/i;
    /** Used to detect octal string values. */

    var reIsOctal = /^0o[0-7]+$/i;
    /** Built-in method references without a dependency on `root`. */

    var freeParseInt = parseInt;
    /**
     * Converts `value` to a number.
     *
     * @static
     * @memberOf _
     * @since 4.0.0
     * @category Lang
     * @param {*} value The value to process.
     * @returns {number} Returns the number.
     * @example
     *
     * _.toNumber(3.2);
     * // => 3.2
     *
     * _.toNumber(Number.MIN_VALUE);
     * // => 5e-324
     *
     * _.toNumber(Infinity);
     * // => Infinity
     *
     * _.toNumber('3.2');
     * // => 3.2
     */

    function toNumber$1(value) {
      if (typeof value == 'number') {
        return value;
      }

      if (isSymbol(value)) {
        return NAN;
      }

      if (isObject$1(value)) {
        var other = typeof value.valueOf == 'function' ? value.valueOf() : value;
        value = isObject$1(other) ? other + '' : other;
      }

      if (typeof value != 'string') {
        return value === 0 ? value : +value;
      }

      value = baseTrim(value);
      var isBinary = reIsBinary.test(value);
      return isBinary || reIsOctal.test(value) ? freeParseInt(value.slice(2), isBinary ? 2 : 8) : reIsBadHex.test(value) ? NAN : +value;
    }

    var toNumber_1 = toNumber$1;

    var baseClamp = _baseClamp,
        toNumber = toNumber_1;
    /**
     * Clamps `number` within the inclusive `lower` and `upper` bounds.
     *
     * @static
     * @memberOf _
     * @since 4.0.0
     * @category Number
     * @param {number} number The number to clamp.
     * @param {number} [lower] The lower bound.
     * @param {number} upper The upper bound.
     * @returns {number} Returns the clamped number.
     * @example
     *
     * _.clamp(-10, -5, 5);
     * // => -5
     *
     * _.clamp(10, -5, 5);
     * // => 5
     */

    function clamp(number, lower, upper) {
      if (upper === undefined) {
        upper = lower;
        lower = undefined;
      }

      if (upper !== undefined) {
        upper = toNumber(upper);
        upper = upper === upper ? upper : 0;
      }

      if (lower !== undefined) {
        lower = toNumber(lower);
        lower = lower === lower ? lower : 0;
      }

      return baseClamp(toNumber(number), lower, upper);
    }

    var clamp_1 = clamp;

    /**
     * Remaps a number from one range to another.  The result is not
     * clamped to that range.
     */
    const remap = (value, inMin, inMax, outMin, outMax) => (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;

    const DEFAULT_RANGE = Object.freeze({ min: 0, max: 1 });
    /** Creates an additive weight. */
    function add(value) {
        assert("Expected value to be greater than or equal to 0.", value >= 0);
        return Object.freeze({ type: "additive", value });
    }
    /** Creates an multiplicative weight. */
    function scalar(value, options) {
        if (options) {
            const { input = DEFAULT_RANGE, output = DEFAULT_RANGE, clamp: doClamp } = options;
            value = remap(value, input.min, input.max, output.min, output.max);
            if (doClamp === true)
                value = clamp_1(value, output.min, output.max);
        }
        assert("Expected value to be greater than or equal to 0.", value >= 0);
        return Object.freeze({ type: "scalar", value });
    }
    /** A weight that applies no change. */
    const nil = scalar(1);

    /** A value used to bump the point values up. */
    const ADJUSTMENT = 1.8;
    var $CascadeCount = usModule((require, exports) => {
        const { isActivated } = $Activation$1(require);
        /**
         * Weight function that adds points for each match in another entry.
         * The points provided are reduced the higher the degree of the match.
         */
        const cascadeCount = () => (source) => {
            // Can't score if the entry has no activation data.
            if (!isActivated(source))
                return nil;
            // We only score it if the source has a cascade activation.
            const cascade = source.activations.get("cascade");
            if (!cascade)
                return nil;
            let totalScore = 0;
            for (const result of cascade.matches.values()) {
                const baseScalar = 1 / (1 + result.matchDegree);
                totalScore += baseScalar * ADJUSTMENT * result.size;
            }
            return add(totalScore);
        };
        return Object.assign(exports, { cascadeCount });
    });

    /** The maximum penalty for this weighting function. */
    const PENALTY = 0.1;
    var $SearchRange = usModule((require, exports) => {
        const queryOps = $QueryOps(require);
        const cursorOps = $CursorOps(require);
        const cursors = $Cursors(require);
        const { ContextContent } = theModule$4(require);
        const { findHighestIndex } = SearchService(require);
        const { isActivated } = $Activation$1(require);
        const hasSearchRange = (source) => {
            if (!source.entry.fieldConfig)
                return false;
            return "searchRange" in source.entry.fieldConfig;
        };
        /** Remaps a full-text offset to a fragment offset. */
        const remapOffset = (searchedText, ftOffset) => {
            const text = queryOps.getText(searchedText);
            ftOffset = clamp_1(ftOffset, 0, text.length);
            const ftCursor = cursors.fullText(searchedText, ftOffset);
            return cursorOps.fromFullText(searchedText, ftCursor).offset;
        };
        /**
         * Weight function that penalizes sources that are outside their
         * configured search range.  A scaling penalty is applied the farther
         * the source is from the search range, reaching the minimum multiplier
         * at twice the search range.
         *
         * @see PENALTY for the maximum penalty.
         */
        const searchRange = (_params, allSources) => {
            const searchedText = dew(() => {
                const theStory = allSources.find((source) => source.type === "story");
                if (!theStory)
                    return undefined;
                if (!(theStory.entry instanceof ContextContent))
                    return undefined;
                return theStory.entry.searchedText;
            });
            const ftLength = !searchedText ? 0 : queryOps.getText(searchedText).length;
            return (source) => {
                // Can't score when the story is empty or missing.
                if (!searchedText || ftLength === 0)
                    return nil;
                // Can't score without a search range.
                if (!hasSearchRange(source))
                    return nil;
                // Can't score if the entry has no activation data.
                if (!isActivated(source))
                    return nil;
                // We only score it if the source has a story activation.
                const keyed = source.activations.get("keyed");
                if (!keyed)
                    return nil;
                const { searchRange } = source.entry.fieldConfig;
                const ftOffset = ftLength - searchRange;
                // It can only be inside the search range.
                if (ftOffset <= 0)
                    return nil;
                // Perform the cursor re-mapping to get the penalty range.
                const maxRange = remapOffset(searchedText, ftOffset);
                const minRange = remapOffset(searchedText, ftOffset - searchRange);
                // If we activated by a keyword, we definitely have a result.
                const result = assertExists("Expected to have at least one match result.", findHighestIndex(keyed));
                const best = result[1].selection[1].offset;
                if (best >= maxRange)
                    return nil;
                if (best <= minRange)
                    return scalar(PENALTY);
                return scalar(best, {
                    input: { min: minRange, max: maxRange },
                    output: { min: PENALTY, max: 1 },
                    clamp: true
                });
            };
        };
        return Object.assign(exports, { searchRange });
    });

    var $StoryCount = usModule((require, exports) => {
        const { isActivated } = $Activation$1(require);
        /**
         * Weight function that simply provides one point for each match in
         * the story.
         */
        const storyCount = () => (source) => {
            // Can't score if the entry has no activation data.
            if (!isActivated(source))
                return nil;
            // We only score it if the source has a story activation.
            const keyed = source.activations.get("keyed");
            if (!keyed)
                return nil;
            return add(keyed.size);
        };
        return Object.assign(exports, { storyCount });
    });

    const theModule = usModule((require, exports) => {
        const weighers = {
            ...$CascadeCount(require),
            ...$SearchRange(require),
            ...$StoryCount(require)
        };
        const assertConfig = (name) => (k) => assert(`Unknown weigher "${k}" for \`${name}\` config!`, k in weighers);
        const fromConfigValue = (keys) => {
            if (!isArray$4(keys))
                return weighers[keys];
            return keys.map((k) => weighers[k]);
        };
        const toWeigher = (fns) => {
            if (!isArray$4(fns))
                return fns;
            // Create a composite weigher that yields an additive value.
            return (params, allSources) => {
                const chosenWeights = fns.map((fn) => fn(params, allSources));
                return (source) => {
                    const score = chosenWeights
                        .map((fn) => fn(source))
                        .reduce((acc, weight) => {
                        switch (weight.type) {
                            case "additive": return acc + weight.value;
                            case "scalar": return acc * weight.value;
                        }
                    }, 0);
                    return add(score);
                };
            };
        };
        /**
         * Creates a master weighting function based on the weighting functions
         * specified in the `weightedRandom.weighting` config.
         */
        const forScoring = (contextParams, allSources) => {
            const compositeWeigher = chain(config$1.weightedRandom.weighting)
                // Check to make sure there's a weigher for each key.
                .tap((v) => {
                if (!isArray$4(v))
                    assertConfig("weightedRandom.weighting")(v);
                else
                    v.forEach(assertConfig("weightedRandom.weighting"));
            })
                // Convert to weighing functions.
                .map(fromConfigValue)
                .map(toWeigher)
                // And apply our arguments.
                .value((iter) => toWeigher([...iter])(contextParams, allSources));
            // It will always be an additive weighting function.
            return (source) => compositeWeigher(source).value;
        };
        return Object.assign(exports, {
            weighers,
            forScoring
        });
    });

    /**
     * This module provides types and helpers used internally by the
     * phase runners.  It was getting tedious finding the one helper
     * or type that I needed, so I decided to centralize them...
     *
     * Then it got too big, so I broke them into individual modules
     * provided by this index.
     */
    var $Common = usModule((require, exports) => {
        return Object.assign(exports, {
            activation: $Activation$1(require),
            biasGroups: $BiasGroups$1(require),
            categories: $Categories(require),
            selection: $Selection$1(require),
            sorting: theModule$1(require),
            subContexts: $SubContexts$1(require),
            weights: theModule(require)
        });
    });

    var $EnabledSeparator = usModule((require, exports) => {
        const { categories } = $Common(require);
        const isEnabled = conforms_1({
            entry: conforms_1({
                fieldConfig: (c) => {
                    // Enabled by default if it lacks the `enabled` property.
                    if (!("enabled" in c))
                        return true;
                    // Otherwise, it must be exactly `true`.
                    return c.enabled === true;
                }
            })
        });
        const checkCategory = (allCategories) => (source) => {
            // The entry must have a category to even be disabled through it.
            if (!categories.isCategorized(source))
                return true;
            const category = allCategories.get(source.entry.fieldConfig.category);
            // We'll accept only an explicit `false` to disable it.
            return category?.enabled !== false;
        };
        const toEnabled = (source) => Object.assign(source, { enabled: true });
        const toDisabled = (source) => Object.assign(source, { enabled: false });
        const separate = (storyContent, sources) => {
            const catKvps = storyContent.lorebook.categories.map((c) => [c.id ?? c.name, c]);
            const isCategoryEnabled = checkCategory(new Map(catKvps));
            const [enabled, disabled] = partition$1(sources, (source) => {
                if (!isEnabled(source))
                    return false;
                if (!isCategoryEnabled(source))
                    return false;
                return true;
            });
            return {
                enabledSources: enabled.pipe(map(toEnabled), shareReplay()),
                disabledSources: disabled.pipe(map(toDisabled), shareReplay())
            };
        };
        return Object.assign(exports, { separate });
    });

    /**
     * The Source Phase searches all the provided data for context
     * content and constructs the {@link ContextSource} instances
     * for each.
     *
     * This phase may also do some basic normalization steps on
     * the input entries to ensure things go smoothly later on.
     */
    var $Source = usModule((require, exports) => {
        const source = {
            content: $SourceContent(require).createStream,
            ephemeral: $SourceEphemeral(require).createStream,
            lore: $SourceLore(require).createStream,
            separateEnabled: $EnabledSeparator(require).separate
        };
        const filterStory = (s) => s.type === "story";
        function sourcePhase(
        /** The context builder parameters. */
        contextParams) {
            const logger = createLogger(`Source Phase: ${contextParams.contextName}`);
            // We'll want to pull the story out of NAI's default content.
            const defaultContent = source.content(contextParams).pipe(shareReplay());
            // Gather our content sources.
            const allSources = merge(defaultContent, source.lore(contextParams), source.ephemeral(contextParams)).pipe(logger.measureStream("All Sources"));
            // Figure out which are enabled or disabled.
            const separated = source.separateEnabled(contextParams.storyContent, allSources);
            return lazyObject({
                storySource: () => defaultContent.pipe(filter(filterStory), single(), shareReplay(1)),
                enabledSources: () => separated.enabledSources,
                disabledSources: () => separated.disabledSources
            });
        }
        return Object.assign(exports, source, { phaseRunner: sourcePhase });
    });

    /** Used to stand-in for `undefined` hash values. */
    var HASH_UNDEFINED = '__lodash_hash_undefined__';
    /**
     * Adds `value` to the array cache.
     *
     * @private
     * @name add
     * @memberOf SetCache
     * @alias push
     * @param {*} value The value to cache.
     * @returns {Object} Returns the cache instance.
     */

    function setCacheAdd$1(value) {
      this.__data__.set(value, HASH_UNDEFINED);

      return this;
    }

    var _setCacheAdd = setCacheAdd$1;

    /**
     * Checks if `value` is in the array cache.
     *
     * @private
     * @name has
     * @memberOf SetCache
     * @param {*} value The value to search for.
     * @returns {number} Returns `true` if `value` is found, else `false`.
     */

    function setCacheHas$1(value) {
      return this.__data__.has(value);
    }

    var _setCacheHas = setCacheHas$1;

    var MapCache = _MapCache,
        setCacheAdd = _setCacheAdd,
        setCacheHas = _setCacheHas;
    /**
     *
     * Creates an array cache object to store unique values.
     *
     * @private
     * @constructor
     * @param {Array} [values] The values to cache.
     */

    function SetCache$1(values) {
      var index = -1,
          length = values == null ? 0 : values.length;
      this.__data__ = new MapCache();

      while (++index < length) {
        this.add(values[index]);
      }
    } // Add methods to `SetCache`.


    SetCache$1.prototype.add = SetCache$1.prototype.push = setCacheAdd;
    SetCache$1.prototype.has = setCacheHas;
    var _SetCache = SetCache$1;

    /**
     * A specialized version of `_.some` for arrays without support for iteratee
     * shorthands.
     *
     * @private
     * @param {Array} [array] The array to iterate over.
     * @param {Function} predicate The function invoked per iteration.
     * @returns {boolean} Returns `true` if any element passes the predicate check,
     *  else `false`.
     */

    function arraySome$1(array, predicate) {
      var index = -1,
          length = array == null ? 0 : array.length;

      while (++index < length) {
        if (predicate(array[index], index, array)) {
          return true;
        }
      }

      return false;
    }

    var _arraySome = arraySome$1;

    /**
     * Checks if a `cache` value for `key` exists.
     *
     * @private
     * @param {Object} cache The cache to query.
     * @param {string} key The key of the entry to check.
     * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
     */

    function cacheHas$1(cache, key) {
      return cache.has(key);
    }

    var _cacheHas = cacheHas$1;

    var SetCache = _SetCache,
        arraySome = _arraySome,
        cacheHas = _cacheHas;
    /** Used to compose bitmasks for value comparisons. */

    var COMPARE_PARTIAL_FLAG$4 = 1,
        COMPARE_UNORDERED_FLAG$2 = 2;
    /**
     * A specialized version of `baseIsEqualDeep` for arrays with support for
     * partial deep comparisons.
     *
     * @private
     * @param {Array} array The array to compare.
     * @param {Array} other The other array to compare.
     * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
     * @param {Function} customizer The function to customize comparisons.
     * @param {Function} equalFunc The function to determine equivalents of values.
     * @param {Object} stack Tracks traversed `array` and `other` objects.
     * @returns {boolean} Returns `true` if the arrays are equivalent, else `false`.
     */

    function equalArrays$2(array, other, bitmask, customizer, equalFunc, stack) {
      var isPartial = bitmask & COMPARE_PARTIAL_FLAG$4,
          arrLength = array.length,
          othLength = other.length;

      if (arrLength != othLength && !(isPartial && othLength > arrLength)) {
        return false;
      } // Check that cyclic values are equal.


      var arrStacked = stack.get(array);
      var othStacked = stack.get(other);

      if (arrStacked && othStacked) {
        return arrStacked == other && othStacked == array;
      }

      var index = -1,
          result = true,
          seen = bitmask & COMPARE_UNORDERED_FLAG$2 ? new SetCache() : undefined;
      stack.set(array, other);
      stack.set(other, array); // Ignore non-index properties.

      while (++index < arrLength) {
        var arrValue = array[index],
            othValue = other[index];

        if (customizer) {
          var compared = isPartial ? customizer(othValue, arrValue, index, other, array, stack) : customizer(arrValue, othValue, index, array, other, stack);
        }

        if (compared !== undefined) {
          if (compared) {
            continue;
          }

          result = false;
          break;
        } // Recursively compare arrays (susceptible to call stack limits).


        if (seen) {
          if (!arraySome(other, function (othValue, othIndex) {
            if (!cacheHas(seen, othIndex) && (arrValue === othValue || equalFunc(arrValue, othValue, bitmask, customizer, stack))) {
              return seen.push(othIndex);
            }
          })) {
            result = false;
            break;
          }
        } else if (!(arrValue === othValue || equalFunc(arrValue, othValue, bitmask, customizer, stack))) {
          result = false;
          break;
        }
      }

      stack['delete'](array);
      stack['delete'](other);
      return result;
    }

    var _equalArrays = equalArrays$2;

    /**
     * Converts `map` to its key-value pairs.
     *
     * @private
     * @param {Object} map The map to convert.
     * @returns {Array} Returns the key-value pairs.
     */

    function mapToArray$1(map) {
      var index = -1,
          result = Array(map.size);
      map.forEach(function (value, key) {
        result[++index] = [key, value];
      });
      return result;
    }

    var _mapToArray = mapToArray$1;

    /**
     * Converts `set` to an array of its values.
     *
     * @private
     * @param {Object} set The set to convert.
     * @returns {Array} Returns the values.
     */

    function setToArray$1(set) {
      var index = -1,
          result = Array(set.size);
      set.forEach(function (value) {
        result[++index] = value;
      });
      return result;
    }

    var _setToArray = setToArray$1;

    var Symbol$1 = _Symbol,
        Uint8Array = _Uint8Array,
        eq = eq_1,
        equalArrays$1 = _equalArrays,
        mapToArray = _mapToArray,
        setToArray = _setToArray;
    /** Used to compose bitmasks for value comparisons. */

    var COMPARE_PARTIAL_FLAG$3 = 1,
        COMPARE_UNORDERED_FLAG$1 = 2;
    /** `Object#toString` result references. */

    var boolTag = '[object Boolean]',
        dateTag = '[object Date]',
        errorTag = '[object Error]',
        mapTag = '[object Map]',
        numberTag = '[object Number]',
        regexpTag = '[object RegExp]',
        setTag = '[object Set]',
        stringTag = '[object String]',
        symbolTag = '[object Symbol]';
    var arrayBufferTag = '[object ArrayBuffer]',
        dataViewTag = '[object DataView]';
    /** Used to convert symbols to primitives and strings. */

    var symbolProto = Symbol$1 ? Symbol$1.prototype : undefined,
        symbolValueOf = symbolProto ? symbolProto.valueOf : undefined;
    /**
     * A specialized version of `baseIsEqualDeep` for comparing objects of
     * the same `toStringTag`.
     *
     * **Note:** This function only supports comparing values with tags of
     * `Boolean`, `Date`, `Error`, `Number`, `RegExp`, or `String`.
     *
     * @private
     * @param {Object} object The object to compare.
     * @param {Object} other The other object to compare.
     * @param {string} tag The `toStringTag` of the objects to compare.
     * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
     * @param {Function} customizer The function to customize comparisons.
     * @param {Function} equalFunc The function to determine equivalents of values.
     * @param {Object} stack Tracks traversed `object` and `other` objects.
     * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
     */

    function equalByTag$1(object, other, tag, bitmask, customizer, equalFunc, stack) {
      switch (tag) {
        case dataViewTag:
          if (object.byteLength != other.byteLength || object.byteOffset != other.byteOffset) {
            return false;
          }

          object = object.buffer;
          other = other.buffer;

        case arrayBufferTag:
          if (object.byteLength != other.byteLength || !equalFunc(new Uint8Array(object), new Uint8Array(other))) {
            return false;
          }

          return true;

        case boolTag:
        case dateTag:
        case numberTag:
          // Coerce booleans to `1` or `0` and dates to milliseconds.
          // Invalid dates are coerced to `NaN`.
          return eq(+object, +other);

        case errorTag:
          return object.name == other.name && object.message == other.message;

        case regexpTag:
        case stringTag:
          // Coerce regexes to strings and treat strings, primitives and objects,
          // as equal. See http://www.ecma-international.org/ecma-262/7.0/#sec-regexp.prototype.tostring
          // for more details.
          return object == other + '';

        case mapTag:
          var convert = mapToArray;

        case setTag:
          var isPartial = bitmask & COMPARE_PARTIAL_FLAG$3;
          convert || (convert = setToArray);

          if (object.size != other.size && !isPartial) {
            return false;
          } // Assume cyclic values are equal.


          var stacked = stack.get(object);

          if (stacked) {
            return stacked == other;
          }

          bitmask |= COMPARE_UNORDERED_FLAG$1; // Recursively compare objects (susceptible to call stack limits).

          stack.set(object, other);
          var result = equalArrays$1(convert(object), convert(other), bitmask, customizer, equalFunc, stack);
          stack['delete'](object);
          return result;

        case symbolTag:
          if (symbolValueOf) {
            return symbolValueOf.call(object) == symbolValueOf.call(other);
          }

      }

      return false;
    }

    var _equalByTag = equalByTag$1;

    var getAllKeys = _getAllKeys;
    /** Used to compose bitmasks for value comparisons. */

    var COMPARE_PARTIAL_FLAG$2 = 1;
    /** Used for built-in method references. */

    var objectProto$1 = Object.prototype;
    /** Used to check objects for own properties. */

    var hasOwnProperty$1 = objectProto$1.hasOwnProperty;
    /**
     * A specialized version of `baseIsEqualDeep` for objects with support for
     * partial deep comparisons.
     *
     * @private
     * @param {Object} object The object to compare.
     * @param {Object} other The other object to compare.
     * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
     * @param {Function} customizer The function to customize comparisons.
     * @param {Function} equalFunc The function to determine equivalents of values.
     * @param {Object} stack Tracks traversed `object` and `other` objects.
     * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
     */

    function equalObjects$1(object, other, bitmask, customizer, equalFunc, stack) {
      var isPartial = bitmask & COMPARE_PARTIAL_FLAG$2,
          objProps = getAllKeys(object),
          objLength = objProps.length,
          othProps = getAllKeys(other),
          othLength = othProps.length;

      if (objLength != othLength && !isPartial) {
        return false;
      }

      var index = objLength;

      while (index--) {
        var key = objProps[index];

        if (!(isPartial ? key in other : hasOwnProperty$1.call(other, key))) {
          return false;
        }
      } // Check that cyclic values are equal.


      var objStacked = stack.get(object);
      var othStacked = stack.get(other);

      if (objStacked && othStacked) {
        return objStacked == other && othStacked == object;
      }

      var result = true;
      stack.set(object, other);
      stack.set(other, object);
      var skipCtor = isPartial;

      while (++index < objLength) {
        key = objProps[index];
        var objValue = object[key],
            othValue = other[key];

        if (customizer) {
          var compared = isPartial ? customizer(othValue, objValue, key, other, object, stack) : customizer(objValue, othValue, key, object, other, stack);
        } // Recursively compare objects (susceptible to call stack limits).


        if (!(compared === undefined ? objValue === othValue || equalFunc(objValue, othValue, bitmask, customizer, stack) : compared)) {
          result = false;
          break;
        }

        skipCtor || (skipCtor = key == 'constructor');
      }

      if (result && !skipCtor) {
        var objCtor = object.constructor,
            othCtor = other.constructor; // Non `Object` object instances with different constructors are not equal.

        if (objCtor != othCtor && 'constructor' in object && 'constructor' in other && !(typeof objCtor == 'function' && objCtor instanceof objCtor && typeof othCtor == 'function' && othCtor instanceof othCtor)) {
          result = false;
        }
      }

      stack['delete'](object);
      stack['delete'](other);
      return result;
    }

    var _equalObjects = equalObjects$1;

    var Stack$1 = _Stack,
        equalArrays = _equalArrays,
        equalByTag = _equalByTag,
        equalObjects = _equalObjects,
        getTag = _getTag,
        isArray = isArray_1,
        isBuffer = isBuffer$3.exports,
        isTypedArray = isTypedArray_1;
    /** Used to compose bitmasks for value comparisons. */

    var COMPARE_PARTIAL_FLAG$1 = 1;
    /** `Object#toString` result references. */

    var argsTag = '[object Arguments]',
        arrayTag = '[object Array]',
        objectTag = '[object Object]';
    /** Used for built-in method references. */

    var objectProto = Object.prototype;
    /** Used to check objects for own properties. */

    var hasOwnProperty = objectProto.hasOwnProperty;
    /**
     * A specialized version of `baseIsEqual` for arrays and objects which performs
     * deep comparisons and tracks traversed objects enabling objects with circular
     * references to be compared.
     *
     * @private
     * @param {Object} object The object to compare.
     * @param {Object} other The other object to compare.
     * @param {number} bitmask The bitmask flags. See `baseIsEqual` for more details.
     * @param {Function} customizer The function to customize comparisons.
     * @param {Function} equalFunc The function to determine equivalents of values.
     * @param {Object} [stack] Tracks traversed `object` and `other` objects.
     * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
     */

    function baseIsEqualDeep$1(object, other, bitmask, customizer, equalFunc, stack) {
      var objIsArr = isArray(object),
          othIsArr = isArray(other),
          objTag = objIsArr ? arrayTag : getTag(object),
          othTag = othIsArr ? arrayTag : getTag(other);
      objTag = objTag == argsTag ? objectTag : objTag;
      othTag = othTag == argsTag ? objectTag : othTag;
      var objIsObj = objTag == objectTag,
          othIsObj = othTag == objectTag,
          isSameTag = objTag == othTag;

      if (isSameTag && isBuffer(object)) {
        if (!isBuffer(other)) {
          return false;
        }

        objIsArr = true;
        objIsObj = false;
      }

      if (isSameTag && !objIsObj) {
        stack || (stack = new Stack$1());
        return objIsArr || isTypedArray(object) ? equalArrays(object, other, bitmask, customizer, equalFunc, stack) : equalByTag(object, other, objTag, bitmask, customizer, equalFunc, stack);
      }

      if (!(bitmask & COMPARE_PARTIAL_FLAG$1)) {
        var objIsWrapped = objIsObj && hasOwnProperty.call(object, '__wrapped__'),
            othIsWrapped = othIsObj && hasOwnProperty.call(other, '__wrapped__');

        if (objIsWrapped || othIsWrapped) {
          var objUnwrapped = objIsWrapped ? object.value() : object,
              othUnwrapped = othIsWrapped ? other.value() : other;
          stack || (stack = new Stack$1());
          return equalFunc(objUnwrapped, othUnwrapped, bitmask, customizer, stack);
        }
      }

      if (!isSameTag) {
        return false;
      }

      stack || (stack = new Stack$1());
      return equalObjects(object, other, bitmask, customizer, equalFunc, stack);
    }

    var _baseIsEqualDeep = baseIsEqualDeep$1;

    var baseIsEqualDeep = _baseIsEqualDeep,
        isObjectLike = isObjectLike_1;
    /**
     * The base implementation of `_.isEqual` which supports partial comparisons
     * and tracks traversed objects.
     *
     * @private
     * @param {*} value The value to compare.
     * @param {*} other The other value to compare.
     * @param {boolean} bitmask The bitmask flags.
     *  1 - Unordered comparison
     *  2 - Partial comparison
     * @param {Function} [customizer] The function to customize comparisons.
     * @param {Object} [stack] Tracks traversed `value` and `other` objects.
     * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
     */

    function baseIsEqual$1(value, other, bitmask, customizer, stack) {
      if (value === other) {
        return true;
      }

      if (value == null || other == null || !isObjectLike(value) && !isObjectLike(other)) {
        return value !== value && other !== other;
      }

      return baseIsEqualDeep(value, other, bitmask, customizer, baseIsEqual$1, stack);
    }

    var _baseIsEqual = baseIsEqual$1;

    var Stack = _Stack,
        baseIsEqual = _baseIsEqual;
    /** Used to compose bitmasks for value comparisons. */

    var COMPARE_PARTIAL_FLAG = 1,
        COMPARE_UNORDERED_FLAG = 2;
    /**
     * The base implementation of `_.isMatch` without support for iteratee shorthands.
     *
     * @private
     * @param {Object} object The object to inspect.
     * @param {Object} source The object of property values to match.
     * @param {Array} matchData The property names, values, and compare flags to match.
     * @param {Function} [customizer] The function to customize comparisons.
     * @returns {boolean} Returns `true` if `object` is a match, else `false`.
     */

    function baseIsMatch$1(object, source, matchData, customizer) {
      var index = matchData.length,
          length = index,
          noCustomizer = !customizer;

      if (object == null) {
        return !length;
      }

      object = Object(object);

      while (index--) {
        var data = matchData[index];

        if (noCustomizer && data[2] ? data[1] !== object[data[0]] : !(data[0] in object)) {
          return false;
        }
      }

      while (++index < length) {
        data = matchData[index];
        var key = data[0],
            objValue = object[key],
            srcValue = data[1];

        if (noCustomizer && data[2]) {
          if (objValue === undefined && !(key in object)) {
            return false;
          }
        } else {
          var stack = new Stack();

          if (customizer) {
            var result = customizer(objValue, srcValue, key, object, source, stack);
          }

          if (!(result === undefined ? baseIsEqual(srcValue, objValue, COMPARE_PARTIAL_FLAG | COMPARE_UNORDERED_FLAG, customizer, stack) : result)) {
            return false;
          }
        }
      }

      return true;
    }

    var _baseIsMatch = baseIsMatch$1;

    var isObject = isObject_1;
    /**
     * Checks if `value` is suitable for strict equality comparisons, i.e. `===`.
     *
     * @private
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` if suitable for strict
     *  equality comparisons, else `false`.
     */

    function isStrictComparable$1(value) {
      return value === value && !isObject(value);
    }

    var _isStrictComparable = isStrictComparable$1;

    var isStrictComparable = _isStrictComparable,
        keys = keys_1;
    /**
     * Gets the property names, values, and compare flags of `object`.
     *
     * @private
     * @param {Object} object The object to query.
     * @returns {Array} Returns the match data of `object`.
     */

    function getMatchData$1(object) {
      var result = keys(object),
          length = result.length;

      while (length--) {
        var key = result[length],
            value = object[key];
        result[length] = [key, value, isStrictComparable(value)];
      }

      return result;
    }

    var _getMatchData = getMatchData$1;

    /**
     * A specialized version of `matchesProperty` for source values suitable
     * for strict equality comparisons, i.e. `===`.
     *
     * @private
     * @param {string} key The key of the property to get.
     * @param {*} srcValue The value to match.
     * @returns {Function} Returns the new spec function.
     */

    function matchesStrictComparable$1(key, srcValue) {
      return function (object) {
        if (object == null) {
          return false;
        }

        return object[key] === srcValue && (srcValue !== undefined || key in Object(object));
      };
    }

    var _matchesStrictComparable = matchesStrictComparable$1;

    var baseIsMatch = _baseIsMatch,
        getMatchData = _getMatchData,
        matchesStrictComparable = _matchesStrictComparable;
    /**
     * The base implementation of `_.matches` which doesn't clone `source`.
     *
     * @private
     * @param {Object} source The object of property values to match.
     * @returns {Function} Returns the new spec function.
     */

    function baseMatches$1(source) {
      var matchData = getMatchData(source);

      if (matchData.length == 1 && matchData[0][2]) {
        return matchesStrictComparable(matchData[0][0], matchData[0][1]);
      }

      return function (object) {
        return object === source || baseIsMatch(object, source, matchData);
      };
    }

    var _baseMatches = baseMatches$1;

    var baseClone = _baseClone,
        baseMatches = _baseMatches;
    /** Used to compose bitmasks for cloning. */

    var CLONE_DEEP_FLAG = 1;
    /**
     * Creates a function that performs a partial deep comparison between a given
     * object and `source`, returning `true` if the given object has equivalent
     * property values, else `false`.
     *
     * **Note:** The created function is equivalent to `_.isMatch` with `source`
     * partially applied.
     *
     * Partial comparisons will match empty array and empty object `source`
     * values against any array or object value, respectively. See `_.isEqual`
     * for a list of supported value comparisons.
     *
     * **Note:** Multiple values can be checked by combining several matchers
     * using `_.overSome`
     *
     * @static
     * @memberOf _
     * @since 3.0.0
     * @category Util
     * @param {Object} source The object of property values to match.
     * @returns {Function} Returns the new spec function.
     * @example
     *
     * var objects = [
     *   { 'a': 1, 'b': 2, 'c': 3 },
     *   { 'a': 4, 'b': 5, 'c': 6 }
     * ];
     *
     * _.filter(objects, _.matches({ 'a': 4, 'c': 6 }));
     * // => [{ 'a': 4, 'b': 5, 'c': 6 }]
     *
     * // Checking for several possible values
     * _.filter(objects, _.overSome([_.matches({ 'a': 1 }), _.matches({ 'a': 4 })]));
     * // => [{ 'a': 1, 'b': 2, 'c': 3 }, { 'a': 4, 'b': 5, 'c': 6 }]
     */

    function matches(source) {
      return baseMatches(baseClone(source, CLONE_DEEP_FLAG));
    }

    var matches_1 = matches;

    /**
     * Checks each {@link ContextSource} for forced activation conditions.
     */
    var $ActForced = usModule((require, exports) => {
        const { REASONS } = require(ContextBuilder$2);
        const forcedTypes = new Set(["story", "memory", "an", "unknown"]);
        const isForceActivated = conforms_1({
            entry: conforms_1({
                fieldConfig: matches_1({
                    // Obviously, must be true.
                    forceActivation: true
                })
            })
        });
        const checkSource = (source) => {
            if (forcedTypes.has(source.type))
                return REASONS.Default;
            if (isForceActivated(source))
                return REASONS.ActivationForced;
            return undefined;
        };
        const checkActivation = (states) => states.pipe(collect((state) => {
            const reason = checkSource(state.source);
            if (!reason)
                return undefined;
            state.activations.set("forced", reason);
            return state;
        }));
        return Object.assign(exports, { checkActivation });
    });

    /**
     * Checks each {@link ContextSource} for keyword activations against
     * the story text.
     */
    var $ActKeyed = usModule((require, exports) => {
        const { search, searchForLore } = SearchService(require);
        const isKeyed = conforms_1({
            entry: conforms_1({
                fieldConfig: conforms_1({
                    // Need a non-empty array to qualify.
                    keys: (v) => isArray$4(v) && Boolean(v.length)
                })
            })
        });
        /**
         * Version that waits for all entries to come through, then searches through
         * all their keys in one big batch.
         */
        async function* impl_checkActivation_batched(storySource, sources) {
            // First, grab all sources with entries that can do keyword searching.
            const keyedSources = new Map();
            for await (const state of eachValueFrom(sources)) {
                const { source } = state;
                if (!isKeyed(source))
                    continue;
                keyedSources.set(source.entry, state);
            }
            // Now check all these entries for matches on the story text and
            // yield any that have activated.
            const searchResults = searchForLore(storySource.entry.searchedText, [...keyedSources.keys()]);
            for (const [entry, results] of searchResults) {
                if (!results.size)
                    continue;
                const state = keyedSources.get(entry);
                state.activations.set("keyed", results);
                yield state;
            }
        }
        const checkActivation = (storySource) => (sources) => from(impl_checkActivation_batched(storySource, sources));
        return Object.assign(exports, { checkActivation });
    });

    class EphemeralHelpers extends ModuleDef {
        constructor() {
            super(...arguments);
            this.moduleId = 67325;
            this.expectedExports = 4;
            this.mapping = {
                "In": ["checkActivation", "function"]
            };
        }
    }
    var EphemeralHelpers$1 = new EphemeralHelpers();

    var $ActEphemeral = usModule((require, exports) => {
        const helpers = require(EphemeralHelpers$1);
        // We're going to be sloppy with this one; there's too many
        // entangled properties to check for.
        const isEphemeral = (state) => state.source.type === "ephemeral";
        const checkActivation = (storyContent) => {
            const step = storyContent.getStoryStep();
            return (states) => states.pipe(filter(isEphemeral), filter(({ source: { entry } }) => helpers.checkActivation(entry.field, step)), tap((state) => state.activations.set("ephemeral", true)));
        };
        return Object.assign(exports, { checkActivation });
    });

    const logger$1 = createLogger("Cascade Activation");
    /**
     * Checks each {@link ContextSource} for cascade activation.
     */
    var $ActCascade = usModule((require, exports) => {
        const { searchForLore } = SearchService(require);
        const isCascading = conforms_1({
            source: conforms_1({
                entry: conforms_1({
                    fieldConfig: conforms_1({
                        // Need a non-empty array to qualify.
                        keys: (v) => isArray$4(v) && Boolean(v.length),
                        // Cascading is active when `true`.
                        nonStoryActivatable: (v) => v === true
                    })
                })
            })
        });
        const checkActivation = (sources) => (directActivations) => sources.pipe(filter(isCascading), toArray(), 
        // Starting from `directActivations`, we check for cascading activations.
        // Any entries activated by cascade will then go through this `expand`
        // operator themselves, which may activate additional entries and so on
        // until we get through an expansion without activating any new entries.
        mergeMap((cascadingStates) => {
            logger$1.info("Sources:", cascadingStates);
            const entryKvps = new Map(cascadingStates.map((s) => [s.source.entry, s]));
            function* doCascade(activatedState) {
                const { source: activated } = activatedState;
                // Do not match on the story again.
                if (activated.type === "story")
                    return;
                logger$1.info("Searching activated:", activatedState);
                const entryToState = new Map(entryKvps);
                // Do not cascade off yourself.
                entryToState.delete(activated.entry);
                // The cascade's degree determines how many degrees of separation a
                // cascade activation is from a direct activation.
                const curDegree = (activatedState.activations.get("cascade")?.initialDegree ?? 0) + 1;
                // Check the keys for all cascading sources against the entry's
                // assembled text.
                const searchResults = searchForLore(activated.entry.searchedText, [...entryToState.keys()], true);
                for (const [entry, results] of searchResults) {
                    if (!results.size)
                        continue;
                    const state = entryToState.get(entry);
                    const firstActivation = state.activations.size === 0;
                    // Pull the activation data for an upsert.
                    const data = state.activations.get("cascade") ?? {
                        initialDegree: curDegree,
                        finalDegree: curDegree,
                        matches: new Map()
                    };
                    data.matches.set(activated, Object.assign(results, { matchDegree: curDegree }));
                    state.activations.set("cascade", data);
                    // Update the final degree based on the current degree.
                    data.finalDegree = Math.max(curDegree, data.finalDegree);
                    // If this was the first time this activated, yield it.
                    if (firstActivation)
                        yield state;
                }
            }
            // Set the concurrency to 1, so that each cascade clears out
            // completely and before the next begins; this way we get an
            // accurate `order` value.
            return directActivations.pipe(expand(doCascade, 1));
        }), 
        // The expansion will re-emit `directActivations`, so make sure
        // we limit to only entries that have an actual cascade activation.
        filter((s) => s.activations.has("cascade")));
        return Object.assign(exports, { checkActivation });
    });

    /**
     * The Activation Phase takes all the content sources from the
     * Source Phase and determines which ones have qualified to be
     * inserted into the context.
     *
     * In contrast to vanilla NovelAI, this is not a stop-fast process;
     * an entry does not leave the activation process as soon as it
     * finds the first keyword or what have you.  This phase is used to
     * do a bit of data gathering, which will help inform later phases
     * on how to best construct the context.
     */
    var $Activation = usModule((require, exports) => {
        const activation = {
            cascade: $ActCascade(require).checkActivation,
            ephemeral: $ActEphemeral(require).checkActivation,
            forced: $ActForced(require).checkActivation,
            keyed: $ActKeyed(require).checkActivation
        };
        function activationPhase(
        /** The context builder parameters. */
        contextParams, 
        /** The story's source. */
        storySource, 
        /** The in-flight enabled sources. */
        enabledSources) {
            const logger = createLogger(`Activation Phase: ${contextParams.contextName}`);
            const activationStates = enabledSources.pipe(map((source) => ({ source, activations: new Map() })), shareReplay());
            // Stream through the direct activations.
            const directActivations = merge(activationStates.pipe(activation.forced), activationStates.pipe(activation.ephemeral(contextParams.storyContent)), 
            // Still cheating to get as much done while waiting on the story.
            storySource.pipe(map(activation.keyed), mergeMap((keyedActivator) => keyedActivator(activationStates)))).pipe(
            // Sources may directly activate more than once.  We're gathering as
            // much data on activation as possible, but the cascade wants
            // only one direct activation each.
            distinct(), shareReplay());
            // Join in the cascade.
            const withCascade = merge(directActivations, directActivations.pipe(activation.cascade(activationStates)));
            // The stream of in-flight activations.  Be aware that when a source comes
            // down the pipeline, we only know it activated.  The information in its
            // `activations` should be assumed to be incomplete until this entire
            // observable completes.
            const inFlightActivations = withCascade.pipe(
            // Again, only emit one activation per source; the cascade may now have
            // added some duplicates.
            distinct(), map(({ source, activations }) => Object.assign(source, {
                activated: true,
                activations
            })), logger.measureStream("In-flight Activations"), shareReplay());
            const inFlightRejections = activationStates.pipe(rejectedBy(inFlightActivations, {
                source: ({ source }) => source.uniqueId,
                output: (source) => source.uniqueId
            }), map(({ source, activations }) => Object.assign(source, {
                activated: false,
                activations
            })), logger.measureStream("In-flight Rejections"), shareReplay());
            const inFlight = merge(inFlightRejections, inFlightActivations).pipe(logger.measureStream("In-flight Results").markItems((source) => {
                const state = source.activations.size ? "activated" : "rejected";
                return `${source.identifier} (${state})`;
            }), shareReplay());
            return lazyObject({
                rejected: () => inFlightRejections.pipe(toArray(), followUpAfter(inFlightActivations), map((sources) => new Set(sources)), shareReplay(1)),
                activated: () => inFlightActivations.pipe(toArray(), followUpAfter(inFlightActivations), map((sources) => new Set(sources)), shareReplay(1)),
                inFlight: () => inFlight
            });
        }
        return Object.assign(exports, activation, { phaseRunner: activationPhase });
    });

    /**
     * A selector with no bells-and-whistles.
     * - It drops any entries that activated by keyword against the story,
     *   but that keyword was outside of the configured search range.
     *   With vanilla rules, this entry never would have activated, so
     *   that is resolved here.
     * - It sorts the final output into its insertion order.  For the
     *   purposes of experimentation, this sorting order is configurable.
     *
     * Configuration that affects this module:
     * - Disabled by `weightedRandom.enabled`.
     * - Output ordering affected by `selection.insertionOrdering`.
     */
    var $Vanilla = usModule((require, exports) => {
        const queryOps = $QueryOps(require);
        const cursorOps = $CursorOps(require);
        const cursors = $Cursors(require);
        const { sorting, selection } = $Common(require);
        /**
         * Sorts all inputs and emits them in order of their formalized insertion
         * priority.  This will also calculate each emitted element's budget stats.
         */
        const createStream = (contextParams, storySource) => {
            const sortingFn = sorting.forInsertion(contextParams);
            const hasSearchRange = (source) => "searchRange" in source.entry.fieldConfig;
            return (sources) => storySource.pipe(mergeMap((s) => {
                // The search range is in characters of the story that were searchable.
                // We'll want to start relative to the full-text of the story and
                // then convert back to a fragment cursor.
                const { searchedText } = s.entry;
                const ftLength = queryOps.getText(searchedText).length;
                return sources.pipe(
                // Activation does not take search range into account.  We'll do
                // that here.
                collect((source) => {
                    // If it has no search range, we can't check this and select the
                    // source by default.
                    if (!hasSearchRange(source))
                        return source;
                    // NovelAI does apply search range to the cascade, but this
                    // user-script is opting not to bother.  Reasoning is, the cascade
                    // is defining relationships between two static entries.  The
                    // location of the matched keyword is not really relevant.
                    // Search range only seems useful as yet another obtuse way to
                    // control entry priority, by giving the user the ability to author
                    // entries that can activate against more or less text; allotting
                    // more text to match against increases the chances of activation.
                    // Therefore, this is only relevant to the dynamic story text.
                    // We'll check this if a story keyword match was the only method
                    // of activation.
                    const keyed = source.activations.get("keyed");
                    if (!keyed || source.activations.size > 1)
                        return source;
                    const { searchRange } = source.entry.fieldConfig;
                    const ftOffset = ftLength - searchRange;
                    // It can only be inside the search range.
                    if (ftOffset <= 0)
                        return source;
                    // Perform the cursor re-mapping to get the minimum offset allowed.
                    const ftCursor = cursors.fullText(searchedText, ftOffset);
                    const { offset: minRange } = cursorOps.fromFullText(searchedText, ftCursor);
                    const selections = chain(keyed.values())
                        .flatten()
                        .map((r) => r.selection)
                        .value();
                    // At least one selection must have both its cursors in range.
                    for (const [l, r] of selections) {
                        if (l.offset < minRange)
                            continue;
                        if (r.offset < minRange)
                            continue;
                        return source;
                    }
                    return undefined;
                }));
            }), mergeMap(selection.asBudgeted), toArray(), mergeMap((arr) => arr.sort(sortingFn)));
        };
        return Object.assign(exports, { createStream });
    });

    var _Roulette_instances, _Roulette_entries, _Roulette_totalWeight, _Roulette_count, _Roulette_spin;
    /**
     * Class that can randomly select an item from a weighted selection.
     */
    class Roulette {
        constructor() {
            _Roulette_instances.add(this);
            _Roulette_entries.set(this, void 0);
            _Roulette_totalWeight.set(this, void 0);
            _Roulette_count.set(this, void 0);
            __classPrivateFieldSet(this, _Roulette_entries, [], "f");
            __classPrivateFieldSet(this, _Roulette_totalWeight, 0, "f");
            __classPrivateFieldSet(this, _Roulette_count, 0, "f");
        }
        get count() { return __classPrivateFieldGet(this, _Roulette_count, "f"); }
        /**
         * Adds a value to the pool.
         */
        push(weight, data) {
            __classPrivateFieldGet(this, _Roulette_entries, "f").push({ weight, data });
            __classPrivateFieldSet(this, _Roulette_totalWeight, __classPrivateFieldGet(this, _Roulette_totalWeight, "f") + weight, "f");
            __classPrivateFieldSet(this, _Roulette_count, __classPrivateFieldGet(this, _Roulette_count, "f") + 1, "f");
        }
        /**
         * Selects a value from the pool.
         */
        pick() {
            const thePick = __classPrivateFieldGet(this, _Roulette_instances, "m", _Roulette_spin).call(this);
            if (thePick === -1)
                return undefined;
            const { weight, data } = assertExists("Expected picked entry to exist.", __classPrivateFieldGet(this, _Roulette_entries, "f")[thePick]);
            return [data, weight];
        }
        /**
         * Selects and removes a value from the pool.
         */
        pickAndPop() {
            const thePick = __classPrivateFieldGet(this, _Roulette_instances, "m", _Roulette_spin).call(this);
            if (thePick === -1)
                return undefined;
            const { weight, data } = assertExists("Expected picked entry to exist.", __classPrivateFieldGet(this, _Roulette_entries, "f")[thePick]);
            __classPrivateFieldGet(this, _Roulette_entries, "f")[thePick] = undefined;
            __classPrivateFieldSet(this, _Roulette_totalWeight, __classPrivateFieldGet(this, _Roulette_totalWeight, "f") - weight, "f");
            __classPrivateFieldSet(this, _Roulette_count, __classPrivateFieldGet(this, _Roulette_count, "f") - 1, "f");
            return [data, weight];
        }
        /**
         * Creates an iterable that picks values from the pool, removing them
         * as it goes.
         */
        *pickToExhaustion() {
            while (__classPrivateFieldGet(this, _Roulette_count, "f") > 0)
                yield this.pickAndPop();
        }
    }
    _Roulette_entries = new WeakMap(), _Roulette_totalWeight = new WeakMap(), _Roulette_count = new WeakMap(), _Roulette_instances = new WeakSet(), _Roulette_spin = function _Roulette_spin() {
        if (__classPrivateFieldGet(this, _Roulette_count, "f") === 0)
            return -1;
        const limit = __classPrivateFieldGet(this, _Roulette_entries, "f").length;
        const ball = Math.random() * __classPrivateFieldGet(this, _Roulette_totalWeight, "f");
        let curWeight = 0;
        for (let i = 0; i < limit; i++) {
            const curEntry = __classPrivateFieldGet(this, _Roulette_entries, "f")[i];
            if (!curEntry)
                continue;
            curWeight += curEntry.weight;
            if (ball <= curWeight)
                return i;
        }
        return limit - 1;
    };

    /**
     * A selector using weighted-random selection.  Uses various information
     * to score and select entries, where those with a higher score are more
     * likely to be selected.
     * - Groups entries into selection pools.  This is affected by the
     *   `selectionOrdering` config, but the intended gist is that only
     *   entries that share the same `budgetPriority` will be grouped.
     * - The force activated and ephemeral activated entries are always
     *   selected first and before any random selections.
     * - Only keyed and cascading entries are randomly selected.
     * - Sorts all entries into the final insertion order.  In order for
     *   the selection to work correctly, ensure the `selectionIndex` sorter
     *   is added to the `selection.insertionOrdering` config.
     *
     * Configuration that affects this module:
     * - Enabled by `weightedRandom.enabled`.
     * - Grouping criteria affected by `weightedRandom.selectionOrdering`.
     * - Output ordering affected by `selection.insertionOrdering`.
     */
    var $WeightedRandom = usModule((require, exports) => {
        const { sorting, selection, weights } = $Common(require);
        /**
        * Sorts all inputs and emits them in order of their formalized insertion
        * priority.  This will also calculate each emitted element's budget stats.
        */
        const createStream = (contextParams) => {
            const logger = createLogger(`Weighted Selection: ${contextParams.contextName}`);
            const selectionSort = sorting.forWeightedSelection(contextParams);
            const insertionSort = sorting.forInsertion(contextParams);
            const determineEligible = (source) => {
                const { activations } = source;
                if (activations.has("forced"))
                    return "ineligible";
                if (activations.has("ephemeral"))
                    return "ineligible";
                return "eligible";
            };
            function* doWeighting(selectionGroup, weightingFn) {
                const { ineligible = [], eligible = [] } = chain(selectionGroup)
                    .thru((sources) => groupBy(sources, determineEligible))
                    .value(fromPairs);
                // Ineligible entries are always selected.
                for (const source of ineligible) {
                    logger.info(`Selected "${source.identifier}" implicitly.`);
                    yield source;
                }
                // Fast-path: if there are no eligible entries, we're done.
                if (eligible.length === 0)
                    return;
                const roulette = new Roulette();
                for (const source of eligible) {
                    const score = weightingFn(source);
                    if (score <= 0)
                        continue;
                    roulette.push(score, source);
                }
                let selectionIndex = 0;
                for (const [source, weight] of roulette.pickToExhaustion()) {
                    logger.info(`Selected "${source.identifier}" with score ${weight.toFixed(2)}.`);
                    yield Object.assign(source, { selectionIndex });
                    selectionIndex += 1;
                }
            }
            return (sources) => {
                const weightingFn = sources.pipe(toArray(), map((allSources) => weights.forScoring(contextParams, allSources)));
                const selectionGroups = sources.pipe(toArray(), map((arr) => arr.sort(selectionSort)), mergeMap((arr) => batch(arr, selectionSort)), tap((group) => logger.info("Selection Group", group)));
                return selectionGroups.pipe(withLatestFrom(weightingFn), mergeMap((args) => doWeighting(...args)), mergeMap(selection.asBudgeted), toArray(), mergeMap((arr) => arr.sort(insertionSort)));
            };
        };
        return Object.assign(exports, { createStream });
    });

    /**
     * Since the selection mechanism is based on the config, this module
     * just re-exports the configured one so the category sub-context
     * can make use of it.
     */
    var $Configured = usModule((require, exports) => {
        {
            const { createStream } = $WeightedRandom(require);
            return Object.assign(exports, { createStream });
        }
    });

    /**
     * The Selection Phase is responsible for determining how to prioritize
     * entries within the budgetary constraints of the context.  It has its
     * fingers in:
     * - Preparing information on budgeting, such as token reservations.
     * - Determining how entries are prioritized versus one another and
     *   which might need to be dropped in order to get those higher
     *   priority entries into the context.
     * - Establishing the coarse order of insertion for those entries
     *   that were selected for insertion.
     */
    var $Selection = usModule((require, exports) => {
        const selectors = {
            vanilla: $Vanilla(require).createStream,
            weightedRandom: $WeightedRandom(require).createStream,
            configured: $Configured(require).createStream
        };
        /**
         * This will be used at the end to provide `actualReservedTokens` to the
         * user in the report, but it isn't really used for insertion or trimming.
         */
        function selectionPhase(
        /** The context builder parameters. */
        contextParams, 
        /** The story's source. */
        storySource, 
        /** The fully activated set of sources. */
        activatedSet) {
            const logger = createLogger(`Selection Phase: ${contextParams.contextName}`);
            // Flatten the set back out.
            const activatedSources = activatedSet.pipe(mergeAll());
            const inFlightSelected = activatedSources.pipe(selectors.configured(contextParams, storySource), logger.measureStream("In-flight Selected"), shareReplay());
            return lazyObject({
                totalReservedTokens: () => inFlightSelected.pipe(reduce((tokens, { budgetStats }) => tokens + budgetStats.actualReservedTokens, 0), shareReplay(1)),
                selected: () => inFlightSelected.pipe(toArray(), map((sources) => new Set(sources)), shareReplay(1)),
                unselected: () => activatedSources.pipe(rejectedBy(inFlightSelected, (source) => source.uniqueId), logger.measureStream("In-flight Unselected"), toArray(), map((sources) => new Set(sources)), shareReplay(1)),
                inFlight: () => inFlightSelected
            });
        }
        return Object.assign(exports, selectors, { phaseRunner: selectionPhase });
    });

    var $ContextAssembler = usModule((require, exports) => {
        var _ContextAssembler_instances, _ContextAssembler_reportSubject, _ContextAssembler_reportObs, _ContextAssembler_insertions, _ContextAssembler_rejections, _ContextAssembler_finalAssembly, _ContextAssembler_waitingGroups_get, _ContextAssembler_categoryGroups, _ContextAssembler_logger, _ContextAssembler_assembly, _ContextAssembler_reservedTokens, _ContextAssembler_consumedTokens_get, _ContextAssembler_availableTokens_get, _ContextAssembler_currentBudget_get, _ContextAssembler_determineType, _ContextAssembler_updateReservations, _ContextAssembler_determineBudget, _ContextAssembler_doReport, _ContextAssembler_doInsertEntry, _ContextAssembler_doInsertCategoryEntry, _ContextAssembler_doInsertGroup, _ContextAssembler_doInsert;
        const { REASONS } = require(ContextBuilder$2);
        const { CompoundAssembly } = theModule$3(require);
        const { isContextGroup, isCategoryGroup } = theModule$2(require);
        const { selection, categories } = $Common(require);
        const NO_SPACE = Object.freeze({
            type: "rejected",
            reason: REASONS.NoSpace,
            tokensUsed: 0,
            shunted: 0
        });
        const getInsertionText = (result) => {
            if (result.type === "initial")
                return undefined;
            const { insertionType, offset } = result.location;
            const pluralize = offset !== 1 ? "s" : "";
            switch (insertionType) {
                case "newline": return `${offset} newline${pluralize}`;
                case "sentence": return `${offset} sentence${pluralize}`;
                case "token": return `${offset} word${pluralize}`;
                default: return undefined;
            }
        };
        const getStartText = (result) => {
            if (result.type === "initial")
                return "as initial entry";
            const { location } = result;
            if (location.isKeyRelative) {
                switch (location.direction) {
                    case "toBottom": return "after last found key";
                    case "toTop": return "before last found key";
                }
            }
            else {
                switch (location.direction) {
                    case "toBottom": return "from top";
                    case "toTop": return "from bottom";
                }
            }
        };
        const getGroupText = (group, inserted) => {
            if (!group)
                return undefined;
            if (inserted)
                return `of group "${group.identifier}"`;
            return `of pending group "${group.identifier}"`;
        };
        const getRelativeText = (result) => {
            if (result.type === "initial")
                return undefined;
            const ident = result.target.source?.identifier;
            if (!ident)
                return undefined;
            switch (result.type) {
                case "insertBefore": return `and before "${ident}"`;
                case "insertAfter": return `and after "${ident}"`;
                case "inside": return `into "${ident}"`;
            }
        };
        const getShuntingText = (result) => result.shunted ? `(shunted ${result.shunted} characters out of target)` : undefined;
        const isInserted = (report) => report.result.type !== "rejected";
        const isRejected = (report) => report.result.type === "rejected";
        class ContextAssembler {
            constructor(contextParams, contextGroups, reservedTokens) {
                _ContextAssembler_instances.add(this);
                _ContextAssembler_reportSubject.set(this, void 0);
                _ContextAssembler_reportObs.set(this, void 0);
                _ContextAssembler_insertions.set(this, void 0);
                _ContextAssembler_rejections.set(this, void 0);
                _ContextAssembler_finalAssembly.set(this, void 0);
                _ContextAssembler_categoryGroups.set(this, void 0);
                _ContextAssembler_logger.set(this, void 0);
                _ContextAssembler_assembly.set(this, void 0);
                _ContextAssembler_reservedTokens.set(this, void 0);
                const { tokenCodec, contextSize, contextName } = contextParams;
                __classPrivateFieldSet(this, _ContextAssembler_reservedTokens, reservedTokens, "f");
                __classPrivateFieldSet(this, _ContextAssembler_logger, createLogger(`ContextAssembler: ${contextName}`), "f");
                __classPrivateFieldSet(this, _ContextAssembler_assembly, new CompoundAssembly(tokenCodec, contextSize), "f");
                __classPrivateFieldSet(this, _ContextAssembler_reportSubject, new Subject(), "f");
                __classPrivateFieldSet(this, _ContextAssembler_reportObs, __classPrivateFieldGet(this, _ContextAssembler_reportSubject, "f").pipe(__classPrivateFieldGet(this, _ContextAssembler_logger, "f").measureStream("In-Flight Assembly Reports").markItems((item) => {
                    const status = isInserted(item) ? "inserted" : "rejected";
                    return `${item.source.identifier} (${status})`;
                }), share()), "f");
                // Only category-groups exist at the moment, but who knows when that
                // will change.
                __classPrivateFieldSet(this, _ContextAssembler_categoryGroups, new Map(), "f");
                for (const group of contextGroups) {
                    if (!isCategoryGroup(group))
                        continue;
                    const key = group.category.id ?? group.category.name;
                    __classPrivateFieldGet(this, _ContextAssembler_categoryGroups, "f").set(key, group);
                }
            }
            /** The stream of assembler reports. */
            get reports() {
                return __classPrivateFieldGet(this, _ContextAssembler_reportObs, "f");
            }
            /** The stream of reports where an insertion occurred. */
            get insertions() {
                return __classPrivateFieldSet(this, _ContextAssembler_insertions, __classPrivateFieldGet(this, _ContextAssembler_insertions, "f") ?? this.reports.pipe(filter(isInserted), share()), "f");
            }
            /** The stream of reports where an insertion was rejected. */
            get rejections() {
                return __classPrivateFieldSet(this, _ContextAssembler_rejections, __classPrivateFieldGet(this, _ContextAssembler_rejections, "f") ?? this.reports.pipe(filter(isRejected), share()), "f");
            }
            /**
             * The final form of the assembly, after the final report has been emitted.
             *
             * After this emits, the assembler has finished its work.
             */
            get finalAssembly() {
                return __classPrivateFieldSet(this, _ContextAssembler_finalAssembly, __classPrivateFieldGet(this, _ContextAssembler_finalAssembly, "f") ?? from([__classPrivateFieldGet(this, _ContextAssembler_assembly, "f")]).pipe(followUpAfter(this.reports), tap((assembly) => __classPrivateFieldGet(this, _ContextAssembler_logger, "f").info(assembly)), shareReplay(1)), "f");
            }
            /** Subscribes to `selected` and makes this instance's observables hot. */
            connect(selected) {
                // We will need to process each source in order.
                dew(async () => {
                    const subject = __classPrivateFieldGet(this, _ContextAssembler_reportSubject, "f");
                    try {
                        for await (const source of eachValueFrom(selected))
                            await __classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_doInsert).call(this, source);
                        subject.complete();
                    }
                    catch (err) {
                        subject.error(err);
                    }
                });
                return this;
            }
        }
        _ContextAssembler_reportSubject = new WeakMap(), _ContextAssembler_reportObs = new WeakMap(), _ContextAssembler_insertions = new WeakMap(), _ContextAssembler_rejections = new WeakMap(), _ContextAssembler_finalAssembly = new WeakMap(), _ContextAssembler_categoryGroups = new WeakMap(), _ContextAssembler_logger = new WeakMap(), _ContextAssembler_assembly = new WeakMap(), _ContextAssembler_reservedTokens = new WeakMap(), _ContextAssembler_instances = new WeakSet(), _ContextAssembler_waitingGroups_get = function _ContextAssembler_waitingGroups_get() {
            return chain(__classPrivateFieldGet(this, _ContextAssembler_categoryGroups, "f").values())
                .filter((group) => !__classPrivateFieldGet(this, _ContextAssembler_assembly, "f").hasAssembly(group))
                .value();
        }, _ContextAssembler_consumedTokens_get = function _ContextAssembler_consumedTokens_get() {
            const directConsumed = __classPrivateFieldGet(this, _ContextAssembler_assembly, "f").tokens.length;
            // Must account for tokens from uninserted groups.
            return chain(__classPrivateFieldGet(this, _ContextAssembler_instances, "a", _ContextAssembler_waitingGroups_get))
                .reduce(directConsumed, (a, g) => a + g.tokens.length);
        }, _ContextAssembler_availableTokens_get = function _ContextAssembler_availableTokens_get() {
            return Math.max(0, __classPrivateFieldGet(this, _ContextAssembler_assembly, "f").tokenBudget - __classPrivateFieldGet(this, _ContextAssembler_instances, "a", _ContextAssembler_consumedTokens_get));
        }, _ContextAssembler_currentBudget_get = function _ContextAssembler_currentBudget_get() {
            return Math.max(0, __classPrivateFieldGet(this, _ContextAssembler_assembly, "f").availableTokens - __classPrivateFieldGet(this, _ContextAssembler_reservedTokens, "f"));
        }, _ContextAssembler_determineType = function _ContextAssembler_determineType(source) {
            // These get inserted regardless, since we should have been informed of them.
            if (isContextGroup(source))
                return "group";
            // Categorized entries are preferable inserted into their category group.
            // It is possible that a group was not created for the category.
            catChecks: {
                if (!selection.isBudgetedSource(source))
                    break catChecks;
                if (!categories.isCategorized(source))
                    break catChecks;
                const group = __classPrivateFieldGet(this, _ContextAssembler_categoryGroups, "f").get(source.entry.fieldConfig.category);
                if (!group)
                    break catChecks;
                return "forCategory";
            }
            // The run-of-the-mill entry.
            if (selection.isBudgetedSource(source))
                return "basic";
            return "unknown";
        }, _ContextAssembler_updateReservations = function _ContextAssembler_updateReservations(source) {
            const { actualReservedTokens } = source.budgetStats;
            if (actualReservedTokens <= 0)
                return;
            __classPrivateFieldSet(this, _ContextAssembler_reservedTokens, __classPrivateFieldGet(this, _ContextAssembler_reservedTokens, "f") - actualReservedTokens, "f");
            __classPrivateFieldSet(this, _ContextAssembler_reservedTokens, Math.max(0, __classPrivateFieldGet(this, _ContextAssembler_reservedTokens, "f")), "f");
        }, _ContextAssembler_determineBudget = function _ContextAssembler_determineBudget(source) {
            const { actualReservedTokens, reservedTokens, tokenBudget } = source.budgetStats;
            if (actualReservedTokens > 0) {
                // Use at least our reserved tokens, more if we have the room.
                const maxBudget = Math.max(reservedTokens, __classPrivateFieldGet(this, _ContextAssembler_instances, "a", _ContextAssembler_currentBudget_get));
                return Math.min(tokenBudget, maxBudget);
            }
            return Math.min(tokenBudget, __classPrivateFieldGet(this, _ContextAssembler_instances, "a", _ContextAssembler_currentBudget_get));
        }, _ContextAssembler_doReport = function _ContextAssembler_doReport(source, result, prevTokens, group) {
            const reservedTokens = __classPrivateFieldGet(this, _ContextAssembler_reservedTokens, "f");
            const availableTokens = __classPrivateFieldGet(this, _ContextAssembler_instances, "a", _ContextAssembler_availableTokens_get);
            const consumedTokens = __classPrivateFieldGet(this, _ContextAssembler_instances, "a", _ContextAssembler_consumedTokens_get);
            const deltaTokens = prevTokens - availableTokens;
            if (result.type === "rejected") {
                __classPrivateFieldGet(this, _ContextAssembler_reportSubject, "f").next(Object.freeze({
                    source, result,
                    reservedTokens,
                    availableTokens,
                    consumedTokens,
                    deltaTokens
                }));
            }
            else {
                const structuredOutput = [...__classPrivateFieldGet(this, _ContextAssembler_assembly, "f").structuredOutput()];
                const descriptionBody = [
                    getInsertionText(result),
                    getStartText(result),
                    getGroupText(group, group ? __classPrivateFieldGet(this, _ContextAssembler_assembly, "f").hasAssembly(group) : false),
                    getRelativeText(result),
                    getShuntingText(result)
                ].filter(Boolean).join(" ");
                // NovelAI breaks the identifier away from the description...
                // ...and then removes it when it displays it to the user.
                // I suspect this is HTML doing HTML things, though.  They may
                // just not be setting the `white-space` CSS to display it.
                // We'll just do the same in case that's a bug they plan to fix.
                const description = [
                    "\"", source.identifier, "\"",
                    "\n                ",
                    descriptionBody
                ].join("");
                // Save some extra concatenation cost if we're not logging.
                {
                    const descPart = `Inserted "${source.identifier}" ${descriptionBody}`;
                    const tokensPart = `${prevTokens} => ${availableTokens}`;
                    __classPrivateFieldGet(this, _ContextAssembler_logger, "f").info(`${descPart}; ${tokensPart}`);
                }
                __classPrivateFieldGet(this, _ContextAssembler_reportSubject, "f").next(Object.freeze({
                    source, result,
                    reservedTokens,
                    availableTokens,
                    consumedTokens,
                    deltaTokens,
                    description,
                    structuredOutput
                }));
            }
        }, _ContextAssembler_doInsertEntry = async function _ContextAssembler_doInsertEntry(source) {
            const currentTokens = __classPrivateFieldGet(this, _ContextAssembler_instances, "a", _ContextAssembler_availableTokens_get);
            // If we actually hit 0 tokens remaining, we're just straight done.
            if (!currentTokens)
                return __classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_doReport).call(this, source, NO_SPACE, currentTokens);
            __classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_updateReservations).call(this, source);
            const budget = __classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_determineBudget).call(this, source);
            const result = await __classPrivateFieldGet(this, _ContextAssembler_assembly, "f").insert(source, budget);
            __classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_doReport).call(this, source, result, currentTokens);
        }, _ContextAssembler_doInsertCategoryEntry = async function _ContextAssembler_doInsertCategoryEntry(source) {
            const currentTokens = __classPrivateFieldGet(this, _ContextAssembler_instances, "a", _ContextAssembler_availableTokens_get);
            // If we actually hit 0 tokens remaining, we're just straight done.
            if (!currentTokens)
                return __classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_doReport).call(this, source, NO_SPACE, currentTokens);
            // We insert into the category-group instead, but we still need to do
            // accounting of reservations and the overall budget.
            const catId = source.entry.fieldConfig.category;
            const group = assertExists(`Expected to have a category group for ${catId}.`, __classPrivateFieldGet(this, _ContextAssembler_categoryGroups, "f").get(catId));
            __classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_updateReservations).call(this, source);
            const budget = __classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_determineBudget).call(this, source);
            const result = await group.insert(source, budget);
            if (result.type !== "rejected") {
                // On successful insertions, inform our assembly that a group may have
                // changed so it can do token accounting.  It doesn't matter if the
                // group itself has not yet been inserted; it knows what's up.
                await __classPrivateFieldGet(this, _ContextAssembler_assembly, "f").updatedGroup(group);
            }
            __classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_doReport).call(this, source, result, currentTokens, group);
        }, _ContextAssembler_doInsertGroup = async function _ContextAssembler_doInsertGroup(group) {
            const currentTokens = __classPrivateFieldGet(this, _ContextAssembler_instances, "a", _ContextAssembler_availableTokens_get);
            // We will always insert a context-group.  All of its entries should
            // have been budgeted and accounted for ahead of time.
            const result = await __classPrivateFieldGet(this, _ContextAssembler_assembly, "f").insert(group, __classPrivateFieldGet(this, _ContextAssembler_assembly, "f").tokenBudget);
            assert(`Expected context-group \`${group.identifier}\` to be inserted.`, result.type !== "rejected");
            __classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_doReport).call(this, group, result, currentTokens);
        }, _ContextAssembler_doInsert = async function _ContextAssembler_doInsert(source) {
            switch (__classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_determineType).call(this, source)) {
                case "basic": return __classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_doInsertEntry).call(this, source);
                case "forCategory": return __classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_doInsertCategoryEntry).call(this, source);
                case "group": return __classPrivateFieldGet(this, _ContextAssembler_instances, "m", _ContextAssembler_doInsertGroup).call(this, source);
                default: throw Object.assign(new Error("Unknown source."), { source });
            }
        };
        const contextAssembler = (contextParams, contextGroups, reservedTokens) => {
            return (selected) => new ContextAssembler(contextParams, contextGroups, reservedTokens)
                .connect(selected);
        };
        return Object.assign(exports, {
            contextAssembler
        });
    });

    /**
     * The Assembly Phase takes all the entries that have activated and
     * been selected and actually constructs the context.
     *
     * It ultimately is constrained by the current token budget and so
     * does what it can to trim entries down to fit the budget.  It
     * will produce the staged report for the Last Model Input feature
     * with each entry that comes down the pipe.
     *
     * TODO: This is the only phase that doesn't mutate the source.
     * Because of `SourceLike`, it is possible that they are not true
     * `ContextSource` objects; is it worth changing all that for
     * consistency with the other phases...? thinking_face_emoji
     */
    var $Assembly = usModule((require, exports) => {
        const { contextAssembler } = $ContextAssembler(require);
        /**
         * This will be used at the end to provide `actualReservedTokens` to the
         * user in the report, but it isn't really used for insertion or trimming.
         */
        function assemblyPhase(
        /** The context builder parameters. */
        contextParams, 
        /** The total reserved tokens, from the selection phase. */
        totalReservedTokens, 
        /** The currently in-flight insertable and selected entries. */
        inFlightSelections, 
        /** The context groups, if any, from the context groups phase. */
        contextGroups) {
            const assembler = forkJoin([
                contextGroups.pipe(defaultIfEmpty(new Set())),
                totalReservedTokens
            ]).pipe(map((args) => contextAssembler(contextParams, ...args)), map((processFn) => processFn(inFlightSelections)), single(), shareReplay(1));
            // A little weird pulling these out.
            return lazyObject({
                insertions: () => assembler.pipe(mergeMap((assembler) => assembler.insertions)),
                rejections: () => assembler.pipe(mergeMap((assembler) => assembler.rejections)),
                assembly: () => assembler.pipe(mergeMap((assembler) => assembler.finalAssembly))
            });
        }
        return Object.assign(exports, { phaseRunner: assemblyPhase });
    });

    var $Helpers = usModule((require, exports) => {
        /**
         * Determines if the context was empty.
         */
        function isContextEmpty(included) {
            return included.pipe(isEmpty$2());
        }
        /**
         * This doesn't make sense, as we're checking if the story is either
         * NOT trimmed or was trimmed INTO OBLIVION... but it's how NovelAI
         * defines the {@link ContextRecorder.storyTrimmed} property and the
         * output for the preamble relies on this specific behavior.
         */
        function isStoryTrimmedSortOfIDK(allStatuses) {
            return allStatuses.pipe(firstOrEmpty((s) => s.type === "story"), map((s) => s.state !== "partially included"), defaultIfEmpty(false), share());
        }
        function orderZeroPoint(insertedResults) {
            const firstBelowZero = insertedResults.pipe(firstOrEmpty((inserted) => inserted.source.entry.contextConfig.budgetPriority <= 0), map((inserted) => inserted.source.uniqueId), defaultIfEmpty(undefined));
            const lastOutput = insertedResults.pipe(lastOrEmpty(), map((inserted) => inserted.structuredOutput), defaultIfEmpty([]));
            return forkJoin([firstBelowZero, lastOutput]).pipe(map(([firstBelowZero, lastOutput]) => {
                // If there is nothing below zero, then it will be the length of
                // the concatenated output.
                if (firstBelowZero === undefined) {
                    return lastOutput.reduce((a, b) => a + b.text.length, 0);
                }
                // Otherwise, its all the text up-to-but-excluding the first entry
                // inserted at the zero-point.
                return chain(lastOutput)
                    .pipe(takeUntil, (o) => o.identifier === firstBelowZero)
                    .reduce(0, (a, b) => a + b.text.length);
            }));
        }
        return Object.assign(exports, {
            isContextEmpty,
            isStoryTrimmedSortOfIDK,
            orderZeroPoint
        });
    });

    var $Shared = usModule((require, exports) => {
        const { subContexts } = $Common(require);
        /** Just type-checks the ContextStatus interface. */
        const checkThis = (obj) => obj;
        const getSubContextPart = (value) => {
            const source = "source" in value ? value.source : value;
            if (!source || !subContexts.isSubContextSource(source))
                return undefined;
            return { subContext: source.subContext };
        };
        return Object.assign(exports, {
            checkThis,
            getSubContextPart
        });
    });

    var $ForDisabled = usModule((require, exports) => {
        const CB = require(ContextBuilder$2);
        const { checkThis } = $Shared(require);
        /** Converts disabled sources into {@link ContextStatus}. */
        function forDisabled(sources) {
            return sources.pipe(map((source) => Object.assign(new CB.ContextStatus(source.entry.field), checkThis({
                identifier: source.identifier,
                unqiueId: source.uniqueId,
                type: source.type,
                included: false,
                reason: CB.REASONS.Disabled
            }))));
        }
        return Object.assign(exports, { forDisabled });
    });

    var $ForInactive = usModule((require, exports) => {
        const CB = require(ContextBuilder$2);
        const { checkThis } = $Shared(require);
        const toReason = (source) => {
            switch (source.type) {
                case "ephemeral": return CB.REASONS.EphemeralInactive;
                default: return CB.REASONS.NoKeyTriggered;
            }
        };
        /** Converts sources that failed activation into {@link ContextStatus}. */
        function forInactive(sources) {
            return sources.pipe(map((source) => Object.assign(new CB.ContextStatus(source.entry.field), checkThis({
                identifier: source.identifier,
                unqiueId: source.uniqueId,
                type: source.type,
                included: false,
                reason: toReason(source)
            }))));
        }
        return Object.assign(exports, { forInactive });
    });

    var $ForUnselected = usModule((require, exports) => {
        const CB = require(ContextBuilder$2);
        const { checkThis, getSubContextPart } = $Shared(require);
        /**
         * Converts sources that were discarded during selection into {@link ContextStatus}.
         *
         * This is unique to the user-script, and uses a non-standard `reason`.
         */
        function forUnselected(sources) {
            return sources.pipe(map((source) => Object.assign(new CB.ContextStatus(source.entry.field), checkThis({
                identifier: source.identifier,
                unqiueId: source.uniqueId,
                type: source.type,
                included: false,
                // We're using a non-standard `reason` here.
                reason: "not selected"
            }), getSubContextPart(source))));
        }
        return Object.assign(exports, { forUnselected });
    });

    var $ForUnbudgeted = usModule((require, exports) => {
        const CB = require(ContextBuilder$2);
        const { selection } = $Common(require);
        const { checkThis, getSubContextPart } = $Shared(require);
        /** Converts sources that were discarded during assembly into {@link ContextStatus}. */
        function forUnbudgeted(results) {
            return results.pipe(mergeMap(async (rejected) => {
                const { source, result } = rejected;
                const stats = await selection.getBudgetStats(source);
                return Object.assign(new CB.ContextStatus(source.entry.field), checkThis({
                    identifier: source.identifier,
                    unqiueId: source.uniqueId,
                    type: source.type,
                    included: false,
                    // We don't necessarily need to use a standard `reason` here.
                    reason: result.reason,
                    calculatedTokens: 0,
                    actualReservedTokens: stats.actualReservedTokens
                }), getSubContextPart(rejected));
            }));
        }
        return Object.assign(exports, { forUnbudgeted });
    });

    var $ForInserted = usModule((require, exports) => {
        const { ContextStatus, REASONS } = require(ContextBuilder$2);
        const queryOps = $QueryOps(require);
        const { isContextGroup } = theModule$2(require);
        const { selection } = $Common(require);
        const { checkThis, getSubContextPart } = $Shared(require);
        const toReason = (inserted) => {
            if (isContextGroup(inserted.source))
                return inserted.source.isEmpty ? "empty group" : "filled group";
            const { activations } = inserted.source;
            // Sub-contexts use the default reason.
            if (!activations)
                return REASONS.Default;
            // Forced activations provide their own reason.
            forcedChecks: {
                const forced = activations.get("forced");
                if (!forced)
                    break forcedChecks;
                return forced;
            }
            ephemeralChecks: {
                if (!activations.has("ephemeral"))
                    break ephemeralChecks;
                return REASONS.EphemeralActive;
            }
            keyedChecks: {
                if (!activations.has("keyed"))
                    break keyedChecks;
                return REASONS.KeyTriggered;
            }
            // NovelAI now includes the identifier of the matched entry.
            cascadeChecks: {
                const cascade = activations.get("cascade");
                if (!cascade)
                    break cascadeChecks;
                const firstDegree = first(cascade.matches);
                if (!firstDegree)
                    break cascadeChecks;
                const [source] = firstDegree;
                return `${REASONS.KeyTriggeredNonStory}${source.identifier}`;
            }
            return REASONS.Default;
        };
        const toTrimState = (inserted) => {
            if (isContextGroup(inserted.source))
                return inserted.source.isEmpty ? "not included" : "included";
            const { assembly } = inserted.result;
            if (assembly.isSource)
                return "included";
            const sourceText = queryOps.getText(assembly.source);
            if (assembly.text.length === sourceText.length)
                return "included";
            return "partially included";
        };
        const toTrimMethod = (inserted) => {
            if (isContextGroup(inserted.source))
                return "no trim";
            const { contextConfig } = inserted.source.entry;
            if (contextConfig.trimDirection === "doNotTrim")
                return "no trim";
            return contextConfig.maximumTrimType;
        };
        const getMatch = (resultMap) => {
            if (!resultMap)
                return undefined;
            const theResults = first(resultMap.values());
            if (!theResults)
                return undefined;
            return first(theResults);
        };
        const getKeyPart = (inserted) => {
            const { location } = inserted.result;
            if (location.isKeyRelative) {
                const triggeringKey = location.matchedKey.source;
                const keyIndex = location.matchedKey.index;
                return checkThis({ keyRelative: true, triggeringKey, keyIndex });
            }
            const match = dew(() => {
                const { activations } = inserted.source;
                if (!activations)
                    return undefined;
                const theKeyedMatch = getMatch(activations.get("keyed"));
                if (theKeyedMatch)
                    return theKeyedMatch;
                const theCascade = activations.get("cascade");
                if (!theCascade)
                    return undefined;
                return getMatch(first(theCascade.matches.values()));
            });
            if (!match)
                return checkThis({ keyRelative: false });
            const triggeringKey = match.source;
            const keyIndex = match.index;
            return checkThis({ keyRelative: false, triggeringKey, keyIndex });
        };
        /** Converts sources that were inserted during assembly into {@link ContextStatus}. */
        function forInserted(results) {
            return results.pipe(mergeMap(async (inserted) => {
                const { source, result } = inserted;
                const stats = await selection.getBudgetStats(source);
                return Object.assign(new ContextStatus(source.entry.field), checkThis({
                    identifier: source.identifier,
                    unqiueId: source.uniqueId,
                    type: source.type,
                    included: true,
                    state: toTrimState(inserted),
                    reason: toReason(inserted),
                    includedText: result.assembly.text,
                    // It's possible that inserting a group could actually reduce the
                    // tokens used.  We're just not going to report that.
                    calculatedTokens: Math.max(0, inserted.deltaTokens),
                    actualReservedTokens: stats.actualReservedTokens,
                    trimMethod: toTrimMethod(inserted)
                }), getKeyPart(inserted), getSubContextPart(inserted));
            }));
        }
        return Object.assign(exports, { forInserted });
    });

    var $Statuses = usModule((require, exports) => {
        return Object.assign(exports, {
            ...$ForDisabled(require),
            ...$ForInactive(require),
            ...$ForUnselected(require),
            ...$ForUnbudgeted(require),
            ...$ForInserted(require)
        });
    });

    var $StageReports = usModule((require, exports) => {
        const { StageReport } = require(ContextBuilder$2);
        /** Basically a type-checking assertion. */
        const checkThis = (obj) => obj;
        function createStream(
        /** The successful insertions. */
        insertedResults) {
            return insertedResults.pipe(map((inserted) => Object.assign(new StageReport(), checkThis({
                structuredOutput: inserted.structuredOutput,
                reservedTokens: inserted.reservedTokens,
                remainingTokens: inserted.availableTokens,
                usedTokens: inserted.consumedTokens,
                description: inserted.description
            }))));
        }
        return Object.assign(exports, {
            createStream
        });
    });

    var $Preamble = usModule((require, exports) => {
        const helpers = $Helpers(require);
        const { getPreamble } = $NaiInternals(require);
        function createStream(params, allIncluded, isStoryTrimmed) {
            // Sub-contexts don't need to bother with this.
            if (params.forSubContext)
                return from([{ str: "", tokens: [] }]);
            return forkJoin([
                Promise.resolve(params.tokenCodec),
                Promise.resolve(params.storyContent.settings.model),
                Promise.resolve(params.storyContent.settings.prefix),
                Promise.resolve(params.prependPreamble),
                helpers.isContextEmpty(allIncluded),
                isStoryTrimmed.pipe(map((r) => !r))
            ]).pipe(mergeMap((args) => getPreamble(...args)));
        }
        return Object.assign(exports, {
            createStream
        });
    });

    /**
     * Takes the user-script data and converts it into NovelAI's containers.
     *
     * Hopefully, this remains one of the very few places where we're
     * directly interacting with NovelAI's interfaces, just to minimize
     * the problem surface.
     */
    var $Export = usModule((require, exports) => {
        const { ContextRecorder } = require(ContextBuilder$2);
        const queryOps = $QueryOps(require);
        const helpers = $Helpers(require);
        const statuses = $Statuses(require);
        const stageReports = $StageReports(require);
        const preamble = $Preamble(require);
        function exportPhase(
        /** The context builder parameters. */
        contextParams, 
        /** The story's source. */
        storySource, 
        /** The disabled sources. */
        disabledSources, 
        /** The activated bias-groups. */
        biasGroups, 
        /** The sources that failed activation. */
        inactiveSources, 
        /** The sources that were discarded during selection. */
        unselectedSources, 
        /** The rejected insertions. */
        unbudgetedResults, 
        /** The successful insertions. */
        insertedResults, 
        /** The final assembly. */
        finalAssembly) {
            const allDisabled = disabledSources.pipe(statuses.forDisabled, share());
            const allRejected = merge(inactiveSources.pipe(mergeAll(), statuses.forInactive), unselectedSources.pipe(mergeAll(), statuses.forUnselected)).pipe(share());
            const allIncluded = insertedResults.pipe(statuses.forInserted, share());
            const allStatuses = merge(unbudgetedResults.pipe(statuses.forUnbudgeted), allDisabled, allRejected, allIncluded).pipe(share());
            // The name implies there's shenanigans afoot.
            const isStoryTrimmed = helpers.isStoryTrimmedSortOfIDK(allStatuses);
            // This ended up being oddly elegant.  Just convert streams directly
            // into properties to be assigned.
            const recorderProps = forkJoin({
                maxTokens: Promise.resolve(contextParams.contextSize),
                tokenizerType: Promise.resolve(contextParams.tokenizerType),
                preContextText: storySource.pipe(map((s) => s.entry.insertedText), map((s) => queryOps.getText(s)), defaultIfEmpty("")),
                output: finalAssembly.pipe(map((a) => a.text), defaultIfEmpty("")),
                tokens: finalAssembly.pipe(map((a) => [...a.tokens]), defaultIfEmpty([])),
                structuredOutput: insertedResults.pipe(lastOrEmpty(), map((r) => r.structuredOutput), defaultIfEmpty([])),
                stageReports: stageReports.createStream(insertedResults).pipe(toArray()),
                contextStatuses: allStatuses.pipe(toArray()),
                keyRejections: allRejected.pipe(toArray()),
                disabled: allDisabled.pipe(toArray()),
                biases: biasGroups.pipe(defaultIfEmpty([])),
                orderZeroPoint: helpers.orderZeroPoint(insertedResults),
                storyTrimmed: isStoryTrimmed,
                preamble: preamble.createStream(contextParams, allIncluded, isStoryTrimmed)
            });
            return lazyObject({
                contextRecorder: () => recorderProps.pipe(map((props) => Object.assign(new ContextRecorder(), props)), single(), shareReplay(1))
            });
        }
        return Object.assign(exports, { phaseRunner: exportPhase });
    });

    var $Category$1 = usModule((require, exports) => {
        const { REASONS } = require(ContextBuilder$2);
        const { categories } = $Common(require);
        const { ContextContent } = theModule$4(require);
        const contextSource = $ContextSource(require);
        const createSource = (contextParams, storySource, categoryMap) => {
            // We will need to reproduce the selection and assembly process,
            // but for each category with a sub-context configuration.
            const { phaseRunner: selectionRunner } = $Selection(require);
            const { phaseRunner: assemblyRunner } = $Assembly(require);
            const { phaseRunner: exportRunner } = $Export(require);
            return (group) => {
                const category = categoryMap.get(group.key);
                // If no category was found, we'll just pass them out.
                if (!category)
                    return from(group);
                const { contextConfig } = category.subcontextSettings;
                const subContextParams = Object.freeze({
                    ...contextParams,
                    contextName: category.name,
                    // Constrain the context size to the context's token budget.
                    contextSize: Math.min(contextConfig.tokenBudget, contextParams.contextSize),
                    // Let everything know we're doing a sub-context.
                    forSubContext: true
                });
                return group.pipe(toArray(), 
                // Yeah, this is a bit unnecessary, considering `selectionRunner`
                // is just going to flatten it out again, but whatever.
                map((activated) => new Set(activated)), 
                // Run through the remaining phases with these limited entries,
                // producing a new source from the assembled context.
                (activatedSet) => {
                    const selected = selectionRunner(subContextParams, storySource, activatedSet);
                    const assembled = assemblyRunner(subContextParams, selected.totalReservedTokens, selected.inFlight, 
                    // No context-groups are in use here.
                    EMPTY$1);
                    const exported = exportRunner(subContextParams, 
                    // These would be rejections from the pre-selection phases.
                    // We don't have any of those for a sub-context.
                    EMPTY$1, EMPTY$1, EMPTY$1, EMPTY$1, 
                    // Now we're back to it.
                    selected.unselected, assembled.rejections, assembled.insertions, assembled.assembly);
                    return exported.contextRecorder;
                }, mergeMap(async (recorder) => {
                    const theField = { text: recorder.output, id: group.key, contextConfig };
                    const theContent = await ContextContent.forField(theField, contextParams);
                    return Object.assign(contextSource.create(theContent, "lore", `S:${category.name}`), {
                        enabled: true,
                        activated: true,
                        activations: new Map([["forced", REASONS.Default]]),
                        subContext: recorder
                    });
                }));
            };
        };
        const createStream = (
        /** The context params. */
        contextParams, 
        /** The story's source. */
        storySource) => {
            // Create a map of the categories for look up.
            const categoryMap = new Map(contextParams.storyContent.lorebook.categories
                .filter(categories.isSubContextCategory)
                .map((cat) => [cat.id ?? cat.name, cat]));
            return (sources) => {
                // First, we'll need to partition the categorized entries from
                // other entries.  We'll stream them back out toward the end.
                const [categorized, theRest] = partition$1(sources, categories.isCategorized);
                return merge(theRest, categorized.pipe(groupBy$1((s) => s.entry.fieldConfig.category), mergeMap(createSource(contextParams, storySource, categoryMap))));
            };
        };
        return Object.assign(exports, { createStream });
    });

    /**
     * The Sub-Context Phase handles the assembly of category sub-contexts
     * and the removal of entries that ended up incorporated into a
     * sub-context from the stream that will be fed into the selection
     * phase.
     *
     * Configuration that affects this module:
     * - Becomes a noop when `subContext.groupedInsertion` is `true`.
     */
    var $SubContexts = usModule((require, exports) => {
        const subContexts = {
            category: $Category$1(require).createStream
        };
        $Common(require);
        function subContextPhase(
        /** The context builder parameters. */
        contextParams, 
        /** The story's source. */
        storySource, 
        /** The fully activated set of sources. */
        activatedSet) {
            // This phase becomes a noop if context-groups are enabled instead.
            {
                return Object.freeze({
                    subContexts: of(new Set()),
                    activated: activatedSet
                });
            }
        }
        return Object.assign(exports, subContexts, { phaseRunner: subContextPhase });
    });

    /**
     * Checks each {@link ContextSource} for lore bias group inclusions.
     */
    var $BiasLore = usModule((require, exports) => {
        const { biasGroups } = $Common(require);
        const createStream = (
        /** The stream of activation results. */
        activating) => activating.pipe(connect((shared) => merge(
        // Look for "when not inactive" bias groups by searching the activated entries.
        shared.pipe(collect((source) => {
            if (!source.activated)
                return undefined;
            if (!biasGroups.isBiased(source))
                return undefined;
            const groups = chain(source.entry.fieldConfig.loreBiasGroups)
                .filter(biasGroups.whenActive)
                .filter(biasGroups.hasValidPhrase)
                .toArray();
            if (!groups.length)
                return undefined;
            return { identifier: source.identifier, groups };
        })), 
        // Look for "when inactive" bias groups by searching the rejections.
        // This intentionally does not include disabled sources; those are disabled!
        shared.pipe(collect((source) => {
            if (source.activated)
                return undefined;
            if (!biasGroups.isBiased(source))
                return undefined;
            const groups = chain(source.entry.fieldConfig.loreBiasGroups)
                .filter(biasGroups.whenInactive)
                .filter(biasGroups.hasValidPhrase)
                .toArray();
            if (!groups.length)
                return undefined;
            return { identifier: source.identifier, groups };
        })))), shareReplay());
        return Object.assign(exports, { createStream });
    });

    /**
     * Checks each source for lore bias group inclusions.
     */
    var $BiasCategory = usModule((require, exports) => {
        const { categories, biasGroups } = $Common(require);
        const createStream = (
        /** The story contents, to source the categories from. */
        storyContent, 
        /** The stream of activation results. */
        activating) => {
            return activating.pipe(
            // We only want activated entries with categories.
            collect((source) => {
                if (!source.activated)
                    return undefined;
                if (!categories.isCategorized(source))
                    return undefined;
                return source;
            }), connect((shared) => {
                // Create a map of the categories for look up.
                const categoryMap = new Map(storyContent.lorebook.categories
                    .filter(categories.isBiasedCategory)
                    .map((cat) => [cat.name, cat]));
                return merge(
                // Activated categories: use the `categoryMap` to filter out and
                // map to known/existing category instance.
                shared.pipe(collect((source) => categoryMap.get(source.entry.fieldConfig.category)), map(({ name, categoryBiasGroups }) => ({
                    identifier: `C:${name}`,
                    groups: chain(categoryBiasGroups)
                        .filter(biasGroups.whenActive)
                        .filter(biasGroups.hasValidPhrase)
                        .toArray()
                }))), 
                // Inactive categories: clone `categoryMap` and then remove
                // any categories that are associated with an activated source.
                // What is left are our inactive categories.
                shared.pipe(reduce((a, c) => (a.delete(c.entry.fieldConfig.category), a), new Map(categoryMap)), mergeMap((catMap) => catMap.values()), map(({ name, categoryBiasGroups }) => ({
                    identifier: `C:${name}`,
                    groups: chain(categoryBiasGroups)
                        .filter(biasGroups.whenInactive)
                        .filter(biasGroups.hasValidPhrase)
                        .toArray()
                }))));
            }), filter((biasGroup) => biasGroup.groups.length > 0), shareReplay());
        };
        return Object.assign(exports, { createStream });
    });

    /**
     * The Bias-Groups Phase takes the activated and rejected entries
     * and determines which bias-groups should be activated to service
     * that feature.
     */
    var $BiasGroups = usModule((require, exports) => {
        const biasGroups = {
            lore: $BiasLore(require).createStream,
            category: $BiasCategory(require).createStream
        };
        function biasGroupPhase(
        /** The context builder parameters. */
        contextParams, 
        /** The currently in-flight activations. */
        inFlightActivations) {
            const logger = createLogger(`Bias Groups Phase: ${contextParams.contextName}`);
            const inFlight = merge(biasGroups.lore(inFlightActivations), biasGroups.category(contextParams.storyContent, inFlightActivations)).pipe(logger.measureStream("In-flight Bias Groups"), shareReplay());
            return lazyObject({
                biasGroups: () => inFlight.pipe(toArray(), shareReplay(1)),
                inFlight: () => inFlight
            });
        }
        return Object.assign(exports, biasGroups, { phaseRunner: biasGroupPhase });
    });

    var $Category = usModule((require, exports) => {
        const { categories } = $Common(require);
        const { forCategory } = theModule$2(require);
        const createStream = (
        /** The context params. */
        contextParams) => {
            // Create a map of the categories for look up.
            const categoryMap = new Map(contextParams.storyContent.lorebook.categories
                .filter(categories.isSubContextCategory)
                .map((cat) => [cat.id ?? cat.name, cat]));
            return (sources) => sources.pipe(filter(categories.isCategorized), map((source) => source.entry.fieldConfig.category), distinct(), collect((category) => categoryMap.get(category)), mergeMap((category) => forCategory(contextParams.tokenCodec, category)));
        };
        return Object.assign(exports, { createStream });
    });

    /**
     * This handles the creation of empty context-groups, which the
     * assembler will recognize and use as insertion targets for entries
     * that belong to those groups.
     *
     * Configuration that affects this module:
     * - Becomes a noop when `subContext.groupedInsertion` is `false`.
     */
    var $ContextGroups = usModule((require, exports) => {
        const { sorting } = $Common(require);
        const subContexts = {
            category: $Category(require).createStream
        };
        function contextGroupPhase(
        /** The context builder parameters. */
        contextParams, 
        /** The selected set of sources. */
        inFlightSelected) {
            // This phase becomes a noop if context-groups are disabled or
            // we're working with a sub-context.
            if (contextParams.forSubContext) {
                return lazyObject({
                    contextGroups: () => of(new Set()),
                    selected: () => inFlightSelected.pipe(toArray(), map((sources) => new Set(sources)), shareReplay(1)),
                    inFlight: () => inFlightSelected
                });
            }
            const logger = createLogger(`Context Group Phase: ${contextParams.contextName}`);
            const categoryGroups = inFlightSelected.pipe(subContexts.category(contextParams), logger.measureStream("In-flight Category Groups"), shareReplay());
            // We want to additionally emit the groups as sources, but we need to emit
            // them with the correct insertion ordering.
            const orderedEntries = merge(inFlightSelected, categoryGroups).pipe(toArray(), map((sources) => sources.sort(sorting.forInsertion(contextParams))), shareReplay(1));
            return lazyObject({
                contextGroups: () => categoryGroups.pipe(toArray(), map((sources) => new Set(sources)), shareReplay(1)),
                selected: () => orderedEntries.pipe(map((sources) => new Set(sources)), shareReplay(1)),
                inFlight: () => orderedEntries.pipe(mergeAll(), shareReplay())
            });
        }
        return Object.assign(exports, subContexts, { phaseRunner: contextGroupPhase });
    });

    /**
     * This module provides the individual phases of the context building
     * process.  These will be arranged into a pipeline which eventually
     * leads to a fully assembled context.
     *
     * Each phase is numbered to indicate the general order of the data
     * flowing through the process.  Some data from a lower-numbered phase
     * may be needed by a higher-numbered phase.
     *
     * If two phases have the same number, that is an explicit indication
     * that they can safely execute as concurrent phases.  Since the
     * global tokenizer is a background worker, there is opportunity for
     * true concurrency here.
     */
    var $ReactiveProcessing = usModule((require, exports) => {
        return Object.assign(exports, {
            source: $Source(require),
            activation: $Activation(require),
            biasGroups: $BiasGroups(require),
            subContexts: $SubContexts(require),
            selection: $Selection(require),
            contextGroups: $ContextGroups(require),
            assembly: $Assembly(require),
            export: $Export(require)
        });
    });

    /**
     * This module is essentially the entry-point of the whole context-builder.
     *
     * It sets up the main processing pipeline which is built up of the
     * RxJS streams found in the `./rx` folder.  It makes sure that the
     * "phase runner" functions get all the data they need to set
     * themselves up.
     */
    createLogger("ContextProcessor");
    var ContextProcessor = usModule((require, exports) => {
        const { makeParams } = $ParamsService(require);
        const processing = $ReactiveProcessing(require);
        async function processContext(storyContent, storyState, givenTokenLimit, givenStoryLength, prependPreamble, tokenCodec) {
            const contextParams = await makeParams(storyContent, storyState, givenTokenLimit, givenStoryLength, prependPreamble, tokenCodec);
            // Figure out our sources for context content.
            const sourceResults = processing.source.phaseRunner(contextParams);
            // Figure out what content is actually to be used.
            const activationResults = processing.activation.phaseRunner(contextParams, sourceResults.storySource, sourceResults.enabledSources);
            // Grab the triggered bias groups as content activates.
            const biasGroupResults = processing.biasGroups.phaseRunner(contextParams, activationResults.inFlight);
            // Remove sources that belong to a category with a sub-context and then
            // assemble and create the sources for each sub-context.  This may be
            // a noop depending on configuration.
            const subContexts = processing.subContexts.phaseRunner(contextParams, sourceResults.storySource, activationResults.activated);
            // Order the content based on importance.
            const selectionResults = processing.selection.phaseRunner(contextParams, sourceResults.storySource, subContexts.activated);
            const contextGroups = processing.contextGroups.phaseRunner(contextParams, selectionResults.inFlight);
            const assemblyResults = processing.assembly.phaseRunner(contextParams, selectionResults.totalReservedTokens, contextGroups.inFlight, contextGroups.contextGroups);
            const exportResults = processing.export.phaseRunner(contextParams, sourceResults.storySource, sourceResults.disabledSources, biasGroupResults.biasGroups, activationResults.rejected, selectionResults.unselected, assemblyResults.rejections, assemblyResults.insertions, assemblyResults.assembly);
            return await firstValueFrom(exportResults.contextRecorder);
        }
        return Object.assign(exports, {
            processContext
        });
    });

    const replaceWrapper = (replaceMap) => (exports, module, require) => {
        const replacedKeys = new Set(Object.getOwnPropertyNames(replaceMap));
        const passthruKeys = new Set(Object.getOwnPropertyNames(exports));
        const wrappedModule = {};
        for (const k of replacedKeys) {
            passthruKeys.delete(k);
            const original = exports[k];
            const replacer = replaceMap[k];
            const replacement = replacer(original, require);
            Object.defineProperty(wrappedModule, k, {
                get() { return replacement; }
            });
            replacedKeys.delete(k);
        }
        // Any property not in the replacer is passed through transparently.
        for (const k of passthruKeys) {
            Object.defineProperty(wrappedModule, k, {
                get() { return exports[k]; }
            });
        }
        // Any keys remaining were not found, which is a problem.
        for (const k of replacedKeys) {
            console.error([
                `Property \`${k}\` in module \`${module.id}\` was not found`,
                "no replacement was made."
            ].join("; "));
        }
        if (replacedKeys.size > 0)
            throw new Error(`Injection of module ${module.id} failed.`);
        return wrappedModule;
    };

    const logger = createLogger("ContextBuilder Injector");
    const name$1 = ContextBuilder$2.name;
    const chunkId$1 = 2888;
    const moduleId$1 = ContextBuilder$2.moduleId;
    const inject$1 = replaceWrapper({
        "rJ": (original, require) => {
            const processor = ContextProcessor(require);
            const ogMark = "build original context";
            const usMark = "build userscript context";
            async function timeTrialBuilder() {
                performance.mark(`${ogMark}:start`);
                const naiResult = await original.apply(this, arguments);
                performance.mark(`${ogMark}:end`);
                const [sc, ss, tl, pp, sl, codec] = arguments;
                performance.mark(`${usMark}:start`);
                const usResult = await processor.processContext(sc, ss, tl, sl, pp, codec);
                performance.mark(`${usMark}:end`);
                // Log the different results out.  Helpful for comparing.
                logger.info("Vanilla Result:", naiResult);
                logger.info("User-Script Result:", usResult);
                // Use the vanilla `console.log` to print the results.
                // I will sometimes want to measure without the expensive log spam.
                console.log(performance.measure(ogMark, `${ogMark}:start`, `${ogMark}:end`));
                console.log(performance.measure(usMark, `${usMark}:start`, `${usMark}:end`));
                performance.clearMarks();
                performance.clearMeasures();
                onEndContext.next(usResult);
                return usResult;
            }
            return timeTrialBuilder ;
        }
    });

    var ContextBuilder = /*#__PURE__*/Object.freeze({
        __proto__: null,
        name: name$1,
        chunkId: chunkId$1,
        moduleId: moduleId$1,
        inject: inject$1
    });

    const name = LoreEntryHelpers$2.name;
    const chunkId = 2888;
    const moduleId = LoreEntryHelpers$2.moduleId;
    const inject = replaceWrapper({
        "P5": (original, require) => {
            const searchService = SearchService(require);
            let checkerFailed = false;
            function failSafeChecker() {
                if (!checkerFailed) {
                    try {
                        return searchService.naiCheckActivation.apply(this, arguments);
                    }
                    catch (err) {
                        notifyOfProblem({
                            message: [
                                "Search service integration failed.",
                                "Falling back to the vanilla `checkActivation` function for the remainder of this session.",
                            ].join("  "),
                            logToConsole: err
                        });
                        checkerFailed = true;
                    }
                }
                // Invoke the original if the replacement fails.
                return original.apply(this, arguments);
            }
            return failSafeChecker;
        }
    });

    var LoreEntryHelpers = /*#__PURE__*/Object.freeze({
        __proto__: null,
        name: name,
        chunkId: chunkId,
        moduleId: moduleId,
        inject: inject
    });

    /** Add additional injectors here. */
    const injectors = [
        ContextBuilder,
        LoreEntryHelpers
    ];

    const injectorMap = dew(() => {
        const result = new Map();
        for (const injector of injectors) {
            const injSet = result.get(injector.chunkId) ?? new Set();
            injSet.add(injector);
            result.set(injector.chunkId, injSet);
        }
        return result;
    });
    let _chunkStore = undefined;
    let lastPushFn = undefined;
    // `unsafeWindow` is needed to properly intercept the Webpack chunk
    // storage so its `push` method can be monkey-patched for injection.
    // We want to manipulate the modules before they get a chance to be
    // destructured into private variables of other modules.
    // In case Webpack already loaded, store the current value.
    const initChunk = unsafeWindow.webpackChunk_N_E;
    Object.defineProperty(unsafeWindow, "webpackChunk_N_E", {
        get() {
            return _chunkStore;
        },
        set(webpackChunk_N_E) {
            if (webpackChunk_N_E.push !== lastPushFn) {
                // Webpack replaces `push` with a special version used by the chunks.
                const origPush = webpackChunk_N_E.push;
                function wrappedPush(chunkDef, ...restArgs) {
                    const [chunkIds, moreModules] = chunkDef;
                    for (const chunkId of chunkIds) {
                        const injSet = injectorMap.get(chunkId);
                        if (!injSet)
                            continue;
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
                            function injectedModule(module, exports, webpackRequire) {
                                // Call the original factory to populate the vanilla module.
                                moduleFactory.call(this, module, exports, webpackRequire);
                                const wrappedRequire = makeWrappedRequire(webpackRequire);
                                try {
                                    module.exports = injector.inject(module.exports, module, wrappedRequire) ?? exports;
                                }
                                catch (error) {
                                    // In case of an error, abort injection so the app doesn't crash.
                                    notifyToConsole([
                                        `An error was thrown while injecting ${identity};`,
                                        "the injection was aborted."
                                    ].join(" "), error);
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
    if (initChunk)
        unsafeWindow.webpackChunk_N_E = initChunk;
    // NovelAI uses Sentry.  Set a value on `window` that can be detected
    // to disable Sentry or tag telemetry as coming from a modified client.
    Object.defineProperty(unsafeWindow, "__USERSCRIPT_ACTIVE", {
        value: true,
        writable: true,
        configurable: true
    });

})();
//# sourceMappingURL=bundle.user.js.map
