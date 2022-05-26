import conforms from "lodash-es/conforms";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { isArray } from "@utils/is";
import { createLogger } from "@utils/logging";
import $SearchService from "../../SearchService";

import type { TypePredicate } from "@utils/is";
import type { Observable as Obs } from "@utils/rx";
import type { IContextField } from "@nai/ContextModule";
import type { LoreEntry } from "@nai/Lorebook";
import type { ExtendField } from "../../ContextSource";
import type { AssemblyResultMap } from "../../SearchService";
import type { EnabledSource } from "../source";
import type { ActivationState } from ".";

type CascadingSource = ExtendField<EnabledSource, {
  keys: LoreEntry["keys"];
  nonStoryActivatable: LoreEntry["nonStoryActivatable"];
}>;

type CascadingState = ActivationState<CascadingSource>;

const logger = createLogger("activation/cascade");

export interface CascadeActivation {
  /**
   * Describes how many degrees of separation a cascade activation is from
   * a direct activation.
   * - A first-degree activation was triggered by a direct activation.
   * - A second-degree activation was triggered by a first-degree activation.
   * - A third-degree activation was triggered by a second-degree activation.
   * - And so on...
   * 
   * This value will always be greater than zero.
   */
  initialDegree: number;
  /**
   * Describes the deepest degree of activation this entry was triggered by.
   * 
   * Where {@link initialDegree} is about the first entry that it matched
   * during the cascade, `finalDegree` is about how deep into the cascade
   * its last match was found.
   * 
   * This will equal {@link initialDegree} if it never found a match in a
   * deeper cascade than its initial match.
   */
  finalDegree: number;
  /**
   * A record of the matches from each activated entry that this entry
   * found a keyword match within.
   */
  matches: Map<IContextField, AssemblyResultMap>;
}

/**
 * Checks each {@link ContextSource} for cascade activation.
 */
export default usModule((require, exports) => {
  const { searchForLore } = $SearchService(require);

  const isCascading = conforms({
    source: conforms({
      entry: conforms({
        fieldConfig: conforms({
          // Need a non-empty array to qualify.
          keys: (v) => isArray(v) && Boolean(v.length),
          // Cascading is active when `true`.
          nonStoryActivatable: (v) => v === true
        })
      })
    })
  }) as TypePredicate<CascadingState>;

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
          // The cascade's degree determines how many degrees of separation a
          // cascade activation is from a direct activation.
          const curDegree = (activatedState.activations.get("cascade")?.initialDegree ?? 0) + 1;
  
          // Check the keys for all cascading sources against the entry's
          // assembled text.
          const searchResults = searchForLore(
            activated.entry.searchedText,
            [...entryToState.keys()],
            true
          );
          for (const [entry, results] of searchResults) {
            if (!results.size) continue;

            const state = entryToState.get(entry) as CascadingState;
            const firstActivation = state.activations.size === 0;

            // Pull the activation data for an upsert.
            const data = state.activations.get("cascade") ?? {
              initialDegree: curDegree,
              finalDegree: curDegree,
              matches: new Map()
            };
            data.matches.set(activated.entry, results);
            state.activations.set("cascade", data);

            // Update the final degree based on the current degree.
            data.finalDegree = Math.max(curDegree, data.finalDegree);

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