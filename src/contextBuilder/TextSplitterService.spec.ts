import { describe, it, expect } from "@jest/globals";
import quickString from "@spec/quick";
import { collection as phrasesEnglish } from "@spec/phrases-english";
import { collection as phrasesSpanish } from "@spec/phrases-spanish";
import { collection as phrasesJapanese } from "@spec/phrases-japanese";
import { collection as phrasesArabic } from "@spec/phrases-arabic";
import * as helpers from "@spec/helpers-splitter";

import { chain, interweave } from "@utils/iterables";
import $TextSplitterService from "./TextSplitterService";
import AppConstants from "@nai/AppConstants";

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

// We'll be using these a lot.
const { mockFragment, toExpectSeq } = helpers;

// But we still need to test the real-deal.
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
  const { asFragment } = textSplitter;

  const existingFrag = mockFragment("I'm an existing fragment.", 100);

  it("should convert strings to fragments with 0 offset", () => {
    expect(asFragment(quickString)).toEqual({ content: quickString, offset: 0 });
  });

  it("should return the same instance for fragments", () => {
    expect(asFragment(existingFrag)).toBe(existingFrag);
  });
});

describe("asContent", () => {
  const { asContent } = textSplitter;

  const testStr = "Test String";
  const testFrag = mockFragment("Test Fragment", 10);

  it("should work with strings", () => {
    expect(asContent(testStr)).toBe(testStr);
  });

  it("should work with fragments", () => {
    expect(asContent(testFrag)).toBe(testFrag.content);
  });
});

