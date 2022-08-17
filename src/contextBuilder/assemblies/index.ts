/**
 * Assemblies are the building blocks of the context.
 * 
 * Most of the nastiness is in the assemblies-of-text-fragments, but
 * we also have assemblies-of-assemblies, because who doesn't love
 * recursion!?
 * 
 * Assemblies keep track of the relationship between its fragments
 * and any cursors that are attached to their source and provide
 * methods for manipulating them, such as splitting them apart.
 * 
 * The various `./*Ops` modules represent different kinds of queries
 * or transformations that may be performed on a fragment assembly.
 * 
 * All I really wanted was to have the dot-operator (and the
 * bind-operator is still the hostage of a bunch of Haskell fanboys
 * arguing over the planned pipe-operator).  Unfortunately, I became
 * concerned that if I kept only to the class-based approach, the
 * mass of code making it up would collapse into a black-hole and
 * kill us all.
 * 
 * That's why this is semi-object-oriented and semi-procedural.
 * The classes largely only expose the methods needed for assembly.
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