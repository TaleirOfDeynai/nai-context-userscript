import { usModule } from "../utils/usModule";
import * as Iterables from "../utils/iterables";
import { assert, assertExists } from "../utils/assert";

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
const reBySentence = /(\s+)|([.?!~]+['"]*(?=$|\s))|(.+?(?=$|[.?!~]+['"]*(?:\s+\b|$)))/g;

/**
 * Each match will be one of:
 * - A single `\n` character.
 * - A line's contents.
 */
const reByLine = /\n|.+/g;

export default usModule((_require, exports) => {

  const resultFrom = (content: string, offset: number): TextFragment =>
    ({ content, offset, length: content.length });
  
  /**
   * Breaks text up into fragments containing one of:
   * - A single `\n` character.
   * - The full contents of a line.
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
    bySentence,
    byWord,
    hasWords
  });
});