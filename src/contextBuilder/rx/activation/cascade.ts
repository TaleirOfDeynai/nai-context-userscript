import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { isArray, isObject } from "@utils/is";
import { createLogger } from "@utils/logging";
import SearchService, { MatcherResults } from "../../SearchService";

import type { Observable as Obs } from "@utils/rx";
import type { ContextField } from "@nai/ContextBuilder";
import type { LoreEntry } from "@nai/Lorebook";
import type { EnabledSource } from "../source";
import type { ActivationState } from ".";

interface CascadingField extends ContextField {
  keys: LoreEntry["keys"];
  nonStoryActivatable: LoreEntry["nonStoryActivatable"];
}

type CascadingState = ActivationState<EnabledSource & {
  entry: CascadingField
}>;

const logger = createLogger("activation/cascade");

export interface CascadeActivation {
  /**
   * Describes how many degrees of separation a cascade activation is from
   * a direct activation.
   * - A first-order activation was triggered by a direct activation.
   * - A second-order activation was triggered by a first-order activation.
   * - A third-order activation was triggered by a second-order activation.
   * - And so on...
   * 
   * This value will always be greater than zero.
   */
  order: number;
  /**
   * A record of the matches from each activated entry that this entry
   * found a keyword match within.
   */
  matches: Map<ContextField, MatcherResults>;
}

/**
 * Checks each {@link ContextSource} for cascade activation.
 */
export default usModule((require, exports) => {
  const { searchForLore } = SearchService(require);

  const isCascading = (state: ActivationState<any>): state is CascadingState => {
    const { entry } = state.source;
    if (!isObject(entry)) return false;
    if (!("nonStoryActivatable" in entry)) return false;
    if (!entry.nonStoryActivatable) return false;
    if (!("keys" in entry)) return false;
    if (!isArray(entry.keys)) return false;
    return entry.keys.length > 0;
  };

  const checkActivation = (sources: Obs<ActivationState>) =>
    (directActivations: Obs<ActivationState>): Obs<ActivationState> => sources.pipe(
      rxop.filter(isCascading),
      rxop.toArray(),
      // Starting from `directActivations`, we check for cascading activations.
      // Any entries activated by cascade will then go through this `expand`
      // operator themselves, which may activate additional entries and so on
      // until we get through an expansion without activating any new entries.
      rxop.mergeMap((cascadingStates) => {
        logger.info("Sources:", cascadingStates);
        const entryKvps = new Map(cascadingStates.map((s) => [s.source.entry, s]));

        function* doCascade(activatedState: ActivationState) {
          const { source: activated } = activatedState;
          // Do not match on the story again.
          if (activated.type === "story") return;

          logger.info("Searching activated:", activatedState);

          const entryToState = new Map(entryKvps);
          // Do not cascade off yourself.
          entryToState.delete(activated.entry as any);
          // The cascade's order determines how many degrees of separation a
          // cascade activation is from a direct activation.
          const order = (activatedState.activations.get("cascade")?.order ?? 0) + 1;
  
          // Check the keys for all cascading sources against the entry's
          // assembled text.
          const { prefix, suffix } = activated.entry.contextConfig;
          const text = `${prefix}${activated.entry.text}${suffix}`;
          const searchResults = searchForLore(text, [...entryToState.keys()], true);
          for (const [entry, results] of searchResults) {
            if (!results.size) continue;

            const state = entryToState.get(entry) as CascadingState;
            const firstActivation = state.activations.size === 0;

            // Pull the activation data for an upsert.
            const data = state.activations.get("cascade") ?? { order, matches: new Map() };
            data.matches.set(activated.entry, results);
            state.activations.set("cascade", data);

            // If this was the first time this activated, yield it.
            if (firstActivation) yield state;
          }
        }

        // Set the concurrency to 1, so that each cascade clears out
        // completely and before the next begins; this way we get an
        // accurate `order` value.
        return directActivations.pipe(rxop.expand(doCascade, 1));
      }),
      // The expansion will re-emit `directActivations`, so make sure
      // we limit to only entries that have an actual cascade activation.
      rxop.filter((s) => s.activations.has("cascade"))
    );

  return Object.assign(exports, { checkActivation });
});