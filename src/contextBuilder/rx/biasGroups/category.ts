import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { isArray, isObject } from "@utils/is";
import { chain } from "@utils/iterables";
import { categories, biasGroups } from "../_shared";

import type { Observable as Obs } from "@utils/rx";
import type { StoryContent } from "@nai/EventModule";
import type { PhraseBiasConfig, Categories } from "@nai/Lorebook";
import type { ActivationObservable } from "../activation";
import type { TriggeredBiasGroup } from "../_shared";

type BiasedCategory = Categories.Category & {
  categoryBiasGroups: PhraseBiasConfig[];
}

/**
 * Checks each {@link ContextSource} for lore bias group inclusions.
 */
export default usModule((_require, exports) => {
  const isBiasedCategory = (category: Categories.Category): category is BiasedCategory => {
    if (!isObject(category)) return false;
    if (!("categoryBiasGroups" in category)) return false;
    if (!isArray(category.categoryBiasGroups)) return false;
    return category.categoryBiasGroups.length > 0;
  };

  const createStream = (
    /** The story contents, to source the categories from. */
    storyContent: StoryContent,
    /** The stream of activation results. */
    activating: ActivationObservable
  ): Obs<TriggeredBiasGroup> => {
    return activating.pipe(
      // We only want activated entries with categories.
      rxop.collect((source) => {
        if (source.activationState !== "activated") return undefined;
        if (!categories.isCategorized(source)) return undefined;
        return source;
      }),
      rxop.connect((shared) => {
        // Create a map of the categories for look up.
        const categoryMap = new Map(
          storyContent.lorebook.categories
            .filter(isBiasedCategory)
            .map((cat) => [cat.name, cat] as const)
        );

        return rx.merge(
          // Activated categories: use the `categoryMap` to filter out and
          // map to known/existing category instance.
          shared.pipe(
            rxop.collect((source) => categoryMap.get(source.entry.category)),
            rxop.map(({ name, categoryBiasGroups }) => ({
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
            rxop.reduce((a, c) => (a.delete(c.entry.category), a), new Map(categoryMap)),
            rxop.mergeMap((catMap) => catMap.values()),
            rxop.map(({ name, categoryBiasGroups }) => ({
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