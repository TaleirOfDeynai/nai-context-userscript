import _conforms from "lodash/conforms";
import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { chain } from "@utils/iterables";
import $Common from "../_common";

import type { Observable as Obs } from "@utils/rx";
import type { StoryContent } from "@nai/EventModule";
import type { ResolvedBiasGroup } from "@nai/ContextBuilder";
import type { ActivationObservable } from "../_common/activation";

/**
 * Checks each source for lore bias group inclusions.
 */
export default usModule((require, exports) => {
  const { categories, biasGroups } = $Common(require);

  const createStream = (
    /** The story contents, to source the categories from. */
    storyContent: StoryContent,
    /** The stream of activation results. */
    activating: ActivationObservable
  ): Obs<ResolvedBiasGroup> => {
    return activating.pipe(
      // We only want activated entries with categories.
      rxop.collect((source) => {
        if (!source.activated) return undefined;
        if (!categories.isCategorized(source)) return undefined;
        return source;
      }),
      rxop.connect((shared) => {
        // Create a map of the categories for look up.
        const categoryMap = new Map(
          storyContent.lorebook.categories
            .filter(categories.isBiasedCategory)
            .map((cat) => [cat.id ?? cat.name, cat] as const)
        );

        return rx.merge(
          // Activated categories: use the `categoryMap` to filter out and
          // map to known/existing category instance.
          shared.pipe(
            rxop.collect((source) => categoryMap.get(source.entry.fieldConfig.category)),
            rxop.map(({ name, categoryBiasGroups }): ResolvedBiasGroup => ({
              identifier: `C:${name}`,
              groups: chain(categoryBiasGroups)
                .filter(biasGroups.whenActive)
                .filter(biasGroups.hasValidPhrase)
                .toArray()
            }))
          ),
          // Inactive categories: clone `categoryMap` and then remove
          // any categories that are associated with an activated source.
          // What is left are our inactive categories.
          shared.pipe(
            rxop.reduce(
              (a, c) => (a.delete(c.entry.fieldConfig.category), a),
              new Map(categoryMap)
            ),
            rxop.mergeMap((catMap) => catMap.values()),
            rxop.map(({ name, categoryBiasGroups }): ResolvedBiasGroup => ({
              identifier: `C:${name}`,
              groups: chain(categoryBiasGroups)
                .filter(biasGroups.whenInactive)
                .filter(biasGroups.hasValidPhrase)
                .toArray()
            }))
          )
        );
      }),
      rxop.filter((biasGroup) => biasGroup.groups.length > 0),
      rxop.shareReplay()
    );
  };

  return Object.assign(exports, { createStream });
});