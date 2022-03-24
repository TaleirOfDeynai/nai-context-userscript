import { map, share } from "rxjs/operators";
import { dew } from "../utils/dew";
import { usModule } from "../utils/usModule";
import { assertExists } from "../utils/assert";
import { createLogger } from "../utils/logging";
import LoreEntryHelpers from "../naiModules/LoreEntryHelpers";
import { onEndContext } from "./rx/events";

export interface MatcherFn {
  (needle: string, matchMode: "first" | "last"): [] | [MatchResult];
  (needle: string, matchMode?: "all"): MatchResult[];
  source: string;
  type: "simple" | "regex";
}

export interface MatchResult {
  /** The full match. */
  readonly match: string;
  /** If there were capture groups, the matches for those. */
  readonly groups: string[];
  /** If there were named capture groups, the matches for those. */
  readonly namedGroups: Map<string, string>;
  /** The index of the match from the searched string. */
  readonly index: number;
  /** The length of the matched text. */
  readonly length: number;
}

const logger = createLogger("MatcherService");

export default usModule((require, exports) => {
  const loreEntryHelpers = require(LoreEntryHelpers);

  /** A set of keys used for matching since the last maintenance cycle. */
  let usedKeysCache = new Set<string>();
  /** The internal matcher cache of the service. */
  const matcherCache = new Map<string, MatcherFn>();

  /** Event for when the used keys are being cleared. */
  const onMaintainMatchers = onEndContext.pipe(
    map(() => {
      const keysUsed = usedKeysCache;
      usedKeysCache = new Set();
      return keysUsed;
    }),
    share()
  );

  /** Discards any matcher functions that were not used since last cycle. */
  onMaintainMatchers.subscribe((lastKeysUsed) => {
    const startSize = matcherCache.size;
    for (const key of matcherCache.keys())
      if (!lastKeysUsed.has(key)) matcherCache.delete(key);
    
    logger.info(`Cleared ${startSize - matcherCache.size} unused matchers.`);
  });

  const escapeForRegex = (str) => str.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");

  /**
   * A semi-reimplementation of an internal NAI method.
   * 
   * The original also allowed you to optionally force the global flag, but
   * since this system always finds all matches in the text, we don't need
   * to make that an option.
   */
  function toRegex(key: string): [RegExp, MatcherFn["type"]] {
    const parseResult = loreEntryHelpers.tryParseRegex(key);

    if (parseResult.isRegex)
      return [new RegExp(parseResult.regex, `${parseResult.flags.join("")}g`), "regex"];

    const escapedKey = escapeForRegex(key.trim());
    checks: {
      // These checks were probably a fix to some kind of interesting bug...
      // Probably having to do with unicode regular expressions.
      const firstCodePoint = key.codePointAt(0) ?? Number.MAX_SAFE_INTEGER;
      if (firstCodePoint >= 128) break checks;
      const lastCodePoint = key.codePointAt(key.length - 1) ?? Number.MAX_SAFE_INTEGER;
      if (lastCodePoint >= 128) break checks;
  
      return [new RegExp(`\\b${escapedKey}\\b`, "iug"), "simple"];
    }

    return [new RegExp(`(?:^|\\W)(?:${escapedKey})(?:$|\\W)`, "iug"), "simple"];
  }

  function toMatchResult(regexExec: RegExpExecArray): MatchResult {
    const [match, ...groups] = regexExec;

    return {
      match, groups,
      index: assertExists("Expected an index.", regexExec.index),
      length: match.length,
      namedGroups: new Map(Object.entries(regexExec.groups ?? {}))
    };
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

      const impl = (
        needle: string,
        mode: "all" | "first" | "last" = "all"
      ): MatchResult[] => {
        // Make sure the regex internal state is reset.
        regex.lastIndex = 0;

        switch (mode) {
          case "all": {
            return Array.from(needle.matchAll(regex)).map(toMatchResult);
          }
          case "first": {
            const match = regex.exec(needle);
            return match ? [toMatchResult(match)] : [];
          }
          case "last": {
            let lastMatch: RegExpMatchArray | null = null;
            for (const match of needle.matchAll(regex)) lastMatch = match;
            return lastMatch ? [toMatchResult(lastMatch as any)] : [];
          }
          default:
            return [];
        }
      };

      return Object.assign(impl, { source: key, type }) as MatcherFn;
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