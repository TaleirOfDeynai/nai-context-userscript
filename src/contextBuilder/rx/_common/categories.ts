import _conforms from "lodash/conforms";
import { usModule } from "@utils/usModule";
import { isString, isArray, isUndefined } from "@utils/is";

import type { TypePredicate, TypePredicateOf } from "@utils/is";
import type { IContextField } from "@nai/ContextModule";
import type { PhraseBiasConfig, LoreEntry, Categories } from "@nai/Lorebook";
import type { ContextSource } from "../../ContextSource";

export type BiasedCategory = Categories.Category & {
  categoryBiasGroups: PhraseBiasConfig[]
};

export type SubContextCategory = Categories.Category & Categories.WithSubcontext;

export interface CategorizedField extends IContextField {
  category: LoreEntry["category"];
}

export type CategorizedSource = ContextSource<CategorizedField>;

export default usModule((_require, exports) => {
  /** Checks to see if the entry of `source` has a `category` field. */
  const isCategorized = _conforms<any>({
    entry: _conforms({
      fieldConfig: _conforms({
        // Need a non-empty string to qualify.
        category: (v) => isString(v) && Boolean(v)
      })
    })
  }) as TypePredicateOf<CategorizedSource>;

  const isBiasedCategory = _conforms<any>({
    categoryBiasGroups: (v) => isArray(v) && Boolean(v.length)
  }) as TypePredicate<BiasedCategory, Categories.Category>;

  const isSubContextCategory = _conforms<Partial<SubContextCategory>>({
    createSubcontext: (v) => v === true,
    subcontextSettings: (v) => !isUndefined(v)
  }) as TypePredicate<SubContextCategory, Categories.Category>;

  return Object.assign(exports, {
    isCategorized,
    isBiasedCategory,
    isSubContextCategory
  });
});