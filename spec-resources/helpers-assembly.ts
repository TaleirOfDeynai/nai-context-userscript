import { mockFragment, toFragmentSeq } from "@spec/helpers-splitter";

import type { UndefOr } from "@utils/utility-types";
import type { TextFragment } from "@src/contextBuilder/TextSplitterService";
import type { FragmentAssembly, AnyCursor } from "@src/contextBuilder/FragmentAssembly";
import type { FragmentCursor, FullTextCursor } from "@src/contextBuilder/FragmentAssembly";

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

export interface AssemblyInit extends Omit<Required<AssemblyData>, "maxOffset"> {
  maxOffset?: number;
  isContiguous?: boolean;
  source?: FragmentAssembly | null;
}

/**
 * Builds a mock {@link FullTextCursor}.
 * 
 * By default, `origin` is a new empty-object instance, but anything
 * may be provided, in service of the test.
 */
export function mockCursor(offset: number, type: "fullText", origin?: any): FullTextCursor;
/**
 * Builds a mock {@link AssemblyCursor}.
 * 
 * By default, `origin` is a new empty-object instance, but anything
 * may be provided, in service of the test.
 */
export function mockCursor(offset: number, type?: "fragment", origin?: any): FragmentCursor;
/**
 * Builds a mock {@link TextCursor}; the type is not known and not
 * type-checked.
 * 
 * By default, `origin` is a new empty-object instance, but anything
 * may be provided, in service of the test.
 */
export function mockCursor(offset: number, type?: string, origin?: any): AnyCursor;
export function mockCursor(
  offset: number,
  type: AnyCursor["type"] = "fragment",
  origin?: any,
): AnyCursor {
  return Object.freeze({ type, offset, origin });
}

/** Gets the position just before a fragment. */
export const beforeFrag = (frag: UndefOr<TextFragment>) =>
  frag?.offset ?? 0;

/** Gets a position in the middle of a fragment. */
export const insideFrag = (frag: UndefOr<TextFragment>) =>
  !frag ? 0 : frag.offset + Math.floor(frag.content.length / 2);

/** Gets the position just after a fragment. */
export const afterFrag = (frag: UndefOr<TextFragment>) =>
  !frag ? 0 : frag.offset + frag.content.length;

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