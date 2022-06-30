import $FragmentAssembly from "../FragmentAssembly";
import AppConstants from "@nai/AppConstants";

import type { AssemblyInit } from "@spec/helpers-assembly";
import type { FragmentAssembly } from "../FragmentAssembly";

const fakeRequire: any = (module: any) => {
  switch (module) {
    // Imported by `TextSplitterService`.
    case AppConstants: return {
      contextSize: 2000
    };
    default: return {};
  }
};

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