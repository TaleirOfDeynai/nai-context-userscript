import { Categories } from "@nai/Lorebook";
import { usModule } from "@utils/usModule";
import { UndefOr } from "@utils/utility-types";
import $Categories from "../categories";

import type { EntrySorter } from "./index";

export default usModule((require, exports) => {
  const { isCategorized } = $Categories(require);

  /**
   * Sorts sources with a category:
   * - Before those that lack a category.
   * - By the name of the category, ascending.
   */
  const categoryName: EntrySorter = (contextParams) => {
    const categoryMap = new Map(
      contextParams.storyContent.lorebook.categories
        .map((cat) => [cat.id ?? cat.name, cat] as const)
    );

    const getCategory = (source: any): UndefOr<Categories.Category> =>
      !isCategorized(source) ? undefined : categoryMap.get(source.entry.fieldConfig.category);

    return (a, b) => {
      var aCat = getCategory(a);
      var bCat = getCategory(b);
      if (!aCat && !bCat) return 0;
      if (!aCat) return 1;
      if (!bCat) return -1;
      return aCat.name.localeCompare(bCat.name);
    };
  }

  return Object.assign(exports, { categoryName });
});