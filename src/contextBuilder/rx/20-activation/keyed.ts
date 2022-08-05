import _conforms from "lodash/conforms";
import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { isArray } from "@utils/is";
import $SearchService from "../../SearchService";

import type { TypePredicate } from "@utils/is";
import type { Observable as Obs } from "@utils/rx";
import type { LoreEntry } from "@nai/Lorebook";
import type { AssemblyResultMap } from "../../SearchService";
import type { ContextSource, ExtendField } from "../../ContextSource";
import type { ActivationState } from "../_common/activation";
import type { StorySource } from "../10-source";

type SearchableSource = ExtendField<ContextSource, {
  keys: LoreEntry["keys"];
}>;

export type KeyedActivation = AssemblyResultMap;

/**
 * Checks each {@link ContextSource} for keyword activations against
 * the story text.
 */
export default usModule((require, exports) => {
  const { search, searchForLore } = $SearchService(require);

  const isKeyed = _conforms({
    entry: _conforms({
      fieldConfig: _conforms({
        // Need a non-empty array to qualify.
        keys: (v) => isArray(v) && Boolean(v.length)
      })
    })
  }) as TypePredicate<SearchableSource>;

  /**
   * Version that waits for all entries to come through, then searches through
   * all their keys in one big batch.
   */
  async function* impl_checkActivation_batched(
    storySource: StorySource,
    sources: Obs<ActivationState>
  ): AsyncIterable<ActivationState> {
    // First, grab all sources with entries that can do keyword searching.
    const keyedSources = new Map<SearchableSource["entry"], ActivationState>();
    for await (const state of rx.eachValueFrom(sources)) {
      const { source } = state;
      if (!isKeyed(source)) continue;
      keyedSources.set(source.entry, state);
    }

    // Now check all these entries for matches on the story text and
    // yield any that have activated.
    const searchResults = searchForLore(
      storySource.entry.searchedText,
      [...keyedSources.keys()]
    );
    for (const [entry, results] of searchResults) {
      if (!results.size) continue;

      const state = keyedSources.get(entry) as ActivationState;
      state.activations.set("keyed", results);
      yield state;
    }
  }

  /** Version that checks the keys on individual entries, one at a time. */
  function impl_checkActivation_individual(
    storySource: StorySource,
    sources: Obs<ActivationState>
  ) {
    return sources.pipe(rxop.collect((state) => {
      if (!isKeyed(state.source)) return undefined;

      const result = search(storySource.entry.searchedText, state.source.entry);
      if (!result.size) return undefined;

      state.activations.set("keyed", result);
      return state;
    }));
  }

  const checkActivation = (storySource: StorySource) => (sources: Obs<ActivationState>) =>
    rx.from(impl_checkActivation_batched(storySource, sources));

  return Object.assign(exports, { checkActivation });
});