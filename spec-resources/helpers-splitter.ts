import _zip from "lodash/zip";
import { reduceIter, last } from "@utils/iterables";

import type { TextFragment } from "@src/contextBuilder/TextSplitterService";

/** Builds a {@link TextFragment} from a string. */
export const mockFragment = (content: string, offset: number, srcFrag?: TextFragment) =>
  Object.freeze({ content, offset: offset + (srcFrag?.offset ?? 0) }) as TextFragment;

/**
 * Creates an empty fragment.  When given a fragment, creates it with
 * the same offset.  Otherwise, defaults to an offset of `0`.
 */
export const getEmptyFrag = (frag?: TextFragment) =>
  !frag ? mockFragment("", 0) : mockFragment("", 0, frag);

/** A function to get {@link TextFragment.content} for `map` and friends. */
export const toContent = (fragment: TextFragment) => fragment.content;

/**
 * Constructs a sequence that will ensure the punctuation at
 * the end of each sentence is positioned to split at the
 * middle of the assembled string.
 * 
 * Input: `["Foo.", "Bar!"]`
 * Output: `["Foo.", "Bar!", "Foo."]`
 * 
 * When joined: `"Foo. Bar! Foo."`
 */
export const forSingleLine = (collection: readonly string[]) => {
  // Loop back around so each punctuation is used to split.
  return [...collection, collection[0]];
};

/**
 * Creates pairs of sentences from the collection, ensuring each
 * sentence is in the front position once, where it is expected
 * to split.
 * 
 * The pairs themselves may be joined into a single line with
 * `" "` and the those single lines joined into a corpus of
 * lines with `"\n"`.
 * 
 * Input: `["Foo.", "Bar!"]`
 * Output: `[["Foo.", "Bar!"], ["Bar!", "Foo."]]`
 * 
 * When joined: `"Foo. Bar!\nBar! Foo."`
 */
export const forManyLines = (collection: readonly string[]) => {
  // This pattern will position each sentence so that each sentence
  // is split by its punctuation once.
  const [firstEl, ...restEls] = collection;
  return _zip(collection, [...restEls, firstEl]) as string[][];
};

/**
 * Converts the given `sections` into contiguous fragments with
 * the given `baseOffset`.
 */
export const toFragmentSeq = (sections: readonly string[], baseOffset: number) => {
  const theSeq = reduceIter(
    sections, [],
    (acc: TextFragment[], section: string) => {
      const prev = last(acc);
      if (!prev) return [mockFragment(section, baseOffset)];
      const nextOffset = prev.offset + prev.content.length;
      return [...acc, mockFragment(section, nextOffset)];
    }
  );

  return Object.freeze(theSeq);
};

/**
 * When given a `createFragment`, function, this returns a function
 * that can take a fragment and the individual sections that were
 * joined to create that fragment and return an array of fragments
 * with the correct offsets.
 */
export const toExpectSeq = (sourceFrag: TextFragment, sourceSections: readonly string[]) =>
  toFragmentSeq(sourceSections, sourceFrag.offset);