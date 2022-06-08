import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { assert, assertExists } from "@utils/assert";
import { iterReverse, countBy } from "@utils/iterables";
import { isArray, isString } from "@utils/is";
import AppConstants from "@nai/AppConstants";

import type { UndefOr } from "@utils/utility-types";
import type { ContextConfig } from "@nai/Lorebook";

type TrimType = ContextConfig["maximumTrimType"];

/** Represents a fragment of some larger body of text. */
export interface TextFragment {
  readonly content: string;
  readonly offset: number;
}

export type TextOrFragment = string | TextFragment;

const { raw } = String;

/**
 * A raw string with all the punctuation characters we care about.
 * 
 * The characters are:
 * - The typical english `.`, `?`, and `!`.
 * - The `~` character, which is seeing more common use.
 * - `\xbf` -> `¿`
 * - `\xa1` -> `¡`
 * - `\u061f` -> `؟`
 * - `\u3002` -> `。`
 * - `\uff1f` -> `？`
 * - `\uff01` -> `！`
 */
const PUNCT = raw`.?!~\xbf\xa1\u061f\u3002\uff1f\uff01`;
/** The quote characters we care about. */
const QUOTE = `'"`;
/**
 * An exception case in sentence separation: english honorific abbreviations.
 * Seems a bit much, but NovelAI apparently found this necessary.
 */
const HONORIFIC = raw`(?:dr|mrs?|ms|esq|jr|sn?r)\.`;

/** Matches something that isn't English syntax. */
const reWordy = new RegExp(`[^${PUNCT}${QUOTE}\\s-]`);
/** Matches any string with at least one newline character. */
const reHasNewLine = /\n/;

/**
 * Each match will be one of:
 * - A single `\n` character.
 * - A word's contents.
 * - Stuff between words (punctuation and other whitespace).
 */
const reByWord = dew(() => {
  /** Anything that is not whitespace and within a word-boundary is a word. */
  const singleWord = raw`\b\S+\b`;
  /**
   * Otherwise, if we have at least one character, grab characters until:
   * - We hit a word boundary (start of next word).
   * - End of the string.
   * - The position immediately before a `\n` character.  We don't want to
   *   consume the `\n`, only stop before it.
   */
  const elseUntilNextWordOrEnd = raw`.+?(?:\b|$|(?=\n))`;
  /** A `\n` is the only thing left of the possibilities. */
  const endOfLine = raw`\n`;

  return new RegExp(`${singleWord}|${elseUntilNextWordOrEnd}|${endOfLine}`, "gi");
});

/**
 * This regular expression is designed to work against isolated lines.
 * 
 * Categorizes each match into one of three capture groups:
 * `[1]` - Whitespace between sentences.
 * `[2]` - Punctuation (may include the odd quote character).
 * `[3]` - The sentence contents.
 * 
 * There must be whitespace separating sentences for them to count as
 * separate sentences.  This helps ensure that things like "novelai.com"
 * remain together.
 * 
 * This will fail to handle certain syntactical complexities; for
 * instance, a quote within a quote.  It's just not worth dealing with.
 */
const reBySentence = dew(() => {
  /** A group for whitespace. */
  const wsGroup = raw`\s+`;
  /**
   * A group for things that define a sentence ending, which is defined as:
   * - One or more punctuation characters.
   * - Then zero-or-more closing-quote characters.
   * - Terminated by the end of the string or some whitespace.
   */
  const punctGroup = raw`[${PUNCT}]+[${QUOTE}]*(?=$|\s)`;
  /**
   * A group for the sentence contents, which is terminated either when
   * we hit the end of the string or we find something the punctuation
   * group would match.
   * 
   * We have a special exception to allow a period to be a part of the
   * sentence when it comes before an english honorific.
   */
  const contentGroup = raw`(?:${HONORIFIC}|.)+?(?=$|${punctGroup})`;

  return new RegExp(`(${wsGroup})|(${punctGroup})|(${contentGroup})`, "gi")
});

/**
 * Each match will be one of:
 * - A single `\n` character.
 * - A line's contents.
 */
const reByLine = /\n|.+/g;

