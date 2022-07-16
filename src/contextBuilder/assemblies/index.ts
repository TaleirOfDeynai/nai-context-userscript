/**
 * Module related to manipulating `IFragmentAssembly`.
 */

import { usModule } from "@utils/usModule";

// User-script imports...
import $FragmentAssembly from "./Fragment";

// Type re-exports...
import type { IFragmentAssembly } from "./_interfaces";
import type { ITokenizedAssembly } from "./_interfaces";
import type { BaseAssembly } from "./Base";
import type { FragmentAssembly } from "./Fragment";
import type { TokenizedAssembly } from "./Tokenized";

export namespace Assembly {
  export type IFragment = IFragmentAssembly;
  export type ITokenized = ITokenizedAssembly;
  export type Base = BaseAssembly;
  export type Fragment = FragmentAssembly;
  export type Tokenized = TokenizedAssembly;

  /** Either of the class-based assemblies. */
  export type Any = FragmentAssembly | TokenizedAssembly;
}

export default usModule((require, exports) => {
  return Object.assign(exports, {
    Fragment: $FragmentAssembly(require)
  });
});