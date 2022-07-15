import { describe, it, expect } from "@jest/globals";
import { beforeEach } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { getEmptyFrag } from "@spec/helpers-splitter";
import { insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { contiguousFrags, offsetFrags } from "@spec/helpers-assembly";

import { first } from "@utils/iterables";
import $ContentCursorOf from "../cursorOps/contentCursorOf";
import $SplitAt from "./splitAt";

import type { SpyInstance } from "jest-mock";
import type { IFragmentAssembly } from "../_interfaces";

type SplitResult = [IFragmentAssembly, IFragmentAssembly];

let spyContentCursorOf: SpyInstance<ReturnType<typeof $ContentCursorOf>["contentCursorOf"]>;
fakeRequire.inject($ContentCursorOf, (exports, jestFn) => {
  spyContentCursorOf = jestFn(exports.contentCursorOf);
  return Object.assign(exports, { contentCursorOf: spyContentCursorOf });
});

beforeEach(() => {
  spyContentCursorOf.mockReset();
});

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

      const result = splitAt(testData, cursor) as SplitResult;

      // Left of the cut.
      expect(result[0].prefix).toBe(offsetFrags.prefix);
      expect(result[0].content).toEqual(expect.any(Array));
      expect(result[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

      // Right of the cut.
      expect(result[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
      expect(result[1].content).toEqual(expect.any(Array));
      expect(result[1].suffix).toBe(offsetFrags.suffix);
    });
  });

  describe("concerning loose mode", () => {
    const testData = offsetFrags;

    it("should call `contentCursorOf` in loose mode when active", () => {
      const offset = beforeFrag(offsetFrags.content[2]);
      const cursor = testData.inFrag(offset);

      spyContentCursorOf.mockReturnValue(undefined);
      splitAt(testData, cursor, true);

      expect(spyContentCursorOf).toBeCalledWith(testData, cursor, true);
    });

    it("should call `contentCursorOf` in strict mode when inactive", () => {
      const offset = beforeFrag(offsetFrags.content[2]);
      const cursor = testData.inFrag(offset);

      spyContentCursorOf.mockReturnValue(undefined);
      splitAt(testData, cursor);

      expect(spyContentCursorOf).toBeCalledWith(testData, cursor, false);
    });
  });
});