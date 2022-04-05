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
import { onEndContext } from "./rx/events";
import MatcherService from "./MatcherService";

import type { UndefOr } from "@utils/utility-types";
import type { AnyResult as NaiMatchResult } from "@nai/MatchResults";
import type { LoreEntry } from "@nai/Lorebook";
import type { MatchResult } from "./MatcherService";
import type { TextOrFragment } from "./TextSplitterService";

export type WithKeys = { keys: string[] };
export type Matchable = Iterable<string> | WithKeys;
export type MatcherResults = Map<string, readonly MatchResult[]>;
export type EntryResults<T extends WithKeys> = Map<T, MatcherResults>;

const logger = createLogger("SearchService");

export default usModule((require, exports) => {
  const matcherService = MatcherService(require);

  /** A set of texts search since the last maintenance cycle. */
  let textsSearched = new Set<string>();
  /** The internal results cache of the service. */
  let resultsCache = new Map<string, MatcherResults>();

  /** Performs maintenance on the cache. */
  onEndContext.subscribe(() => {
    const totalUnique = textsSearched.size;
    const curSize = resultsCache.size;

    // Maintain a minimum of 20 extra search results.
    const desiredOverflow = Math.max(20, (totalUnique * 1.1) - totalUnique) | 0;
    const idealSize = totalUnique + desiredOverflow;

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
    
    // Setup for the next run-through.
    textsSearched = new Set();
  });

  /** Internal function that does the searching. */
  function findMatches(searchText: string, keys: Iterable<string>) {
    const cachedResults: MatcherResults = resultsCache.get(searchText) ?? new Map();
    const searchResults: MatcherResults = new Map();

    for (const key of keys) {
      const cached = cachedResults.get(key);
      if (cached) {
        // Explicitly mark the key as used.
        matcherService.markKeyAsUsed(key);
        // Only add the result if it has at least one match.
        if (cached.length) searchResults.set(key, cached);
        continue;
      }

      const matcher = matcherService.getMatcherFor(key);
      // These results are shared; make sure the array is immutable.
      const results = Object.freeze(matcher(searchText));

      // We do want to store empty results in the cache, but we will omit
      // them from the search result.
      if (results.length) searchResults.set(key, results);
      cachedResults.set(key, results);
    }

    if (!textsSearched.has(searchText)) {
      textsSearched.add(searchText);
      // Shift this text so it'll be reinserted at the end.  We only need
      // to do this once as that's enough to preserve the data into the
      // next run.
      resultsCache.delete(searchText);
    }

    resultsCache.set(searchText, cachedResults);
    return searchResults;
  }

  /** Makes sure we have an iterable of strings from something matchable. */
  function getKeys(v: Matchable): Iterable<string> {
    if (isIterable(v)) return v;
    if ("keys" in v) return v.keys;
    return [];
  };

  function search(searchText: TextOrFragment, matchable: Matchable): MatcherResults {
    const keys = getKeys(matchable);

    // For fragments, we need to apply the offset to the results so
    // they line up with the fragment's source string.
    if (!isString(searchText)) {
      const { content, offset } = searchText;
      const theResults = findMatches(content, keys);

      for (const [k, raw] of theResults) {
        if (raw.length === 0) continue;
        theResults.set(k, raw.map((m) => ({ ...m, index: offset + m.index })));
      }

      return theResults;
    }

    return findMatches(searchText, keys);
  }

  function searchForLore<T extends WithKeys>(
    searchText: TextOrFragment,
    entries: T[]
  ): EntryResults<T> {
    // We just need to grab all the keys from the entries and pull their
    // collective matches.  We'll only run each key once.
    const keySet = new Set(Iterables.flatMap(entries, getKeys));
    const keyResults = search(searchText, keySet);
    
    // Now, we can just grab the results for each entry's keys and assemble
    // the results into a final map.
    const entryResults: EntryResults<T> = new Map();
    for (const entry of entries) {
      const entryResult: MatcherResults = new Map();
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
  const findLowestIndex = (results: MatcherResults): UndefOr<[string, MatchResult]> => {
    return Iterables.chain(results)
      .collect(([k, v]) => {
        const first = Iterables.first(v);
        return first ? [k, first] : undefined;
      })
      .value((kvps) => {
        let best: UndefOr<[string, MatchResult]> = undefined;
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
  const findHighestIndex = (results: MatcherResults): UndefOr<[string, MatchResult]> => {
    return Iterables.chain(results)
      .collect(([k, v]) => {
        const last = Iterables.last(v);
        return last ? [k, last] : undefined;
      })
      .value((kvps) => {
        let best: UndefOr<[string, MatchResult]> = undefined;
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
  const findLowestInOrder = (results: MatcherResults, entryKeys: string[]): UndefOr<string> => {
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
    searchText: string,
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
    const textFragment = dew(() => {
      // No offset correction for whole string searches.
      if (searchRange >= searchText.length) return searchText;

      const content = searchText.slice(-1 * searchRange);
      // No offset correction for quick checks.
      if (quickCheck) return content;

      const offset = searchText.length - content.length;
      return { content, offset, length: content.length };
    });
    
    const results = search(textFragment, entry);

    if (quickCheck) {
      const bestKey = findLowestInOrder(results, entry.keys);
      const offset = Math.max(0, searchText.length - searchRange);
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
    searchForLore,
    naiCheckActivation
  });
});