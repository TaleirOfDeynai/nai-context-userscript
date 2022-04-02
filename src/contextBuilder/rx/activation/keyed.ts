import * as rx from "rxjs";
import { eachValueFrom } from "rxjs-for-await";
import { usModule } from "@utils/usModule";
import { isArray, isObject } from "@utils/is";
import SearchService from "../../SearchService";

import type { Observable as Obs } from "rxjs";
import type { ContextField } from "@nai/ContextBuilder";
import type { MatcherResults } from "../../SearchService";
import type { ContextSource } from "../../ContextSource";
import type { TextOrFragment } from "../../TextSplitterService";

interface SearchableField extends ContextField {
  keys: string[];
}

type SearchableSource = ContextSource<SearchableField>;

export type KeyedActivation = MatcherResults;

/**
 * Checks each {@link IContextSource} for keyword activations against
 * the story text.
 */
export default usModule((require, exports) => {
  const { searchForLore } = SearchService(require);

  const isKeyed = (source: ContextSource<any>): source is SearchableSource => {
    const { entry } = source;
    if (!isObject(entry)) return false;
    if (!("keys" in entry)) return false;
    if (!isArray(entry.keys)) return false;
    return entry.keys.length > 0;
  };

  async function* impl_checkActivation(
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
  };

  const checkActivation = (storyText: TextOrFragment) => (sources: Obs<ContextSource>) =>
    rx.from(impl_checkActivation(storyText, sources));

  return Object.assign(exports, { checkActivation });
});