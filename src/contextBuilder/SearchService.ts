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

import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { isIterable, isString } from "@utils/is";
import * as Iterables from "@utils/iterables";
import { createLogger } from "@utils/logging";
import $MatcherService from "./MatcherService";
import $TextSplitterService from "./TextSplitterService";
import $TextAssembly from "./TextAssembly";

import type { Maybe, UndefOr } from "@utils/utility-types";
import type { AnyResult as NaiMatchResult } from "@nai/MatchResults";
import type { LoreEntry } from "@nai/Lorebook";
import type { MatcherFn, MatchResult as TextResult } from "./MatcherService";
import type { TextOrFragment } from "./TextSplitterService";
import type { TextAssembly, TextCursor, TextSelection } from "./TextAssembly";

export type WithKeys = { keys: string[] };
export type Matchable = Iterable<string> | WithKeys;

export interface AssemblyResult extends TextResult {
  readonly selection: TextSelection;
}

export type TextResultMap = Map<string, readonly TextResult[]>;
export type AssemblyResultMap = Map<string, readonly AssemblyResult[]>;
export type EntryResultMap<T extends WithKeys> = Map<T, AssemblyResultMap>;

const logger = createLogger("SearchService");

export default usModule((require, exports) => {
  const matcherService = $MatcherService(require);
  const splitterService = $TextSplitterService(require);
  const { toSelection } = $TextAssembly(require);

  /** A set of texts search since the last maintenance cycle. */
  let textsSearched = new Set<string>();
  /** The internal results cache of the service. */
  let resultsCache = new Map<string, TextResultMap>();

  /** Handles rescaling of the cache. */
  function rescaleCache() {
    const totalUnique = textsSearched.size;
    const curSize = resultsCache.size;

    // Maintain an overflow of 110% the demand placed on the service.
    const desiredOverflow = ((totalUnique * 1.1) - totalUnique) | 0;
    // But we'll keep a minimum size of 50 entries.  That's actually
    // NAI's vanilla retainment for their memoization.
    const idealSize = Math.max(50, totalUnique + desiredOverflow);

    // If the cache is already within bounds of the ideal, do nothing.
    if (curSize <= idealSize) return;

    // When rescaling, we do it over several runs.  This better accommodates
    // undo/redo and other kinds of story manipulation the user may do.
    const nextSize = Math.floor((curSize + idealSize) / 2);
    // Sanity check; we only need to rescale if we're shrinking the cache.
    if (nextSize >= curSize) return;

    // The cache has been maintained with an order from least-recently-seen
    // to most-recently-seen.  We should be able to just take the last entries
    // to discard an amount of least-recently-seen entries.
    const retainedEntries = [...resultsCache].slice(-nextSize);
    resultsCache = new Map(retainedEntries);

    logger.info({ curSize, idealSize, nextSize });
  }

  /** Discards results for keys that were not seen since last cycle. */
  function discardUnusedResults(keysUsed: Set<string>) {
    // Just delete all results for keys that were not searched in the last run.
    // In the case of long-living results, this keeps them from growing out of
    // control and hogging a bunch of memory.
    for (const [text, results] of resultsCache) {
      for (const key of results.keys())
        if (!keysUsed.has(key)) results.delete(key);

      // If it's now empty, delete the entry.
      if (results.size === 0) resultsCache.delete(text);
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
  function doMatching(textToSearch: string, matchers: MatcherFn[]): TextResultMap {
    if (!matchers.length) return new Map();

    const cachedResults: TextResultMap = resultsCache.get(textToSearch) ?? new Map();
    const searchResults: TextResultMap = new Map();

    for (const matcher of matchers) {
      const { source } = matcher;
      const cached = cachedResults.get(source);
      if (cached) {
        // Only add the result if it has at least one match.
        if (cached.length) searchResults.set(source, cached);
        continue;
      }

      // These results are shared; make sure the array is immutable.
      const results = Object.freeze(matcher(textToSearch));

      // We do want to store empty results in the cache, but we will omit
      // them from the search result.
      if (results.length) searchResults.set(source, results);
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
  function findMatches(haystack: TextOrFragment, matchers: MatcherFn[]) {
    if (isString(haystack)) return doMatching(haystack, matchers);

    // For fragments, we need to apply the offset to the results so
    // they line up with the fragment's source string.
    const { content, offset } = haystack;
    const theResults = doMatching(content, matchers);

    for (const [k, raw] of theResults) {
      if (raw.length === 0) continue;
      theResults.set(k, raw.map((m) => ({ ...m, index: offset + m.index })));
    }

    return theResults;
  }

  /** Makes sure we have an iterable of strings from something matchable. */
  function getKeys(v: Matchable): Iterable<string> {
    if (isIterable(v)) return v;
    if ("keys" in v) return v.keys;
    return [];
  };
  
  interface PartitionedMatches {
    matchFull: TextResultMap;
    matchLine: TextResultMap;
  }
  
  function doSearching(
    /** Text used for full-text searching. */
    fullText: TextOrFragment,
    /** Text used for per-line searching; provide `undefined` to force full-text. */
    lineText: UndefOr<Iterable<TextOrFragment>>,
    /** The set of keys, or something that can provide keys, to match with. */
    matchable: Matchable
  ): PartitionedMatches {
    // No need to partition the matchers if we're only doing full-text.
    if (lineText == null) return {
      matchFull: findMatches(
        fullText,
        [...Iterables.mapIter(getKeys(matchable), matcherService.getMatcherFor)]
      ),
      matchLine: new Map()
    };

    const { matchFull = [], matchLine = [] } = Iterables.chain(getKeys(matchable))
      .map(matcherService.getMatcherFor)
      .map((m) => [m.multiline ? "matchFull" : "matchLine", m] as const)
      .thru((matchers) => Iterables.partition(matchers))
      .value(Iterables.fromPairs);
    
    return {
      matchFull: dew(() => {
        if (!matchFull.length) return new Map();
        return findMatches(fullText, matchFull);
      }),
      matchLine: dew(() => {
        if (!matchLine.length) return new Map();
        return Iterables.chain(lineText)
          .map((fragment) => splitterService.byLine(fragment))
          .flatten()
          .filter(splitterService.hasWords)
          .map((frag) => findMatches(frag, matchLine))
          .flatten()
          .value((kvps) => new Map(kvps));
      })
    };
  }

  const toAssemblyResult =
    (assembly: TextAssembly, type: TextCursor["type"]) =>
    (theMatch: TextResult): AssemblyResult => {
      return Object.freeze(Object.assign(Object.create(theMatch), {
        selection: toSelection(theMatch, assembly, type)
      }));
    };

  /**
   * Searches `assembly` using the given `matchable`, which will source the
   * matchers necessary to perform the search.
   */
  function search(
    /** The text assembly to search. */
    assembly: TextAssembly,
    /** The set of keys, or something that can provide keys, to match with. */
    matchable: Matchable,
    /**
     * Whether to force full-text mode for all matchers.  Generally best
     * to provide `true` for text that is expected to be generally static.
     */
    forceFullText = false
  ): AssemblyResultMap {
    const fullText = assembly.fullText;
    const lineText = forceFullText ? undefined : assembly;
    const results = doSearching(fullText, lineText, matchable);
    
    // We need to convert these matches into a variant using the more
    // generalized cursors.
    const fullResultFn = toAssemblyResult(assembly, "fullText");
    const lineResultFn = toAssemblyResult(assembly, "assembly");

    return new Map(Iterables.concat(
      Iterables.mapValuesOf(results.matchFull, (m) => Object.freeze(m.map(fullResultFn))),
      Iterables.mapValuesOf(results.matchLine, (m) => Object.freeze(m.map(lineResultFn)))
    ));
  }

  /**
   * Searches `text` using the given `matchable`, which will source the
   * matchers necessary to perform the search.
   */
  function searchText(
    /** The text or fragment to search. */
    textToSearch: TextOrFragment,
    /** The set of keys, or something that can provide keys, to match with. */
    matchable: Matchable,
    /**
     * Whether to force full-text mode for all matchers.  Generally best
     * to provide `true` for text that is expected to be generally static.
     */
    forceFullText = false
  ): TextResultMap {
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
  function searchForLore<T extends WithKeys>(
    /** The text-like thing to search. */
    assembly: TextAssembly,
    /** The entries to include in the search. */
    entries: T[],
    /**
     * Whether to force full-text mode for all matchers.  Generally best
     * to provide `true` for text that is expected to be static.
     */
    forceFullText = false
  ): EntryResultMap<T> {
    // We just need to grab all the keys from the entries and pull their
    // collective matches.  We'll only run each key once.
    const keySet = new Set(Iterables.flatMap(entries, getKeys));
    const keyResults = search(assembly, keySet, forceFullText);
    
    // Now, we can just grab the results for each entry's keys and assemble
    // the results into a final map.
    const entryResults: EntryResultMap<T> = new Map();
    for (const entry of entries) {
      const entryResult: AssemblyResultMap = new Map();
      for (const key of entry.keys) {
        const result = keyResults.get(key);
        if (!result?.length) continue;
        entryResult.set(key, result);
      }

      entryResults.set(entry, entryResult);
    }

    return entryResults;
  }

  /** Finds the result with the lowest index of all keys searched. */
  const findLowestIndex = (
    results: Maybe<TextResultMap>
  ): UndefOr<[string, TextResult]> => {
    if (!results) return undefined;

    return Iterables.chain(results)
      .collect(([k, v]) => {
        const first = Iterables.first(v);
        return first ? [k, first] : undefined;
      })
      .value((kvps) => {
        let best: UndefOr<[string, TextResult]> = undefined;
        for (const kvp of kvps) {
          checks: {
            if (!best) break checks;
            if (kvp[1].index < best[1].index) break checks;
            continue;
          }
          best = kvp;
        }
        return best;
      });
  };

  /** Finds the result with the highest index of all keys searched. */
  const findHighestIndex = (
    results: Maybe<TextResultMap>
  ): UndefOr<[string, TextResult]> => {
    if (!results) return undefined;

    return Iterables.chain(results)
      .collect(([k, v]) => {
        const last = Iterables.last(v);
        return last ? [k, last] : undefined;
      })
      .value((kvps) => {
        let best: UndefOr<[string, TextResult]> = undefined;
        for (const kvp of kvps) {
          checks: {
            if (!best) break checks;
            if (kvp[1].index > best[1].index) break checks;
            continue;
          }
          best = kvp;
        }
        return best;
      });
  };

  /**
   * Finds the first key in `entryKeys` with a valid match.
   * This emulates NovelAI's "fail fast" search order that it uses in quick-checks.
   */
  const findLowestInOrder = (
    results: TextResultMap,
    entryKeys: string[]
  ): UndefOr<string> => {
    if (!results.size) return undefined;
    if (!entryKeys.length) return undefined;
    for (const key of entryKeys)
      if (results.get(key)?.length) return key;
    return undefined;
  };

  /** Build a result for NAI that represents a failure or quick-check result. */
  const makeQuickResult = (index: number, key: string = ""): NaiMatchResult =>
    ({ key, length: 0, index });

  /**
   * A replacement for {@link LoreEntryHelpers.checkActivation} that allows it
   * to make use of this service instead.
   * 
   * Good for testing and benefits from the same caching layer.
   */
  function naiCheckActivation(
    /** The lorebook entry to check. */
    entry: LoreEntry,
    /** The text available to search for keyword matches. */
    textToSearch: string,
    /**
     * Whether to do a quick test only.  When `true` and a match is found,
     * this will return a result where `index` and `length` are both `0`.
     * Only the `key` property is really of use.  Defaults to `false`.
     */
    quickCheck?: boolean,
    /** An object providing an alternative `searchRange` to use. */
    searchRangeDonor?: { searchRange: number },
    /**
     * Forces an entry that would force-activate to instead check its keys.
     * The entry must still be enabled.  Defaults to `false`.
     */
    forceKeyChecks?: boolean
  ): NaiMatchResult {
    if (!entry.enabled)
      return makeQuickResult(-1);
  
    if (entry.forceActivation && !forceKeyChecks)
      return makeQuickResult(Number.POSITIVE_INFINITY);

    const searchRange = searchRangeDonor?.searchRange ?? entry.searchRange;
    const textFragment: TextOrFragment = dew(() => {
      // No offset correction for whole string searches.
      if (searchRange >= textToSearch.length) return textToSearch;

      const content = textToSearch.slice(-1 * searchRange);
      // No offset correction for quick checks.
      if (quickCheck) return content;

      return splitterService.createFragment(content, textToSearch.length - content.length);
    });
    
    const results = searchText(textFragment, entry);

    if (quickCheck) {
      const bestKey = findLowestInOrder(results, entry.keys);
      const offset = Math.max(0, textToSearch.length - searchRange);
      return makeQuickResult(bestKey ? offset : -1, bestKey);
    }

    // Locate the the result with the highest index.
    const kvpHi = findHighestIndex(results);
    if (!kvpHi) return makeQuickResult(-1);
  
    const [bestKey, bestMatch] = kvpHi;
    let { index, length } = bestMatch;
  
    // A special case for non-regex keys where they have 0 to 2 capture groups.
    // I'm not sure what the purpose here is.  There is the special code-point
    // checks in `toRegex`; there's some non-capturing groups used in those.
    // Perhaps this was once used by that but has since been disabled by
    // making those groups non-capturing?
    if (matcherService.getMatcherFor(bestKey).type !== "regex") return {
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