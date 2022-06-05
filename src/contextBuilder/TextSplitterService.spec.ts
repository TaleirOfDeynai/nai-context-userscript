import { describe, it, expect } from "@jest/globals";
import quickString from "@spec/quick";
import { collection as phrasesEnglish } from "@spec/phrases-english";
import { collection as phrasesSpanish } from "@spec/phrases-spanish";
import { collection as phrasesJapanese } from "@spec/phrases-japanese";
import { collection as phrasesArabic } from "@spec/phrases-arabic";

import _zip from "lodash-es/zip";
import { chain, reduceIter, interweave, last } from "@utils/iterables";
import $TextSplitterService from "./TextSplitterService";
import AppConstants from "@nai/AppConstants";

import type { TextFragment } from "./TextSplitterService";

const fakeRequire: any = (module: any) => {
  switch (module) {
    case AppConstants: return {
      // This influences `byLineFromEnd`.  We're setting it especially
      // small to test its behavior without needing large bodies of
      // text.
      contextSize: 10
    };
    default: return {};
  }
};

const textSplitter = $TextSplitterService(fakeRequire);

/** Builds the expected sequence. */
const toExpectSeq = (sourceFrag: TextFragment, sourceSections: string[]) => reduceIter(
  sourceSections, [],
  (acc: TextFragment[], section: string) => {
    const prev = last(acc);
    if (!prev) return [textSplitter.createFragment(section, 0, sourceFrag)];
    const { offset, content } = prev;
    const nextOffset = (offset + content.length) - sourceFrag.offset;
    return [...acc, textSplitter.createFragment(section, nextOffset, sourceFrag)];
  }
);

// This will be used throughout the tests; if this fails, everything
// else will pretty much fail.
describe("createFragment", () => {
  const { createFragment } = textSplitter;

  it("should create fragments with a declared offset", () => {
    expect(createFragment(quickString, 10)).toEqual({ content: quickString, offset: 10 });
  });

  it("should create fragments offset relative to a source", () => {
    const source = createFragment(quickString, 10);
    const checkMe = createFragment("statement", 5, source);
    expect(checkMe).toEqual({ content: "statement", offset: 15 });
  });

  it("should return a frozen instance", () => {
    const checkMe = createFragment(quickString, 10);
    expect(Object.isFrozen(checkMe)).toBe(true);
  });
});

describe("asFragment", () => {
  const { createFragment, asFragment } = textSplitter;

  const existingFrag = createFragment("I'm an existing fragment.", 100);

  it("should convert strings to fragments with 0 offset", () => {
    expect(asFragment(quickString)).toEqual({ content: quickString, offset: 0 });
  });

  it("should return the same instance for fragments", () => {
    expect(asFragment(existingFrag)).toBe(existingFrag);
  });
});

describe("asContent", () => {
  const { createFragment, asContent } = textSplitter;

  const testStr = "Test String";
  const testFrag = createFragment("Test Fragment", 10);

  it("should work with strings", () => {
    expect(asContent(testStr)).toBe(testStr);
  });

  it("should work with fragments", () => {
    expect(asContent(testFrag)).toBe(testFrag.content);
  });
});

describe("isContiguous", () => {
  const { createFragment, isContiguous } = textSplitter;

  const inOrder = [
    createFragment("1", 11),
    createFragment("2", 12),
    createFragment("3", 13)
  ];

  const outOfOrder = [
    createFragment("2", 12),
    createFragment("1", 11),
    createFragment("3", 13)
  ];

  const withGaps = [
    createFragment("1", 11),
    createFragment("2", 12),
    createFragment("4", 14),
    createFragment("5", 15)
  ];

  it("should pass the in-order case", () => {
    expect(isContiguous(inOrder)).toBe(true);
  });

  it("should fail the out-of-order case", () => {
    expect(isContiguous(outOfOrder)).toBe(false);
  });

  it("should fail the with-gaps case", () => {
    expect(isContiguous(withGaps)).toBe(false);
  });
});

