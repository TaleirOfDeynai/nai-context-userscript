
import { partition } from "@utils/rx";
import { shareReplay } from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { isBoolean, isObject } from "@utils/is";
import { categories } from "../_shared";

import type { Observable as Obs } from "@utils/rx";
import type { Categories } from "@nai/Lorebook";
import type { StoryContent } from "@nai/EventModule";
import type { ContextSource } from "../../ContextSource";

export default usModule((_require, exports) => {
  const isEnabled = <T extends ContextSource<any>>(source: T): boolean => {
    const { entry } = source;
    // If it isn't an object, it's default disabled.
    if (!isObject(entry)) return false;
    // If it lacks the `enabled` property, it's default enabled.
    if (!("enabled" in entry)) return true;
    // Unless it isn't well-formed.
    if (!isBoolean(entry.enabled)) return false;
    return entry.enabled;
  };

  const checkCategory = (allCategories: Categories.Category[]) =>
    (source: ContextSource<any>): boolean => {
      // The entry must have a category to be disabled through it.
      if (!categories.isCategorized(source)) return false;

      const theName = source.entry.category;
      const category = allCategories.find((c) => c.name === theName);
      // We'll accept only an explicit `false` to disable it.
      return category?.enabled !== false;
    };

  const separate = (storyContent: StoryContent) => {
    const isCategoryEnabled = checkCategory(storyContent.lorebook.categories);

    return <T extends ContextSource>(sources: Obs<T>) => {
      const [enabled, disabled] = partition(sources, (source) => {
        if (!isEnabled(source)) return false;
        if (!isCategoryEnabled(source)) return false;
        return true;
      });
      return {
        enabledSources: enabled.pipe(shareReplay()),
        disabledSources: disabled.pipe(shareReplay())
      };
    };
  };

  return Object.assign(exports, { separate });
});