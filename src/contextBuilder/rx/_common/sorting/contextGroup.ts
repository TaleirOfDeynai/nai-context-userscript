import { usModule } from "@utils/usModule";
import $ContextGroup from "../../../assemblies/ContextGroup";

import type { EntrySorter } from "./index";

export default usModule((require, exports) => {
  const { ContextGroup } = $ContextGroup(require);

  /** Sorts sources that are context-groups first. */
  const contextGroup: EntrySorter = () => {
    return (a, b) => {
      const aIsGroup = a instanceof ContextGroup;
      const bIsGroup = b instanceof ContextGroup;
      if (aIsGroup === bIsGroup) return 0;
      if (aIsGroup) return -1;
      return 1;
    };
  };

  return Object.assign(exports, { contextGroup });
});