describe("splitFragmentAt", () => {
  const { createFragment, splitFragmentAt } = textSplitter;

  const theFragment = createFragment(quickString, 20);

  it("should split at the start, reusing the fragment", () => {
    const [l, r] = splitFragmentAt(theFragment, 20);
    expect(l).toEqual({ content: "", offset: 20 });
    expect(r).toBe(theFragment);
  });

  it("should split at the end, reusing the fragment", () => {
    const endOffset = 20 + quickString.length;
    const [l, r] = splitFragmentAt(theFragment, endOffset);
    expect(l).toBe(theFragment);
    expect(r).toEqual({ content: "", offset: endOffset });
  });

  it("should split in the middle", () => {
    const offsetBeforeIs = 20 + 15;
    const [l, r] = splitFragmentAt(theFragment, offsetBeforeIs);
    expect(l).toEqual({ content: "This statement ", offset: 20 });
    expect(r).toEqual({ content: "is false.", offset: offsetBeforeIs });
  });

  it.failing("should throw if cut is before the fragment", () => {
    splitFragmentAt(theFragment, 5);
  });

  it.failing("should throw if cut is after the fragment", () => {
    splitFragmentAt(theFragment, 20 + quickString.length + 5);
  });
});

describe("byLine", () => {
  const { createFragment, byLine } = textSplitter;

  const manyLines = createFragment("First\nSecond\nThird", 10);
  const manyEmptyLines = createFragment("First\n\nSecond\n\n\nThird", 10);
  const singleLine = createFragment(quickString, 10);

  it("should split into a sequence of newline characters and text", () => {
    expect([...byLine(manyLines)]).toEqual([
      createFragment("First", 10),
      createFragment("\n", 15),
      createFragment("Second", 16),
      createFragment("\n", 22),
      createFragment("Third", 23)
    ]);
  });

  it("should work when there's multiple newlines in a row", () => {
    expect([...byLine(manyEmptyLines)]).toEqual([
      createFragment("First", 10),
      createFragment("\n", 15),
      createFragment("\n", 16),
      createFragment("Second", 17),
      createFragment("\n", 23),
      createFragment("\n", 24),
      createFragment("\n", 25),
      createFragment("Third", 26)
    ]);
  });

  it("should not split if there's no newline", () => {
    expect([...byLine(singleLine)]).toEqual([singleLine]);
  });
});

describe("byLineFromEnd", () => {
  const { createFragment, byLineFromEnd } = textSplitter;

  describe("with lines shorter than the chunk size", () => {
    const shortLines = createFragment("First\nSecond\nThird", 10);
    const shortEmptyLines = createFragment("First\n\nSecond\n\n\nThird", 10);

    it("should split into a reversed sequence of newline characters and text", () => {
      expect([...byLineFromEnd(shortLines)]).toEqual([
        createFragment("First", 10),
        createFragment("\n", 15),
        createFragment("Second", 16),
        createFragment("\n", 22),
        createFragment("Third", 23)
      ].reverse());
    });

    it("should work when there's multiple newlines in a row", () => {
      expect([...byLineFromEnd(shortEmptyLines)]).toEqual([
        createFragment("First", 10),
        createFragment("\n", 15),
        createFragment("\n", 16),
        createFragment("Second", 17),
        createFragment("\n", 23),
        createFragment("\n", 24),
        createFragment("\n", 25),
        createFragment("Third", 26)
      ].reverse());
    });
  });

  describe("with lines longer than the chunk size", () => {
    const longLines = createFragment("First\nSecond & Third\nFourth & Fifth", 10);
    const longEmptyLines = createFragment("First\n\nSecond & Third\n\n\nFourth & Fifth", 10);

    it("should split into a reversed sequence of newline characters and text", () => {
      expect([...byLineFromEnd(longLines)]).toEqual([
        createFragment("First", 10),
        createFragment("\n", 15),
        createFragment("Second & Third", 16),
        createFragment("\n", 30),
        createFragment("Fourth & Fifth", 31)
      ].reverse());
    });

    it("should work when there's multiple newlines in a row", () => {
      expect([...byLineFromEnd(longEmptyLines)]).toEqual([
        createFragment("First", 10),
        createFragment("\n", 15),
        createFragment("\n", 16),
        createFragment("Second & Third", 17),
        createFragment("\n", 31),
        createFragment("\n", 32),
        createFragment("\n", 33),
        createFragment("Fourth & Fifth", 34)
      ].reverse());
    });
  });

  describe("with a single line", () => {
    const singleLine = createFragment(quickString, 10);

    it("should not split", () => {
      expect([...byLineFromEnd(singleLine)]).toEqual([singleLine]);
    });
  });
});

