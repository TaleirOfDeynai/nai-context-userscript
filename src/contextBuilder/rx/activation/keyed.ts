import * as rx from "rxjs";
import { eachValueFrom } from "rxjs-for-await";
import { usModule } from "@utils/usModule";
import { isArray, isObject } from "@utils/is";
import SearchService from "../../SearchService";

import type { Observable as Obs } from "rxjs";
import type { ContextField } from "@nai/ContextBuilder";
import type { LoreEntry } from "@nai/Lorebook";
import type { MatcherResults } from "../../SearchService";
import type { IContextSource } from "../../ContextSource";
import type { TextOrFragment } from "../../TextSplitterService";

type WithKeys = Pick<LoreEntry, "keys">;
type MaybeKeyed = ContextField & Partial<WithKeys>;
type DefinitelyKeyed = ContextField & WithKeys;

type InputSource = IContextSource<MaybeKeyed>;

export type KeyedActivation = MatcherResults;

/**
 * Checks each {@link IContextSource} for keyword activations against
 * the story text.
 */
export default usModule((require, exports) => {
  const { searchForLore } = SearchService(require);

  const isKeyed = (entry: MaybeKeyed): entry is DefinitelyKeyed => {
    if (!isObject(entry)) return false;
    if (!("keys" in entry)) return false;
    if (!isArray(entry.keys)) return false;
    return entry.keys.length > 0;
  };

  async function* impl_checkActivation(
    storyText: TextOrFragment,
    sources: Obs<InputSource>)
  {
    // First, grab all sources with entries that can do keyword searching.
    const keyedSources = new Map<WithKeys, InputSource>();
    for await (const source of eachValueFrom(sources)) {
      if (!isKeyed(source.entry)) continue;
      keyedSources.set(source.entry, source);
    }

    // Now check all these entries for matches on the story text and
    // yield any that have activated.
    const searchResults = searchForLore(storyText, [...keyedSources.keys()]);
    for (const [entry, results] of searchResults) {
      const source = keyedSources.get(entry) as InputSource;
      if (!results.size) continue;

      source.activations.set("keyed", results);
      yield source;
    }
  };

  const checkActivation = (storyText: TextOrFragment) => (sources: Obs<InputSource>) =>
    rx.from(impl_checkActivation(storyText, sources));

  return Object.assign(exports, { checkActivation });
});