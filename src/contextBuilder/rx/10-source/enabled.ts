import _conforms from "lodash/conforms";
import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import $Common from "../_common";

import type { Categories } from "@nai/Lorebook";
import type { StoryContent } from "@nai/EventModule";
import type { ContextSource } from "../../ContextSource";

export interface EnabledSource extends ContextSource {
  enabled: true;
};

export interface DisabledSource extends ContextSource {
  enabled: false;
};

export default usModule((require, exports) => {
  const { categories } = $Common(require);

  const isEnabled = _conforms({
    entry: _conforms({
      fieldConfig: (c: { enabled?: boolean }) => {
        // Enabled by default if it lacks the `enabled` property.
        if (!("enabled" in c)) return true;
        // Otherwise, it must be exactly `true`.
        return c.enabled === true;
      }
    })
  });

  const checkCategory = (allCategories: Map<string, Categories.Category>) =>
    (source: ContextSource): boolean => {
      // The entry must have a category to even be disabled through it.
      if (!categories.isCategorized(source)) return true;

      const category = allCategories.get(source.entry.fieldConfig.category);
      // We'll accept only an explicit `false` to disable it.
      return category?.enabled !== false;
    };
  
  const toEnabled = (source: ContextSource): EnabledSource =>
    Object.assign(source, { enabled: true } as const);

  const toDisabled = (source: ContextSource): DisabledSource =>
    Object.assign(source, { enabled: false } as const);

  const separate = <T extends ContextSource>(
    storyContent: StoryContent,
    sources: rx.Observable<T>
  ) => {
    const catKvps = storyContent.lorebook.categories.map((c) => [c.id ?? c.name, c] as const);
    const isCategoryEnabled = checkCategory(new Map(catKvps));

    const [enabled, disabled] = rx.partition(sources, (source) => {
      if (!isEnabled(source)) return false;
      if (!isCategoryEnabled(source)) return false;
      return true;
    });

    return {
      enabledSources: enabled.pipe(rxop.map(toEnabled), rxop.shareReplay()),
      disabledSources: disabled.pipe(rxop.map(toDisabled), rxop.shareReplay())
    };
  };

  return Object.assign(exports, { separate });
});