import type { UndefOr } from "@utils/utility-types";
import type { TextFragment } from "@src/contextBuilder/TextSplitterService";
import type { TextCursor } from "@src/contextBuilder/TextAssembly";
import type { AssemblyCursor, FullTextCursor } from "@src/contextBuilder/TextAssembly";

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
export function mockCursor(offset: number, type?: "assembly", origin?: any): AssemblyCursor;
/**
 * Builds a mock {@link TextCursor}; the type is not known and not type-checked.
 * 
 * By default, `origin` is a new empty-object instance, but anything
 * may be provided, in service of the test.
 */
export function mockCursor(offset: number, type?: string, origin?: any): TextCursor;
export function mockCursor(
  offset: number,
  type: TextCursor["type"] = "assembly",
  origin?: any,
): TextCursor {
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