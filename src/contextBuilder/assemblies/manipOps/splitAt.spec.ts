import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { getEmptyFrag } from "@spec/helpers-splitter";
import { insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { contiguousFrags, offsetFrags } from "@spec/helpers-assembly";

import { assertExists } from "@utils/assert";
import { first } from "@utils/iterables";
import $SplitAt from "./splitAt";

describe("splitSequenceAt", () => {
  const { splitAt } = $SplitAt(fakeRequire);

  describe("failure cases", () => {
    const testData = offsetFrags;

    it("should return `undefined` if cursor is unrelated", () => {
      const foreignData = contiguousFrags;
      
      const offset = insideFrag(first(contiguousFrags.content));
      const cursor = foreignData.inFrag(offset);
      const result = splitAt(testData, cursor);

      expect(result).toBeUndefined();
    });

    it("should return `undefined` if cursor is not within content block", () => {
      const offset = insideFrag(testData.prefix);
      const cursor = testData.inFrag(offset);
      const result = splitAt(testData, cursor);

      expect(result).toBeUndefined();
    });
  });

  describe("basic functionality", () => {
    const testData = offsetFrags;

    // Both `sequenceOps.splitAt` and `manipOps.getAffixForSplit` do the
    // heavy lifting here.  We're just going to check that it's splitting
    // the assembly correctly and not go into much detail.

    it("should be able to split the assembly correctly", () => {
      const sliceOffset = ("This is the").length;
      const slicedFrag = offsetFrags.content[2];
      const offset = beforeFrag(slicedFrag) + sliceOffset;
      const cursor = testData.inFrag(offset);

      const result = assertExists(
        "Expected a defined result.",
        splitAt(testData, cursor)
      );

      // Left of the cut.
      expect(result.assemblies[0].prefix).toBe(offsetFrags.prefix);
      expect(result.assemblies[0].content).toEqual(expect.any(Array));
      expect(result.assemblies[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

      // Right of the cut.
      expect(result.assemblies[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
      expect(result.assemblies[1].content).toEqual(expect.any(Array));
      expect(result.assemblies[1].suffix).toBe(offsetFrags.suffix);

      // The cursor ultimately used...  Which should be unchanged.
      expect(result.cursor).toBe(cursor);
    });
  });
});