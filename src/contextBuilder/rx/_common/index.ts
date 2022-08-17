/**
 * This module provides types and helpers used internally by the
 * phase runners.  It was getting tedious finding the one helper
 * or type that I needed, so I decided to centralize them...
 * 
 * Then it got too big, so I broke them into individual modules
 * provided by this index.
 */

import { usModule } from "@utils/usModule";
import $Activation from "./activation";
import $BiasGroups from "./biasGroups";
import $Categories from "./categories";
import $Selection from "./selection";
import $Sorting from "./sorting";
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
    sorting: $Sorting(require),
    subContexts: $SubContexts(require)
  });
});