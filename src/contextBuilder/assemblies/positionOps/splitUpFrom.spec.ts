import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockFragment, toFragmentSeq, toContent } from "@spec/helpers-splitter";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";
import { contiguousFrags } from "@spec/helpers-assembly";

import { first } from "@utils/iterables";
import $SplitUpFrom from "./splitUpFrom";

const { splitUpFrom } = $SplitUpFrom(fakeRequire);

describe("splitUpFrom", () => {
  const mergedData = generateData(0, {
    // We're going to use the same old text as a single fragment.
    content: [contiguousFrags.content.map(toContent).join("")]
  });

  describe("basic functionality", () => {
    // For these first tests, I'm only going to check the content.
    // The offsets are more or less already handled by the tests
    // for the trimming providers.

    it("should split into fragments of the desired granularity (newline)", () => {
      const cursor = mergedData.inFrag(0);
      const result = [...splitUpFrom(mergedData, cursor, "newline", "toBottom")];

      expect(result.map(toContent)).toEqual([
        "PREFIX", "\n",
        "This is the first fragment.",
        "\n",
        "This is the second fragment.  This is the third fragment.",
        "\n", "SUFFIX"
      ]);
    });

    it("should split into fragments of the desired granularity (sentence)", () => {
      const cursor = mergedData.inFrag(0);
      const result = [...splitUpFrom(mergedData, cursor, "sentence", "toBottom")];

      expect(result.map(toContent)).toEqual([
        "PREFIX", "\n",
        "This is the first fragment.",
        "\n",
        "This is the second fragment.",
        "  ",
        "This is the third fragment.",
        "\n", "SUFFIX"
      ]);
    });

    it("should split into fragments of the desired granularity (token)", () => {
      const cursor = mergedData.inFrag(0);
      const result = [...splitUpFrom(mergedData, cursor, "token", "toBottom")];

      // Only checking through into the second sentence here.
      const expected = [
        "PREFIX", "\n",
        "This", " ", "is", " ", "the", " ", "first", " ", "fragment", ".",
        "\n",
        "This", " ", "is", " ", "the", " ", "second", " ", "fragment", "."
      ];

      expect(result.map(toContent).slice(0, expected.length)).toEqual(expected);
    });

    // The above tests all checked the "from top to bottom" case.

    it("should iterate from bottom to top (IE: in reverse)", () => {
      const offset = afterFrag(mergedData.suffix);
      const cursor = mergedData.inFrag(offset);
      const result = [...splitUpFrom(mergedData, cursor, "sentence", "toTop")];

      // Lazily copy and pasted the above and added the `reverse` call.
      expect(result.map(toContent)).toEqual([
        "PREFIX", "\n",
        "This is the first fragment.",
        "\n",
        "This is the second fragment.",
        "  ",
        "This is the third fragment.",
        "\n", "SUFFIX"
      ].reverse());
    });
  });

  describe("when cursor is inside a fragment", () => {
    const expectedSplit = toFragmentSeq([
      "PREFIX", "\n",
      "This is the first fragment.", "\n",
      "This is the second fragment.", "  ",
      "This is the third fragment.", "\n",
      "SUFFIX"
    ], 0);

    // We're going to be starting at the "second fragment".
    const startOffset = insideFrag(expectedSplit[4]);

    it("should start at the fragment containing the cursor (to bottom)", () => {
      const cursor = mergedData.inFrag(startOffset);
      const result = [...splitUpFrom(mergedData, cursor, "sentence", "toBottom")];

      expect(result).toEqual(expectedSplit.slice(4));
    });

    it("should start at the fragment containing the cursor (to top)", () => {
      const cursor = mergedData.inFrag(startOffset);
      const result = [...splitUpFrom(mergedData, cursor, "sentence", "toTop")];

      expect(result).toEqual(expectedSplit.slice(0, 5).reverse());
    });
  });

  describe("when cursor at fragment boundary", () => {
    // We can use one of the standard assemblies for this one.
    // It's even already broken into sentence fragments.  How convenient!
    const splitData = contiguousFrags;

    // The best case would be that the same fragment instances are reused,
    // but that's not straight-forward to make happen.  Still, the
    // fragments should be identical, by their contents.

    it("should start at earliest fragment (to bottom)", () => {
      const offset = afterFrag(splitData.content[2]);
      const cursor = splitData.inFrag(offset);
      const result = [...splitUpFrom(splitData, cursor, "sentence", "toBottom")];

      expect(first(result)).toEqual(splitData.content[2]);
    });

    it("should start at latest fragment (to top)", () => {
      const offset = beforeFrag(splitData.content[2]);
      const cursor = splitData.inFrag(offset);
      const result = [...splitUpFrom(splitData, cursor, "sentence", "toTop")];

      // Still `first`, because this iterates in reverse.
      expect(first(result)).toEqual(splitData.content[2]);
    });
  });

  // This is a limitation of this function to be aware of.  I don't
  // believe this capability will be needed, as we're not going to be
  // splitting fragments all that haphazardly.  And if we do, it
  // might be that we should have a method to defragment an assembly
  // and yield a new assembly, rather than complicate this method
  // with implicit defragmenting.
  it.failing("should FAIL to defragment when it could be done", () => {
    const testData = generateData(0, {
      ...NO_AFFIX,
      content: [
        "This is the start ",
        "of something beautiful!"
      ]
    });

    const cursor = testData.inFrag(0);
    const result = [...splitUpFrom(testData, cursor, "sentence", "toBottom")];

    expect(result).toEqual([
      mockFragment("This is the start of something beautiful!", 0)
    ]);
  });
});