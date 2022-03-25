import { usModule } from "../utils/usModule";
import { assert, assertAs, assertExists } from "../utils/assert";
import { iterReverse } from "../utils/iterables";
import { isNumber } from "../utils/is";
import AppConstants from "../naiModules/AppConstants";

/** Represents a fragment of some larger body of text. */
export interface TextFragment {
  readonly content: string;
  readonly offset: number;
  readonly length: number;
}

/** Matches smart single quotes. */
const reSmartSQ = /[\u2018\u2019\u201A\u201B\u2032\u2035]/g;
/** Matches smart double quotes. */
const reSmartDQ = /[\u201C\u201D\u201E\u201F\u2033\u2036]/g;
/** Matches something that isn't English syntax. */
const reWordy = /[^\s'".?!~-]/;
/** Matches any string with at least one newline character. */
const reHasNewLine = /\n/;

/**
 * Each match will be one of:
 * - A single `\n` character.
 * - A word's contents.
 * - Stuff between words (punctuation and other whitespace).
 */
const reByWord = /\b\S+\b|.+?(?:\b|$|(?=\n))|\n/g;

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
const reBySentence = /(\s+)|([.?!~]+['"]*(?=$|\s))|(.+?(?=$|[.?!~]+['"]*(?:\s+|$)))/g;

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

  const resultFrom = (content: string, offset: number): TextFragment =>
    ({ content, offset, length: content.length });
  
  /**
   * Breaks text up into fragments containing one of:
   * - A single `\n` character.
   * - The full contents of a line.
   * 
   * Will yield no elements for an empty string.
   */
  function* byLine(inputText: string): Iterable<TextFragment> {
    for(const match of inputText.matchAll(reByLine)) {
      const [content] = match;
      const length = content.length;
      const offset = assertExists("Expected match index to exist.", match.index);
      assert("Expected match contents to be non-empty.", length > 0);
      yield { content, offset, length };
    }
  }

  /**
   * Gets a chunk of text towards the end of `inputText` but before
   * `endIndex`.  This chunk will always contain a `\n` character or
   * will be the final line of iteration.
   */
  function getChunkAtEnd(
    inputText: string,
    endIndex: number = inputText.length
  ): TextFragment {
    if (!inputText.length) return resultFrom("", 0);
    // The caller should have aborted instead of calling this.
    assert("End index must be non-zero.", endIndex > 0);

    let startIndex = Math.max(0, endIndex - chunkSize);
    let chunk = inputText.slice(startIndex, endIndex);

    while (startIndex > 0) {
      if (reHasNewLine.test(chunk)) break;
      startIndex = Math.max(0, startIndex - chunkSize);
      chunk = inputText.slice(startIndex, endIndex);
    }

    return resultFrom(chunk, startIndex);
  }

  /**
   * Produces fragments of text as {@link byLine} does, however it yields
   * lines in reverse order and is guaranteed to remain fairly efficient
   * while guaranteeing you get each line.
   * 
   * Just to be doubly-clear, **REVERSE ORDER**!  If you want the fragments
   * in normal order, pass the returned iterable through {@link iterReverse}.
   */
  function* byLineFromEnd(inputText: string): Iterable<TextFragment> {
    let curChunk = getChunkAtEnd(inputText);

    // The idea here is to yield lines from the chunk in reverse until
    // the last, presumably partial, line is encountered.  At this point,
    // we go back to the offset of the last line yielded and grab a new
    // chunk from there.
    while(curChunk.offset > 0) {
      let lastOffset: number | null = null;
      for (const line of iterReverse(byLine(curChunk.content))) {
        // Don't yield the first line; it may be a partial line.
        if (line.offset === 0) break;
        lastOffset = line.offset;
        yield resultFrom(line.content, curChunk.offset + line.offset);
      }

      // Grab the next chunk ending at the last known good line.
      const nextEndIndex = curChunk.offset + assertAs(
        "Expected to encounter one line not from the start of the chunk.",
        isNumber, lastOffset
      );
      curChunk = getChunkAtEnd(inputText, nextEndIndex);
    }

    // If we've reached the start of the string, just yield the remaining
    // chunk's lines and we're done.  There's no need to adjust the
    // offset in this case.
    yield* iterReverse(byLine(curChunk.content));
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
  function* bySentence(inputText: string): Iterable<TextFragment> {
    // To simplify destructuring, we'll start by breaking the content up by
    // lines.  This way, the `\n` character won't complicate things.
    for (const fragment of byLine(inputText)) {
      // If the fragment is a `\n` character, carry on.
      if (fragment.content === "\n") {
        yield fragment;
        continue;
      }

      const { offset, content } = fragment;

      // We're going to need to fuse the body and punctuation parts together.
      // It's gonna be a bit weird...
      let lastBody: TextFragment | null = null;

      for (const match of content.matchAll(reBySentence)) {
        const [, whitespace, punctuation, body] = match;
        assert(
          "Expected exactly one capture group to be populated.",
          [whitespace, punctuation, body].filter(Boolean).length === 1
        );
        const index = assertExists("Expected match index to exist.", match.index);

        // If we have a body on standby, but we just got something that
        // is not punctuation to close it off, yield the body now.
        if (!punctuation && lastBody) {
          yield lastBody;
          lastBody = null;
        }

        if (punctuation) {
          if (!lastBody) yield resultFrom(punctuation, offset + index);
          else {
            yield resultFrom(`${lastBody.content}${punctuation}`, lastBody.offset);
            lastBody = null;
          }
        }
        else if (whitespace) {
          yield resultFrom(whitespace, offset + index);
        }
        else if (body) {
          // Hold on to this body until we've seen the next match.
          lastBody = resultFrom(body, offset + index);
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
  function* byWord(inputText: string): Iterable<TextFragment> {
    for(const match of inputText.matchAll(reByWord)) {
      const [content] = match;
      const length = content.length;
      const offset = assertExists("Expected match index to exist.", match.index);
      assert("Expected match contents to be non-empty.", length > 0);
      yield resultFrom(content, offset);
    }
  }

  /**
   * Determines if a fragment has any contents that looks like a word.
   * 
   * This basically looks for any character that is not:
   * - Whitespace.
   * - A single or double quote character.
   * - A common sentence terminator `.?!~`.
   * - A hyphen (since it is used as a word joiner).
   */
  function hasWords(fragment: TextFragment): boolean {
    return reWordy.test(fragment.content);
  }

  return Object.assign(exports, {
    byLine,
    byLineFromEnd,
    bySentence,
    byWord,
    hasWords
  });
});