import * as rxop from "rxjs/operators";
import { usModule } from "@utils/usModule";
import { isArray, isObject } from "@utils/is";
import ContextBuilder from "@nai/ContextBuilder";
import SearchService, { MatcherResults } from "../../SearchService";

import type { Observable as Obs } from "rxjs";
import type { ContextField } from "@nai/ContextBuilder";
import type { ContextSource } from "../../ContextSource";

interface CascadingField extends ContextField {
  keys: string[];
  nonStoryActivatable: boolean;
}

type CascadingSource = ContextSource<CascadingField>;

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
 * Checks each {@link IContextSource} for forced activation conditions.
 */
export default usModule((require, exports) => {
  const { REASONS } = require(ContextBuilder);
  const { searchForLore } = SearchService(require);

  const isCascading = (source: ContextSource<any>): source is CascadingSource => {
    const { entry } = source;
    if (!isObject(entry)) return false;
    if (!("nonStoryActivatable" in entry)) return false;
    if (!entry.nonStoryActivatable) return false;
    if (!("keys" in entry)) return false;
    if (!isArray(entry.keys)) return false;
    return entry.keys.length > 0;
  };

  const checkActivation = (sources: Obs<ContextSource>) =>
    (directActivations: Obs<ContextSource>): Obs<ContextSource> => sources.pipe(
      rxop.filter(isCascading),
      rxop.toArray(),
      // Starting from `directActivations`, we check for cascading activations.
      // Any entries activated by cascade will then go through this `expand`
      // operator themselves, which may activate additional entries and so on
      // until we get through an expansion without activating any new entries.
      rxop.mergeMap((cascadingSources) => {
        const entryKvps = new Map(cascadingSources.map((s) => [s.entry, s]));

        function* doCascade(activated: ContextSource) {
          // Do not match on the story again.
          if (activated.type === "story") return;

          const entryToSource = new Map(entryKvps);
          // Do not cascade off yourself.
          entryToSource.delete(activated.entry as any);
          // The cascade's order determines how many degrees of separation a
          // cascade activation is from a direct activation.
          const order = (activated.activations.get("cascade")?.order ?? 0) + 1;
  
          // Check the keys for all cascading sources against the entry text.
          const searchResults = searchForLore(activated.entry.text, [...entryToSource.keys()]);
          for (const [entry, results] of searchResults) {
            if (!results.size) continue;

            const source = entryToSource.get(entry) as CascadingSource;
            const firstActivation = source.activations.size === 0;

            // Pull the activation data for an upsert.
            const data = source.activations.get("cascade") ?? { order, matches: new Map() };
            data.matches.set(activated.entry, results);
            source.activations.set("cascade", data);

            // If this was the first time this activated, yield it.
            if (firstActivation) yield source;
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