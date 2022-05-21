import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { eachValueFrom } from "rxjs-for-await";
import { usModule } from "@utils/usModule";
import { isArray, isObject } from "@utils/is";
import $SearchService from "../../SearchService";

import type { Observable as Obs } from "@utils/rx";
import type { IContextField } from "@nai/ContextModule";
import type { LoreEntry } from "@nai/Lorebook";
import type { AssemblyResultMap } from "../../SearchService";
import type { ContextSource } from "../../ContextSource";
import type { TextAssembly } from "../../TextAssembly";
import type { ActivationState } from ".";

interface SearchableField extends IContextField {
  keys: LoreEntry["keys"];
}

type SearchableSource = ContextSource<SearchableField>;

export type KeyedActivation = AssemblyResultMap;

/**
 * Checks each {@link ContextSource} for keyword activations against
 * the story text.
 */
export default usModule((require, exports) => {
  const { search, searchForLore } = $SearchService(require);

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
    storyText: TextAssembly,
    sources: Obs<ActivationState>
  ): AsyncIterable<ActivationState> {
    // First, grab all sources with entries that can do keyword searching.
    const keyedSources = new Map<SearchableSource["entry"], ActivationState>();
    for await (const state of eachValueFrom(sources)) {
      const { source } = state;
      if (!isKeyed(source)) continue;
      keyedSources.set(source.entry, state);
    }

    // Now check all these entries for matches on the story text and
    // yield any that have activated.
    const searchResults = searchForLore(storyText, [...keyedSources.keys()]);
    for (const [entry, results] of searchResults) {
      if (!results.size) continue;

      const state = keyedSources.get(entry) as ActivationState;
      state.activations.set("keyed", results);
      yield state;
    }
  }

  /** Version that checks the keys on individual entries, one at a time. */
  function impl_checkActivation_individual(
    storyText: TextAssembly,
    sources: Obs<ActivationState>
  ) {
    return sources.pipe(rxop.collect((state) => {
      if (!isKeyed(state.source)) return undefined;

      const result = search(storyText, state.source.entry);
      if (!result.size) return undefined;

      state.activations.set("keyed", result);
      return state;
    }));
  }

  const checkActivation = (storyText: TextAssembly) => (sources: Obs<ActivationState>) =>
    rx.from(impl_checkActivation_batched(storyText, sources));

  return Object.assign(exports, { checkActivation });
});