describe("bySentence", () => {
  const { createFragment, bySentence } = textSplitter;

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
  const forSingleLine = (collection: readonly string[]) => {
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
  const forManyLines = (collection: readonly string[]) => {
    // This pattern will position each sentence so that each sentence
    // is split by its punctuation once.
    const [firstEl, ...restEls] = collection;
    return _zip(collection, [...restEls, firstEl]) as string[][];
  };

  describe("sanity checks of test helpers", () => {
    const input = Object.freeze(["Foo.", "Bar!"]);

    it("forSingleLine", () => {
      expect(forSingleLine(input)).toEqual(["Foo.", "Bar!", "Foo."]);
    });

    it("forManyLines", () => {
      expect(forManyLines(input)).toEqual([
        ["Foo.", "Bar!"],
        ["Bar!", "Foo."]
      ]);
    });
  });

  const testPhrases = (collection: readonly string[]) => {
    describe("with a single line", () => {
      const theSentences = forSingleLine(collection);

      const assembled = chain(theSentences)
        .thru((sentences) => interweave(" ", sentences))
        .toArray();

      const singleLine = createFragment(assembled.join(""), 10);

      it("should split into sentences and the whitespace between them", () => {
        expect([...bySentence(singleLine)]).toEqual(toExpectSeq(singleLine, assembled));
      });
    });

    describe("with a multiple lines", () => {
      const theLines = forManyLines(collection);

      const assembled = chain(theLines)
        .map((sentences) => interweave(" ", sentences))
        .thru((lines) => interweave("\n", lines))
        .flatten()
        .toArray();
      
      const manyLines = createFragment(assembled.join(""), 10);

      it("should split into sentences, newlines, and other whitespace", () => {
        expect([...bySentence(manyLines)]).toEqual(toExpectSeq(manyLines, assembled));
      });
    });
  };

  describe("English cases", () => {
    testPhrases(phrasesEnglish);

    describe("considering honorifics", () => {
      // Why am I splitting them up?  I dunno.  Boredom, I guess.
      const leading = ["Dr.", "Mr.", "Mrs.", "Ms."];
      const trailing = ["Esq.", "Jr.", "Snr.", "Sr."];

      it.each(leading.map((h) => [h]))("should not split on \"%s\"", (honorific) => {
        const source = `I am ${honorific} Len Pennington.`;
        const fragment = createFragment(source, 10);
        expect([...bySentence(fragment)]).toEqual([fragment]);
      });

      it.each(trailing.map((h) => [h]))("should not split on \"%s\"", (honorific) => {
        const source = `Len Pennington ${honorific} at your service.`;
        const fragment = createFragment(source, 10);
        expect([...bySentence(fragment)]).toEqual([fragment]);
      });
    });

    // This checks for things like "!?" or "...".
    describe("considering multiple punctuation", () => {
      it("should split on multiple punctuation", () => {
        const sections = chain()
          .concat("What are you doing!?")
          .concat("The core samples will get too hot!")
          .thru((sentences) => interweave(" ", sentences))
          .toArray();
        const fragment = createFragment(sections.join(""), 10);
        expect([...bySentence(fragment)]).toEqual(toExpectSeq(fragment, sections));
      });

      it("should not split on leading dramatic ellipses", () => {
        const source = "This is the end ...of everything."
        const fragment = createFragment(source, 10);
        expect([...bySentence(fragment)]).toEqual([fragment]);
      });

      // A known limitation.  The test is written as if it would be successful.
      it.failing("should FAIL by splitting on trailing dramatic ellipses", () => {
        // This is a bi-product of capturing things like "Huh!?" or "WTF!!!".
        // Perhaps with some pre-processing, we could convert "..." to "…" and
        // back again after we're done doing the split.
        const source = "This is the end... of everything."
        const fragment = createFragment(source, 10);
        expect([...bySentence(fragment)]).toEqual([fragment]);
      });
    });

    describe("considering quotations", () => {
      it("should include the single-quote (') after the punctuation", () => {
        const firstSentence = `She said, 'I was just testing it.'`;
        const secondSentence = "Then she put the contraption down.";

        const sections = chain([firstSentence, secondSentence])
          .thru((sentences) => interweave(" ", sentences))
          .toArray();

        const fragment = createFragment(sections.join(""), 10);
        expect([...bySentence(fragment)]).toEqual(toExpectSeq(fragment, sections));
      });

      it("should include the double-quote (\") after the punctuation", () => {
        const firstSentence = `She said, "I was just testing it."`;
        const secondSentence = "Then she put the contraption down.";

        const sections = chain([firstSentence, secondSentence])
          .thru((sentences) => interweave(" ", sentences))
          .toArray();

        const fragment = createFragment(sections.join(""), 10);
        expect([...bySentence(fragment)]).toEqual(toExpectSeq(fragment, sections));
      });

      // A known limitation.  The test is written as if it would be successful.
      it.failing("should FAIL by splitting sentences inside a sentence with quotation", () => {
        // This is arguable.  Are quoted-sentences part of the outer sentence
        // or are they sentences in their own right?  Well, either way, its
        // expensive to parse out.  But if they should belong to the outer
        // sentence, then we'd expect this to be in two sentences.
        const firstSentence = [
          `Taleir exclaims, "but the dog said,`,
          `'it's right over there!'`,
          `This doesn't make sense!"`
        ].join(" ");
        const secondSentence = "She pouts unhappily.";

        const sections = chain([firstSentence, secondSentence])
          .thru((sentences) => interweave(" ", sentences))
          .toArray();

        const fragment = createFragment(sections.join(""), 10);
        expect([...bySentence(fragment)]).toEqual(toExpectSeq(fragment, sections));
      });
    });
  });

  describe("Spanish cases", () => {
    testPhrases(phrasesSpanish);
  });

  describe("Japanese cases", () => {
    testPhrases(phrasesJapanese);
  });

  describe("Arabic cases", () => {
    testPhrases(phrasesArabic);
  });
});

describe("byWord", () => {
  const { createFragment, byWord } = textSplitter;

  it("should split into words and non-words", () => {
    const sections = ["This", " ", "is", " ", "a", " ", "test", "."];
    const fragment = createFragment(sections.join(""), 10);
    expect([...byWord(fragment)]).toEqual(toExpectSeq(fragment, sections))
  });

  it("should keep newlines as separate characters", () => {
    const sections = ["Foo", " ", "bar", "?", "\n", "\n", "Baz", " ", "qux", "."];
    const fragment = createFragment(sections.join(""), 10);
    expect([...byWord(fragment)]).toEqual(toExpectSeq(fragment, sections));
  });

  it("should bundle non-word characters (whitespace included)", () => {
    /**
     * This is more to document a GOTCHA.  Usually, these splitters
     * are used sequentially: split by newlines, then by sentences,
     * then by words.  However, the output that will be observed
     * in practice can differ from the output of using a splitter
     * in isolation.
     * 
     * Taking the phrase:
     * > Look out!! A gun!
     * 
     * Using the `byWord` splitter alone, you would get:
     */
    const sections = ["Look", " ", "out", "!! ", "A", " ", "gun", "!"];
    const fragment = createFragment(sections.join(""), 10);
    expect([...byWord(fragment)]).toEqual(toExpectSeq(fragment, sections));

    /**
     * But with the `token` trim-type in practice, it would first
     * be split by sentence:
     * `["Look out!!", " ", "A gun!"]`
     * 
     * Then each fragment is further split by word:
     * `[["Look", " ", "out", "!!"], [" "], ["A", " ", "gun", "!"]]`
     * 
     * And finally flattened into the final result:
     * `["Look", " ", "out", "!!", " ", "A", " ", "gun", "!"]`
     * 
     * The "!!" and " " end up separated.  This is probably not a big
     * deal for the most part, but it's something to be aware of.
     */
  });

  it("should treat contractions as a single word", () => {
    const sections = ["I'm", " ", "right", " ", "here", "."];
    const fragment = createFragment(sections.join(""), 10);
    expect([...byWord(fragment)]).toEqual(toExpectSeq(fragment, sections));
  });

  // A known limitation.  The test is written as if it would be successful.
  it.failing("should FAIL to treat the plural-possessive form as a single word", () => {
    // Unfortunately, the single-quote is also usable as....  a quote!
    // Like in: He said, "Did you really think that was a 'fun' time!?"
    // It's tricky to parse that out.
    const sections = ["It", " ", "is", " ", "the", " ", "eagles'", " ", "way", "."];
    const fragment = createFragment(sections.join(""), 10);
    expect([...byWord(fragment)]).toEqual(toExpectSeq(fragment, sections));
  });
});