import { mockFragment, toFragmentSeq } from "@spec/helpers-splitter";
import { afterFrag } from "@spec/helpers-assembly";

import $TextAssembly from "../TextAssembly";
import AppConstants from "@nai/AppConstants";

import type { TextAssembly } from "../TextAssembly";
import type { TextFragment } from "../TextSplitterService";

const fakeRequire: any = (module: any) => {
  switch (module) {
    // Imported by `TextSplitterService`.
    case AppConstants: return {
      contextSize: 2000
    };
    default: return {};
  }
};

export const Module = $TextAssembly(fakeRequire);

const { TextAssembly } = Module;

export interface GenerateOpts {
  prefix?: string;
  suffix?: string;
  content?: string[];
}

export interface AssemblyData {
  prefix: TextFragment;
  content: readonly TextFragment[];
  suffix: TextFragment;
  maxOffset: number;
}

export const generateData = (
  contentOffset: number,
  options?: Readonly<GenerateOpts>
): AssemblyData => {
  const config = {
    prefix: "PREFIX\n",
    suffix: "\nSUFFIX",
    content: [
      "This is the first fragment.",
      "\n",
      "This is the second fragment.",
      "  ",
      "This is the third fragment."
    ],
    ...options
  };

  const prefix = mockFragment(config.prefix, 0);
  
  const content = toFragmentSeq(config.content, prefix.content.length + contentOffset);

  const maxOffset = content
    .map(afterFrag)
    .reduce((acc, o) => Math.max(acc, o), 0);

  const suffix = mockFragment(config.suffix, maxOffset + contentOffset);

  return { prefix, content, suffix, maxOffset };
};

export interface AssemblyInit extends Omit<Required<AssemblyData>, "maxOffset"> {
  maxOffset?: number;
  isContiguous?: boolean;
  source?: TextAssembly | null;
}

export const initAssembly = (data: AssemblyInit) => new TextAssembly(
  data.prefix,
  data.content,
  data.suffix,
  data.isContiguous ?? true,
  data.source ?? null
);

/** Mix this into the options to disable affixing. */
export const NO_AFFIX = { prefix: "", suffix: "" } as Readonly<GenerateOpts>;

/**
 * These fragments have no gap between the first fragment and the prefix.
 */
export const contiguousFrags = generateData(0);

/**
 * These fragments have a 3 character gap between the content and the
 * prefix and suffix.  These will likely see the most use in tests,
 * having a slight bit of awkwardness to them.
 */
export const offsetFrags = generateData(3);