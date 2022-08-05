import _conforms from "lodash/conforms";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import $Common from "../_common";
import $ContextGroup from "../../assemblies/ContextGroup";

import type { ContextParams } from "../../ParamsService";
import type { SelectionPhaseResult } from "../30-selection";

export default usModule((require, exports) => {
  const { categories } = $Common(require);
  const { forCategory } = $ContextGroup(require);

  const createStream = (
    /** The context params. */
    contextParams: ContextParams
  ) => {
    // Create a map of the categories for look up.
    const categoryMap = new Map(
      contextParams.storyContent.lorebook.categories
        .filter(categories.isSubContextCategory)
        .map((cat) => [cat.id ?? cat.name, cat] as const)
    );

    return (sources: SelectionPhaseResult["inFlight"]) => sources.pipe(
      rxop.filter(categories.isCategorized),
      rxop.map((source) => source.entry.fieldConfig.category),
      rxop.distinct(),
      rxop.collect((category) => categoryMap.get(category)),
      rxop.mergeMap((category) => forCategory(contextParams.tokenCodec, category))
    );
  };

  return Object.assign(exports, { createStream });
});