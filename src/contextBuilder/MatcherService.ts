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

import * as rxop from "@utils/rxop";
import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { assertExists } from "@utils/assert";
import { createLogger } from "@utils/logging";
import LoreEntryHelpers from "@nai/LoreEntryHelpers";
import { onEndContext } from "./rx/events";

export interface MatcherFn {
  /** Finds the first match in the `haystack`. */
  (haystack: string, matchMode: "first"): [] | [MatchResult];
  /** Finds the last match in the `haystack`. */
  (haystack: string, matchMode: "last"): [] | [MatchResult];
  /** Finds all matches in the `haystack`.  This is the default behavior. */
  (haystack: string, matchMode?: "all"): MatchResult[];
  /**
   * The actual string provided to initialize the matcher.
   */
  source: string;
  /**
   * The underlying type of the matcher.
   * - `"simple"` - Matches a word or phrase, as entered.
   * - `"regex"` - Matches using a user-provided regular expression.
   */
  type: "simple" | "regex";
  /**
   * Whether the matcher is unsuited for single-line matching.
   * 
   * Single line is more efficient (due to more aggressive caching), but
   * regular expressions would need to be analyzed to check to see if
   * they can cross line boundaries, and I'm not checking for that!
   */
  multiline: boolean;
}

export interface MatchResult {
  /** The source used to build the matcher. */
  readonly source: string;
  /** The full match. */
  readonly match: string;
  /** If there were capture groups, the matches for those. */
  readonly groups: readonly string[];
  /** If there were named capture groups, the matches for those. */
  readonly namedGroups: Readonly<Record<string, string>>;
  /** The index of the match from the searched string. */
  readonly index: number;
  /** The length of the matched text. */
  readonly length: number;
}

const logger = createLogger("Matcher Service");

const RE_ESCAPE = /[$()*+.?[\\\]^{|}]/g;
const RE_UNSAFE_LEADING = /^\W/;
const RE_UNSAFE_TRAILING = /\W$/;

export default usModule((require, exports) => {
  const loreEntryHelpers = require(LoreEntryHelpers);

  /** A set of keys used for matching since the last maintenance cycle. */
  let usedKeysCache = new Set<string>();
  /** The internal matcher cache of the service. */
  const matcherCache = new Map<string, MatcherFn>();

  /** Event for when the used keys are being cleared. */
  const onMaintainMatchers = onEndContext.pipe(
    rxop.map(() => {
      const keysUsed = usedKeysCache;
      usedKeysCache = new Set();
      return keysUsed;
    }),
    rxop.share()
  );

  /** Discards any matcher functions that were not used since last cycle. */
  onMaintainMatchers.subscribe((lastKeysUsed) => {
    const startSize = matcherCache.size;
    for (const key of matcherCache.keys())
      if (!lastKeysUsed.has(key)) matcherCache.delete(key);
    
    logger.info(`Cleared ${startSize - matcherCache.size} unused matchers.`);
  });

  const escapeForRegex = (str) => str.replace(RE_ESCAPE, "\\$&");

  /** Checks if the start is safe for the word boundary `\b` check. */
  const leading = (key: string) => RE_UNSAFE_LEADING.test(key) ? "" : "\\b";
  /** Checks if the end is safe for the word boundary `\b` check. */
  const trailing = (key: string) => RE_UNSAFE_TRAILING.test(key) ? "" : "\\b";

  /**
   * A semi-reimplementation of an internal NAI method.
   * 
   * The original also allowed you to optionally force the global flag, but
   * since this system always finds all matches in the text, we don't need
   * to make that an option.
   */
  function toRegex(key: string): [RegExp, MatcherFn["type"]] {
    const parseResult = loreEntryHelpers.tryParseRegex(key);

    if (!parseResult.isRegex) {
      const escapedKey = escapeForRegex(key.trim());
      const newSource = `${leading(key)}${escapedKey}${trailing(key)}`;
      return [new RegExp(newSource, "iug"), "simple"];
    }

    return [new RegExp(parseResult.regex, `${parseResult.flags.join("")}g`), "regex"];
  }

  const toMatchResult = (source: string) => (regexExec: RegExpExecArray): MatchResult => {
    const [match, ...groups] = regexExec;

    return Object.freeze({
      source, match,
      groups: Object.freeze(groups),
      index: assertExists("Expected an index.", regexExec.index),
      length: match.length,
      namedGroups: Object.freeze({ ...regexExec?.groups })
    });
  }

  /** Adds a key to the list of used keys. */
  function markKeyAsUsed(key: string): void {
    usedKeysCache.add(key);
  }

  /** Gets a {@link MatcherFn matcher function} given a string. */
  function getMatcherFor(key: string): MatcherFn {
    usedKeysCache.add(key);

    const cached = matcherCache.get(key);
    if (cached) return cached;

    // For now, the only matcher we support is regex.  We wrap it up in a
    // function so that we can maybe add new ones in the future.
    const matcher = dew(() => {
      const [regex, type] = toRegex(key);
      // Regular expressions are unsafe to use in single-line mode.
      const multiline = type === "regex";
      // Build the result transformer.
      const toResult = toMatchResult(key);

      const impl = (
        haystack: string,
        mode: "all" | "first" | "last" = "all"
      ): MatchResult[] => {
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
            let lastMatch: RegExpMatchArray | null = null;
            for (const match of haystack.matchAll(regex)) lastMatch = match;
            return lastMatch ? [toResult(lastMatch as any)] : [];
          }
          default:
            return [];
        }
      };

      return Object.assign(impl, { source: key, type, multiline }) as MatcherFn;
    });

    matcherCache.set(key, matcher);
    return matcher;
  };

  return Object.assign(exports, {
    onMaintainMatchers,
    markKeyAsUsed,
    getMatcherFor
  });
});