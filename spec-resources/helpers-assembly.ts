import { mockFragment, toFragmentSeq, toContent } from "@spec/helpers-splitter";
import { first } from "@utils/iterables";

import type { UndefOr } from "@utils/utility-types";
import type { TextFragment } from "@src/contextBuilder/TextSplitterService";
import type { Assembly } from "@src/contextBuilder/assemblies";
import type { Cursor } from "@src/contextBuilder/cursors";

export interface GenerateOpts {
  prefix?: string;
  suffix?: string;
  content?: string[];
}

interface BaseData {
  prefix: TextFragment;
  content: readonly TextFragment[];
  suffix: TextFragment;
}

/** This fits the minimum {@link Assembly.IFragment} interface. */
export interface AssemblyData extends BaseData, Omit<Assembly.IFragment, "content"> {
  /** The maximum offset of the content. */
  maxOffset: number;
  /** Short-hand to create a fragment cursor. */
  inFrag(offset: number): Cursor.Fragment;
  /** Short-hand to create a full-text cursor. */
  inText(offset: number): Cursor.FullText;
  /** Gets the concatenation of the fragments. */
  getText(): string;
}

export interface BoundCursors {
  fragment: (offset: number) => Cursor.Fragment;
  fullText: (offset: number) => Cursor.FullText;
}

export interface AssemblyInit extends BaseData {
  maxOffset?: number;
  isContiguous?: boolean;
  source?: Assembly.IFragment | null;
}

/**
 * Builds a mock {@link Cursor.FullText}.
 * 
 * By default, `origin` is a new empty-object instance, but anything
 * may be provided, in service of the test.
 */
export function mockCursor(offset: number, type: "fullText", origin?: any): Cursor.FullText;
/**
 * Builds a mock {@link Cursor.Assembly}.
 * 
 * By default, `origin` is a new empty-object instance, but anything
 * may be provided, in service of the test.
 */
export function mockCursor(offset: number, type?: "fragment", origin?: any): Cursor.Fragment;
/**
 * Builds a mock {@link TextCursor}; the type is not known and not
 * type-checked.
 * 
 * By default, `origin` is a new empty-object instance, but anything
 * may be provided, in service of the test.
 */
export function mockCursor(offset: number, type?: string, origin?: any): Cursor.Any;
export function mockCursor(
  offset: number,
  type: Cursor.Any["type"] = "fragment",
  origin: any = {},
): Cursor.Any {
  return Object.freeze({ type, offset, origin });
}

/**
 * Creates a mock cursor factory bound to a given `origin`.
 * Just saves some typing when working with a single assembly.
 */
export const cursorOfOrigin = (origin: any): BoundCursors => ({
  fragment: (offset: number) => mockCursor(offset, "fragment", origin),
  fullText: (offset: number) => mockCursor(offset, "fullText", origin)
});

/** Gets the position just before a fragment. */
export const beforeFrag = (frag: UndefOr<TextFragment>) =>
  frag?.offset ?? 0;

/** Gets a position in the middle of a fragment. */
export const insideFrag = (frag: UndefOr<TextFragment>) =>
  !frag ? 0 : frag.offset + Math.floor(frag.content.length / 2);

/** Gets the position just after a fragment. */
export const afterFrag = (frag: UndefOr<TextFragment>) =>
  !frag ? 0 : frag.offset + frag.content.length;

/** Merges a sequence of fragments into a single fragment. */
export const asMerged = (frags: readonly TextFragment[]) =>
  mockFragment(frags.map(toContent).join(""), beforeFrag(first(frags)));

/** Generates the data for a standard test assembly. */
export const generateData = (
  /** How much padding to offset the start and end of the content. */
  contentOffset: number,
  /** Provide different options to customize the assembly. */
  options?: Readonly<GenerateOpts>
): Readonly<AssemblyData> => {
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

  return Object.freeze({
    prefix, content, suffix, maxOffset,
    // These use `this`, so if they get spread into a new object, they
    // will still be bound to the same assembly.
    inFrag(offset: number) { return mockCursor(offset, "fragment", this); },
    inText(offset: number) { return mockCursor(offset, "fullText", this); },
    getText() {
      return [this.prefix, ...this.content, this.suffix]
        .map((f) => f.content)
        .filter(Boolean)
        .join("");
    }
  });
};

/** Mix this into the options of {@link generateData} to disable affixing. */
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