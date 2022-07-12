import fakeRequire from "@spec/fakeRequire";
import $FragmentAssembly from "../FragmentAssembly";

import type { AssemblyInit } from "@spec/helpers-assembly";
import type { FragmentAssembly } from "../FragmentAssembly";

export const Module = $FragmentAssembly(fakeRequire);

const { FragmentAssembly } = Module;

/** A concrete {@link FragmentAssembly}. */
export class SpecAssembly extends FragmentAssembly { }

export const initAssembly = (data: AssemblyInit) => new SpecAssembly(
  data.prefix,
  data.content,
  data.suffix,
  data.isContiguous ?? true,
  data.source ?? null
);