import _conforms from "lodash/conforms";
import { usModule } from "@utils/usModule";
import $Activation from "./activation";
import $BiasGroups from "./biasGroups";
import $Categories from "./categories";
import $Selection from "./selection";
import $SubContexts from "./subContexts";

import type { ContextSource } from "../../ContextSource";
import type { SourceLike } from "../../assemblies/Compound";

export type SourceOf<T extends ContextSource> = SourceLike | T;
export type SomeContextSource = SourceOf<ContextSource>;

export default usModule((require, exports) => {
  return Object.assign(exports, {
    activation: $Activation(require),
    biasGroups: $BiasGroups(require),
    categories: $Categories(require),
    selection: $Selection(require),
    subContexts: $SubContexts(require)
  });
});