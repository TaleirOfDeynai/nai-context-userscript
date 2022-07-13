import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { getEmptyFrag } from "@spec/helpers-splitter";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { offsetFrags } from "@spec/helpers-assembly";

import { first, last } from "@utils/iterables";
import $IsFoundIn from "./isFoundIn";
import $FindBest from "./findBest";

import type { AssemblyData } from "@spec/helpers-assembly";
import type { TextFragment } from "../../TextSplitterService";

const { findBest } = $FindBest(fakeRequire);
const { isFoundIn } = $IsFoundIn(fakeRequire);

describe("findBest", () => {
  // This always repositions to the nearest existing fragment,
  // regardless of any pattern in its ordering.  The assembly
  // won't consider where missing content would be located if
  // they were present.

  const runCommonTests = (
    testData: AssemblyData,
    minContent: TextFragment,
    maxContent: TextFragment
  ) => {
    it("should return the same cursor instance when found", () => {
      const offset = insideFrag(minContent);
      const cursor = testData.inFrag(offset);
      const result = findBest(testData, cursor);

      expect(result).toBe(cursor);
    });

    it("should be able to position to prefix if closest", () => {
      const afterPrefix = afterFrag(testData.prefix);

      const offset = afterPrefix + 1;
      const cursor = testData.inFrag(offset);
      const result = findBest(testData, cursor);

      expect(result).toEqual(testData.inFrag(afterPrefix));
    });

    it("should be able to position to suffix if closest", () => {
      const beforeSuffix = beforeFrag(testData.suffix);

      const offset = beforeSuffix - 1;
      const cursor = testData.inFrag(offset);
      const result = findBest(testData, cursor);

      expect(result).toEqual(testData.inFrag(beforeSuffix));
    });

    it("should reposition to nearest content when possible (near prefix)", () => {
      const expectedOffset = beforeFrag(minContent);

      const offset = afterFrag(testData.prefix) + 2;
      const cursor = testData.inFrag(offset);
      const result = findBest(testData, cursor);

      expect(result).toEqual(testData.inFrag(expectedOffset));
    });

    it("should reposition to nearest content when possible (near suffix)", () => {
      const expectedOffset = afterFrag(maxContent);

      const offset = beforeFrag(testData.suffix) - 2;
      const cursor = testData.inFrag(offset);
      const result = findBest(testData, cursor);

      expect(result).toEqual(testData.inFrag(expectedOffset));
    });
  };

  describe("when fully contiguous", () => {
    runCommonTests(
      { ...offsetFrags, isContiguous: true },
      offsetFrags.content[0],
      offsetFrags.content[4]
    );
  });

  describe("when in order but with gap", () => {
    const testData = {
      ...offsetFrags,
      content: [
        offsetFrags.content[0],
        offsetFrags.content[1],
        offsetFrags.content[4]
      ],
      isContiguous: false
    };

    runCommonTests(
      testData,
      offsetFrags.content[0],
      offsetFrags.content[4]
    );

    it("should reposition to nearest fragment when possible (in content gap)", () => {
      const expectedOffset = afterFrag(offsetFrags.content[1]);

      const offset = insideFrag(offsetFrags.content[2]);
      const cursor = testData.inFrag(offset);
      const result = findBest(testData, cursor);

      expect(result).toEqual(testData.inFrag(expectedOffset));
    });
  });

  describe("when out of order and with gap", () => {
    const testData = {
      ...offsetFrags,
      content: [
        offsetFrags.content[4],
        offsetFrags.content[3],
        offsetFrags.content[0]
      ],
      isContiguous: false
    };

    runCommonTests(
      testData,
      offsetFrags.content[0],
      offsetFrags.content[4]
    );

    it("should reposition to nearest fragment when possible (in content gap)", () => {
      const expectedOffset = beforeFrag(offsetFrags.content[3]);

      const offset = insideFrag(offsetFrags.content[2]);
      const cursor = testData.inFrag(offset);
      const result = findBest(testData, cursor);

      expect(result).toEqual(testData.inFrag(expectedOffset));
    });
  });

  describe("when preferring content", () => {
    // Normally, it will try to find any fragment, including the
    // prefix and suffix.  However, when told to prefer the
    // content fragments, it will always try to locate the next
    // nearest position adjacent to a content fragment.

    // It will even take a prefix/suffix cursor and try to locate
    // an appropriate content fragment, even if the cursor's
    // fragment exists.

    describe("concerning the prefix", () => {
      it("should move a prefix cursor to the start of content", () => {
        const offset = insideFrag(offsetFrags.prefix);
        const cursor = offsetFrags.inFrag(offset);
        const result = findBest(offsetFrags, cursor, true);

        expect(result.offset).toBe(beforeFrag(first(offsetFrags.content)));
      });

      it("should favor content even when prefix is closer in gap", () => {
        const offset = afterFrag(offsetFrags.prefix) + 1;
        const cursor = offsetFrags.inFrag(offset);
        const result = findBest(offsetFrags, cursor, true);

        expect(result.offset).toBe(beforeFrag(first(offsetFrags.content)));
      });

      it("should favor prefix when content is empty", () => {
        const testData = { ...offsetFrags, content: [] };

        const offset = insideFrag(first(offsetFrags.content));
        const cursor = testData.inFrag(offset);
        const result = findBest(testData, cursor, true);

        expect(result.offset).toBe(afterFrag(offsetFrags.prefix));
      });

      it("should use the source's prefix when content is empty", () => {
        const sourceData = offsetFrags;
        const childData = {
          ...offsetFrags,
          content: [],
          prefix: getEmptyFrag(offsetFrags.prefix),
          source: sourceData
        };

        const offset = afterFrag(offsetFrags.prefix);
        const cursor = sourceData.inFrag(offset);

        // Sanity check the cursor; will we do a shift?
        expect(isFoundIn(childData, cursor)).toBe(false);

        const result = findBest(childData, cursor, true);

        expect(result.offset).toBe(afterFrag(sourceData.prefix));
        expect(result.offset).not.toBe(afterFrag(childData.prefix));
      });
    });

    describe("concerning the suffix", () => {
      it("should move a suffix cursor to the end of content", () => {
        const offset = insideFrag(offsetFrags.suffix);
        const cursor = offsetFrags.inFrag(offset);
        const result = findBest(offsetFrags, cursor, true);

        expect(result.offset).toBe(afterFrag(last(offsetFrags.content)));
      });

      it("should favor content even when suffix is closer in gap", () => {
        const offset = beforeFrag(offsetFrags.suffix) - 1;
        const cursor = offsetFrags.inFrag(offset);
        const result = findBest(offsetFrags, cursor, true);

        expect(result.offset).toBe(afterFrag(last(offsetFrags.content)));
      });

      it("should favor suffix when content is empty", () => {
        const testData = { ...offsetFrags, content: [] };

        const offset = insideFrag(last(offsetFrags.content));
        const cursor = testData.inFrag(offset);
        const result = findBest(testData, cursor, true);

        expect(result.offset).toBe(beforeFrag(offsetFrags.suffix));
      });

      it("should use the source's suffix when content is empty", () => {
        const sourceData = offsetFrags;
        const childData = {
          ...sourceData,
          content: [],
          suffix: getEmptyFrag(sourceData.suffix),
          source: sourceData
        };

        const offset = afterFrag(sourceData.suffix);
        const cursor = sourceData.inFrag(offset);

        // Sanity check the cursor; will we do a shift?
        expect(isFoundIn(childData, cursor)).toBe(false);

        const result = findBest(childData, cursor, true);

        expect(result.offset).toBe(afterFrag(sourceData.suffix));
        expect(result.offset).not.toBe(afterFrag(childData.suffix));
      });
    });
  });
});