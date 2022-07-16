/**
 * Module related to manipulating `IFragmentAssembly`.
 */

import { usModule } from "@utils/usModule";

// User-script imports...
import $CompoundAssembly from "./Compound";
import $FragmentAssembly from "./Fragment";
import $TokenizedAssembly from "./Tokenized";

// Type re-exports...
import type { IFragmentAssembly } from "./_interfaces";
import type { ITokenizedAssembly } from "./_interfaces";
import type { BaseAssembly } from "./Base";
import type { FragmentAssembly } from "./Fragment";
import type { TokenizedAssembly } from "./Tokenized";
import type { CompoundAssembly } from "./Compound";

export namespace Assembly {
  export type IFragment = IFragmentAssembly;
  export type ITokenized = ITokenizedAssembly;
  export type Base = BaseAssembly;
  export type Fragment = FragmentAssembly;
  export type Tokenized = TokenizedAssembly;
  export type Compound = CompoundAssembly;

  /** Either of the class-based fragment assemblies. */
  export type AnyFragment = FragmentAssembly | TokenizedAssembly;
}

export default usModule((require, exports) => {
  return Object.assign(exports, {
    Compound: $CompoundAssembly(require),
    Fragment: $FragmentAssembly(require),
    Tokenized: $TokenizedAssembly(require)
  });
});