export default usModule((require, exports) => {
  // NovelAI uses this value times 20 as a safe chunk size to get plenty
  // of lines of story to kick off lorebook key matching.  I don't like
  // assumptions; we'll still use it, but with a safer method.
  const chunkSize = require(AppConstants).contextSize;
  assert("Expected chunk size greater than 0.", !!chunkSize && chunkSize > 0);

  /**
   * Builds a {@link TextFragment} given some inputs.
   * 
   * A `source` may be given if this fragment was derived from another
   * string or fragment.  If its a {@link TextFragment}, then its
   * {@link TextFragment.offset offset} will be applied to the given
   * `offset` for you.
   */
  const createFragment = (
    /** The content of the fragment. */
    content: string,
    /** The offset of the fragment within the source fragment/string. */
    offset: number,
    /** The source fragment/string, if `content` came from it. */
    source?: TextOrFragment
  ): TextFragment => {
    const result
      = !source || isString(source) ? { content, offset }
      : { content, offset: source.offset + offset };
    return Object.freeze(result);
  };

  /** Standardizes on text fragments for processing. */
  const asFragment = (inputText: TextOrFragment): TextFragment =>
    isString(inputText) ? createFragment(inputText, 0) : inputText;
  
  /** Pulls the content text from a string or fragment. */
  const asContent = (inputText: TextOrFragment): string =>
    isString(inputText) ? inputText : inputText.content;
  
  /**
   * Combines many sequential fragments into a single fragment.
   * 
   * This function performs no checks to validate the fragments are
   * actually sequential; it will join the fragments in the order given.
   * 
   * If they are not sequential, only the offset of the initial fragment
   * is preserved and any information about gaps that existed in `fragments`
   * will be lost.
   */
  const mergeFragments = (fragments: Iterable<TextFragment>): TextFragment => {
    const parts = isArray(fragments) ? fragments : [...fragments];
    assert("Expected at least one text fragment.", parts.length > 0);
    const content = parts.map(asContent).join("");
    const [{ offset }] = parts;
    return { content, offset };
  };

  /**
   * Checks if the given collection of fragments is contiguous; this means
   * the collection has no gaps and all fragments are not out-of-order.
   * 
   * Returns `false` if `fragments` was empty.
   */
  const isContiguous = (fragments: Iterable<TextFragment>): boolean => {
    let lastFrag: UndefOr<TextFragment> = undefined;
    for (const curFrag of fragments) {
      if (lastFrag) {
        const expectedOffset = lastFrag.offset + lastFrag.content.length;
        if (curFrag.offset !== expectedOffset) return false;
      }
      lastFrag = curFrag;
    }
    // Return `false` if `fragments` was empty.
    return Boolean(lastFrag);
  };

  /**
   * Splits a text fragment at a specific offset.  The offset should be
   * relative to the source text and within the bounds of the fragment.
   */
  const splitFragmentAt = (
    /** The fragment to split. */
    fragment: TextFragment,
    /** The offset of the cut. */
    cutOffset: number
  ): [TextFragment, TextFragment] => {
    const { offset, content } = fragment;
    assert(
      "Expected cut offset to be in bounds of the fragment.",
      cutOffset >= offset && cutOffset <= offset + content.length
    );

    // Fast-path: reuse the instance if cutting at beginning.
    if (cutOffset === offset)
      return [createFragment("", 0, fragment), fragment];
    // Fast-path: reuse instance if cutting at end.
    if (cutOffset === offset + content.length)
      return [fragment, createFragment("", content.length, fragment)];

    // Get the relative position of the offset.
    const position = cutOffset - offset;
    const before = content.slice(0, position);
    const after = content.slice(position);
    return [
      createFragment(before, 0, fragment),
      createFragment(after, before.length, fragment)
    ];
  };
  
  /**
   * Breaks text up into fragments containing one of:
   * - A single `\n` character.
   * - The full contents of a line.
   * 
   * Will yield no elements for an empty string.
   */
  function* byLine(inputText: TextOrFragment): Iterable<TextFragment> {
    const inputFrag = asFragment(inputText);

    for(const match of inputFrag.content.matchAll(reByLine)) {
      const [content] = match;
      const offset = assertExists("Expected match index to exist.", match.index);
      assert("Expected match contents to be non-empty.", content.length > 0);
      yield createFragment(content, offset, inputFrag);
    }
  }

  /**
   * Gets a chunk of text towards the end of `inputFrag.content` but
   * before `endIndex`.  This chunk will always contain a `\n` character
   * or will be the final line of iteration.
   */
  function getChunkAtEnd(
    inputFrag: TextFragment,
    endIndex: number = inputFrag.content.length
  ): TextFragment {
    if (!inputFrag.content.length) return createFragment("", 0, inputFrag);
    // The caller should have aborted instead of calling this.
    assert("End index must be non-zero.", endIndex > 0);

    const { content } = inputFrag;
    let startIndex = Math.max(0, endIndex - chunkSize);
    let chunk = content.slice(startIndex, endIndex);

    while (startIndex > 0) {
      if (reHasNewLine.test(chunk)) break;
      startIndex = Math.max(0, startIndex - chunkSize);
      chunk = content.slice(startIndex, endIndex);
    }

    return createFragment(chunk, startIndex, inputFrag);
  }

  /**
   * Produces fragments of text as {@link byLine} does, however it yields
   * lines in reverse order and is guaranteed to remain fairly efficient
   * while guaranteeing you get each line.
   * 
   * Just to be doubly-clear, **REVERSE ORDER**!  If you want the fragments
   * in normal order, pass the returned iterable through {@link iterReverse}.
   */
  function* byLineFromEnd(inputText: TextOrFragment): Iterable<TextFragment> {
    const inputFrag = asFragment(inputText);
    let curChunk = getChunkAtEnd(inputFrag);

    // The idea here is to yield lines from the chunk in reverse until
    // the last, presumably partial, line is encountered.  At this point,
    // we go back to the offset of the last line yielded and grab a new
    // chunk from there.
    while(curChunk.offset > inputFrag.offset) {
      let lastOffset: number | null = null;

      // We're going to use `curChunk.content` directly so that when we
      // see `line.offset === 0`, we know we're at the first line of
      // the chunk.  This means we'll need to correct the offset.
      for (const line of iterReverse(byLine(curChunk.content))) {
        // Don't yield the first line; it may be a partial line.
        if (line.offset === 0) break;
        lastOffset = line.offset;
        yield createFragment(line.content, line.offset, curChunk);
      }

      // Grab the next chunk ending at the last known good line.
      // Remember: `lastOffset` needs to be corrected.
      const nextOffset = curChunk.offset + assertExists(
        "Expected to encounter one line not from the start of the chunk.",
        lastOffset
      );
      // We must correct for `inputFrag` not being at offset `0`
      // to properly obtain an index on its content.
      curChunk = getChunkAtEnd(inputFrag, nextOffset - inputFrag.offset);
    }

    // If we've reached the start of the string, just yield the remaining
    // chunk's lines and we're done.  There's no need to adjust the
    // offset in this case.
    yield* iterReverse(byLine(curChunk));
  }

  /**
   * Breaks text up into fragments containing one of:
   * - A single `\n` character.
   * - A block of other whitespace characters.
   * - The contents of a single sentence.
   * 
   * It will do its best to yield full sentences, but it may fail to keep
   * a sentence together due to certain English language complexities.
   * 
   * For instance, the following text:
   * > Taleir exclaims, "but the dog said, 'it's right over there!'
   * > This doesn't make sense!" She pouts unhappily.
   * 
   * Will yield something like:
   * - `Taleir exclaims, "but the dog said, 'it's right over there!'`
   * - ` `
   * - `This doesn't make sense!"`
   * - ` `
   * - `She pouts unhappily.`
   */
  function* bySentence(inputText: TextOrFragment): Iterable<TextFragment> {
    const inputFrag = asFragment(inputText);

    // To simplify destructuring, we'll start by breaking the content up by
    // lines.  This way, the `\n` character won't complicate things.
    for (const fragment of byLine(inputFrag)) {
      // If the fragment is a `\n` character, carry on.
      if (fragment.content === "\n") {
        yield fragment;
        continue;
      }

      // We're going to need to fuse the body and punctuation parts together.
      // It's gonna be a bit weird...
      let lastBody: TextFragment | null = null;

      for (const match of fragment.content.matchAll(reBySentence)) {
        const [, whitespace, punctuation, body] = match;
        assert(
          "Expected exactly one capture group to be populated.",
          countBy([whitespace, punctuation, body], Boolean) === 1
        );
        const index = assertExists("Expected match index to exist.", match.index);

        // If we have a body on standby, but we just got something that
        // is not punctuation to close it off, yield the body now.
        if (!punctuation && lastBody) {
          yield lastBody;
          lastBody = null;
        }

        if (punctuation) {
          if (!lastBody) yield createFragment(punctuation, index, fragment);
          else {
            yield createFragment(`${lastBody.content}${punctuation}`, lastBody.offset);
            lastBody = null;
          }
        }
        else if (whitespace) {
          yield createFragment(whitespace, index, fragment);
        }
        else if (body) {
          // Hold on to this body until we've seen the next match.
          lastBody = createFragment(body, index, fragment);
        }
      }

      // If we're still holding a body, yield it before we loop.
      if (lastBody) yield lastBody;
    }
  }

  /**
   * Breaks text up into fragments containing one of:
   * - A single `\n` character.
   * - A word's contents.
   * - Stuff between words (punctuation and other whitespace).
   */
  function* byWord(inputText: TextOrFragment): Iterable<TextFragment> {
    const inputFrag = asFragment(inputText);

    for(const match of inputFrag.content.matchAll(reByWord)) {
      const [content] = match;
      const length = content.length;
      const index = assertExists("Expected match index to exist.", match.index);
      assert("Expected match contents to be non-empty.", length > 0);
      yield createFragment(content, index, inputFrag);
    }
  }

  /**
   * Determines if some text (or a fragment of text) has any contents that
   * looks like a word.
   * 
   * This basically looks for any character that is not:
   * - Whitespace.
   * - A single or double quote character.
   * - A common sentence terminator `.?!~`.
   * - A hyphen (since it is used as a word joiner).
   */
  function hasWords(inputText: TextOrFragment): boolean {
    return reWordy.test(isString(inputText) ? inputText : inputText.content);
  }

  /**
   * Builds an iterator that breaks up the given fragments to the desired
   * granularity specified by `splitType` in the most efficient way possible
   * and only as much as demanded by the consumer of the iterator.
   * 
   * This smooths over the minute differences in output between using:
   * - The `byWord` splitter on its own, which will group punctuation
   *   and not-newline whitespace into a single fragment (anything
   *   that is not a word).
   * - The `token` level trim-sequencer, which will split by sentence
   *   first, separating out the not-newline white space between
   *   sentences first, before splitting again by word, which will
   *   separate the punctuation at the end of the sentence.
   * 
   * If you need the consistent behavior and laziness of a trim-sequencer
   * without doing the trimming part, use this rather than calling the
   * splitting functions yourself.
   */
  function makeFragmenter(
    /** The granularity of the fragments desired. */
    splitType: TrimType,
    /** Whether to yield the fragments in reversed order. */
    reversed: boolean = false
  ) {
    const TYPES = ["newline", "sentence", "token"] as const;
    const index = TYPES.findIndex((v) => v === splitType);
    const splitters = TYPES.slice(0, index + 1).map((v) => {
      switch (v) {
        case "newline": return byLine;
        case "sentence": return bySentence;
        case "token": return byWord;
      }
    });

    // We're just gonna go recursive, as usual.
    function *innerIterator(
      frags: Iterable<TextFragment>,
      splitFns: typeof splitters
    ): Iterable<TextFragment> {
      // If we're iterating towards the top of the assembly, we need
      // to reverse the fragments we were given.
      frags = reversed ? iterReverse(frags) : frags;

      if (!splitFns.length) {
        // if we have no functions to split, the recursion is finished.
        // Just spit them back out (maybe in reversed order).
        yield* frags;
      }
      else {
        // Otherwise, split them up and recurse.
        const [nextFn, ...restFns] = splitFns;
        for (const srcFrag of frags)
          yield* innerIterator(nextFn(srcFrag), restFns);
      }
    }

    const fragmenter = (
      /** The fragments to be split up. */
      fragments: Iterable<TextFragment>
    ) => innerIterator(fragments, splitters);

    return fragmenter;
  };

  return Object.assign(exports, {
    byLine,
    byLineFromEnd,
    bySentence,
    byWord,
    hasWords,
    createFragment,
    asFragment,
    asContent,
    mergeFragments,
    isContiguous,
    splitFragmentAt,
    makeFragmenter
  });
});