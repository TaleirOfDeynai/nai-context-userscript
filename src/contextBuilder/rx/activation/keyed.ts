import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { eachValueFrom } from "rxjs-for-await";
import { usModule } from "@utils/usModule";
import { isArray, isObject } from "@utils/is";
import SearchService from "../../SearchService";

import type { Observable as Obs } from "@utils/rx";
import type { ContextField } from "@nai/ContextBuilder";
import type { LoreEntry } from "@nai/Lorebook";
import type { MatcherResults } from "../../SearchService";
import type { ContextSource } from "../../ContextSource";
import type { TextOrFragment } from "../../TextSplitterService";

interface SearchableField extends ContextField {
  keys: LoreEntry["keys"];
}

type SearchableSource = ContextSource<SearchableField>;

export type KeyedActivation = MatcherResults;

/**
 * Checks each {@link ContextSource} for keyword activations against
 * the story text.
 */
export default usModule((require, exports) => {
  const { search, searchForLore } = SearchService(require);

  const isKeyed = (source: ContextSource<any>): source is SearchableSource => {
    const { entry } = source;
    if (!isObject(entry)) return false;
    if (!("keys" in entry)) return false;
    if (!isArray(entry.keys)) return false;
    return entry.keys.length > 0;
  };

  /**
   * Version that waits for all entries to come through, then searches through
   * all their keys in one big batch.
   */
  async function* impl_checkActivation_batched(
    storyText: TextOrFragment,
    sources: Obs<ContextSource>
  ): AsyncIterable<ContextSource> {
    // First, grab all sources with entries that can do keyword searching.
    const keyedSources = new Map<SearchableSource["entry"], SearchableSource>();
    for await (const source of eachValueFrom(sources)) {
      if (!isKeyed(source)) continue;
      keyedSources.set(source.entry, source);
    }

    // Now check all these entries for matches on the story text and
    // yield any that have activated.
    const searchResults = searchForLore(storyText, [...keyedSources.keys()]);
    for (const [entry, results] of searchResults) {
      const source = keyedSources.get(entry) as SearchableSource;
      if (!results.size) continue;

      source.activations.set("keyed", results);
      yield source;
    }
  }

  /** Version that checks the keys on individual entries, one at a time. */
  function impl_checkActivation_individual(
    storyText: TextOrFragment,
    sources: Obs<ContextSource>
  ) {
    return sources.pipe(rxop.collect((source) => {
      if (!isKeyed(source)) return undefined;
      const result = search(storyText, source.entry);
      if (!result.size) return undefined;
      return source;
    }));
  }

  const checkActivation = (storyText: TextOrFragment) => (sources: Obs<ContextSource>) =>
    rx.from(impl_checkActivation_batched(storyText, sources));

  return Object.assign(exports, { checkActivation });
});