describe("isContiguous", () => {
  const { isContiguous } = textSplitter;

  const inOrder = [
    mockFragment("1", 11),
    mockFragment("2", 12),
    mockFragment("3", 13)
  ];

  const outOfOrder = [
    mockFragment("2", 12),
    mockFragment("1", 11),
    mockFragment("3", 13)
  ];

  const withGaps = [
    mockFragment("1", 11),
    mockFragment("2", 12),
    mockFragment("4", 14),
    mockFragment("5", 15)
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
  const { splitFragmentAt } = textSplitter;

  const theFragment = mockFragment(quickString, 20);

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
  const { byLine } = textSplitter;

  const manyLines = mockFragment("First\nSecond\nThird", 10);
  const manyEmptyLines = mockFragment("First\n\nSecond\n\n\nThird", 10);
  const singleLine = mockFragment(quickString, 10);

  it("should split into a sequence of newline characters and text", () => {
    expect([...byLine(manyLines)]).toEqual([
      mockFragment("First", 10),
      mockFragment("\n", 15),
      mockFragment("Second", 16),
      mockFragment("\n", 22),
      mockFragment("Third", 23)
    ]);
  });

  it("should work when there's multiple newlines in a row", () => {
    expect([...byLine(manyEmptyLines)]).toEqual([
      mockFragment("First", 10),
      mockFragment("\n", 15),
      mockFragment("\n", 16),
      mockFragment("Second", 17),
      mockFragment("\n", 23),
      mockFragment("\n", 24),
      mockFragment("\n", 25),
      mockFragment("Third", 26)
    ]);
  });

  it("should not split if there's no newline", () => {
    expect([...byLine(singleLine)]).toEqual([singleLine]);
  });
});

describe("byLineFromEnd", () => {
  const { byLineFromEnd } = textSplitter;

  describe("with lines shorter than the chunk size", () => {
    const shortLines = mockFragment("First\nSecond\nThird", 10);
    const shortEmptyLines = mockFragment("First\n\nSecond\n\n\nThird", 10);

    it("should split into a reversed sequence of newline characters and text", () => {
      expect([...byLineFromEnd(shortLines)]).toEqual([
        mockFragment("First", 10),
        mockFragment("\n", 15),
        mockFragment("Second", 16),
        mockFragment("\n", 22),
        mockFragment("Third", 23)
      ].reverse());
    });

    it("should work when there's multiple newlines in a row", () => {
      expect([...byLineFromEnd(shortEmptyLines)]).toEqual([
        mockFragment("First", 10),
        mockFragment("\n", 15),
        mockFragment("\n", 16),
        mockFragment("Second", 17),
        mockFragment("\n", 23),
        mockFragment("\n", 24),
        mockFragment("\n", 25),
        mockFragment("Third", 26)
      ].reverse());
    });
  });

  describe("with lines longer than the chunk size", () => {
    const longLines = mockFragment("First\nSecond & Third\nFourth & Fifth", 10);
    const longEmptyLines = mockFragment("First\n\nSecond & Third\n\n\nFourth & Fifth", 10);

    it("should split into a reversed sequence of newline characters and text", () => {
      expect([...byLineFromEnd(longLines)]).toEqual([
        mockFragment("First", 10),
        mockFragment("\n", 15),
        mockFragment("Second & Third", 16),
        mockFragment("\n", 30),
        mockFragment("Fourth & Fifth", 31)
      ].reverse());
    });

    it("should work when there's multiple newlines in a row", () => {
      expect([...byLineFromEnd(longEmptyLines)]).toEqual([
        mockFragment("First", 10),
        mockFragment("\n", 15),
        mockFragment("\n", 16),
        mockFragment("Second & Third", 17),
        mockFragment("\n", 31),
        mockFragment("\n", 32),
        mockFragment("\n", 33),
        mockFragment("Fourth & Fifth", 34)
      ].reverse());
    });
  });

  describe("with a single line", () => {
    const singleLine = mockFragment(quickString, 10);

    it("should not split", () => {
      expect([...byLineFromEnd(singleLine)]).toEqual([singleLine]);
    });
  });
});

describe("bySentence", () => {
  const { bySentence } = textSplitter;

  const testPhrases = (collection: readonly string[]) => {
    describe("with a single line", () => {
      const theSentences = helpers.forSingleLine(collection);

      const assembled = chain(theSentences)
        .thru((sentences) => interweave(" ", sentences))
        .toArray();

      const singleLine = mockFragment(assembled.join(""), 10);

      it("should split into sentences and the whitespace between them", () => {
        expect([...bySentence(singleLine)]).toEqual(toExpectSeq(singleLine, assembled));
      });
    });

    describe("with a multiple lines", () => {
      const theLines = helpers.forManyLines(collection);

      const assembled = chain(theLines)
        .map((sentences) => interweave(" ", sentences))
        .thru((lines) => interweave("\n", lines))
        .flatten()
        .toArray();
      
      const manyLines = mockFragment(assembled.join(""), 10);

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
        const fragment = mockFragment(source, 10);
        expect([...bySentence(fragment)]).toEqual([fragment]);
      });

      it.each(trailing.map((h) => [h]))("should not split on \"%s\"", (honorific) => {
        const source = `Len Pennington ${honorific} at your service.`;
        const fragment = mockFragment(source, 10);
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
        const fragment = mockFragment(sections.join(""), 10);
        expect([...bySentence(fragment)]).toEqual(toExpectSeq(fragment, sections));
      });

      it("should not split on leading dramatic ellipses", () => {
        const source = "This is the end ...of everything."
        const fragment = mockFragment(source, 10);
        expect([...bySentence(fragment)]).toEqual([fragment]);
      });

      // A known limitation.  The test is written as if it would be successful.
      it.failing("should FAIL by splitting on trailing dramatic ellipses", () => {
        // This is a bi-product of capturing things like "Huh!?" or "WTF!!!".
        // Perhaps with some pre-processing, we could convert "..." to "…" and
        // back again after we're done doing the split.
        const source = "This is the end... of everything."
        const fragment = mockFragment(source, 10);
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

        const fragment = mockFragment(sections.join(""), 10);
        expect([...bySentence(fragment)]).toEqual(toExpectSeq(fragment, sections));
      });

      it("should include the double-quote (\") after the punctuation", () => {
        const firstSentence = `She said, "I was just testing it."`;
        const secondSentence = "Then she put the contraption down.";

        const sections = chain([firstSentence, secondSentence])
          .thru((sentences) => interweave(" ", sentences))
          .toArray();

        const fragment = mockFragment(sections.join(""), 10);
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

        const fragment = mockFragment(sections.join(""), 10);
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
  const { byWord } = textSplitter;

  it("should split into words and non-words", () => {
    const sections = ["This", " ", "is", " ", "a", " ", "test", "."];
    const fragment = mockFragment(sections.join(""), 10);
    expect([...byWord(fragment)]).toEqual(toExpectSeq(fragment, sections))
  });

  it("should keep newlines as separate characters", () => {
    const sections = ["Foo", " ", "bar", "?", "\n", "\n", "Baz", " ", "qux", "."];
    const fragment = mockFragment(sections.join(""), 10);
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
    const fragment = mockFragment(sections.join(""), 10);
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
    const fragment = mockFragment(sections.join(""), 10);
    expect([...byWord(fragment)]).toEqual(toExpectSeq(fragment, sections));
  });

  // A known limitation.  The test is written as if it would be successful.
  it.failing("should FAIL to treat the plural-possessive form as a single word", () => {
    // Unfortunately, the single-quote is also usable as....  a quote!
    // Like in: He said, "Did you really think that was a 'fun' time!?"
    // It's tricky to parse that out.
    const sections = ["It", " ", "is", " ", "the", " ", "eagles'", " ", "way", "."];
    const fragment = mockFragment(sections.join(""), 10);
    expect([...byWord(fragment)]).toEqual(toExpectSeq(fragment, sections));
  });
});