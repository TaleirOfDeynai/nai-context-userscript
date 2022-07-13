import { describe, it, expect } from "@jest/globals";
import { beforeEach } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { offsetFrags } from "@spec/helpers-assembly";

import $FindBest from "./findBest";
import $IsFoundIn from "./isFoundIn";
import $ContentCursorOf from "./contentCursorOf";

import type { SpyInstance } from "jest-mock";

let spyFindBest: SpyInstance<ReturnType<typeof $FindBest>["findBest"]>;
fakeRequire.inject($FindBest, (exports, jestFn) => {
  spyFindBest = jestFn(exports.findBest);
  return Object.assign(exports, { findBest: spyFindBest });
});

let spyIsFoundIn: SpyInstance<ReturnType<typeof $IsFoundIn>["isFoundIn"]>;
fakeRequire.inject($IsFoundIn, (exports, jestFn) => {
  spyIsFoundIn = jestFn(exports.isFoundIn);
  return Object.assign(exports, { isFoundIn: spyIsFoundIn });
});

beforeEach(() => {
  spyFindBest.mockReset();
  spyIsFoundIn.mockReset();
});

const { contentCursorOf } = $ContentCursorOf(fakeRequire);

describe("contentCursorOf", () => {
  const testData = offsetFrags;

  const contentCursor = testData.inFrag(beforeFrag(testData.content[2]));
  const prefixCursor = testData.inFrag(insideFrag(testData.prefix));

  describe("strict mode", () => {
    it("should use the given cursor if it is for the content", () => {
      const result = contentCursorOf(testData, contentCursor);
      expect(result).toBe(contentCursor);
    });

    it("should return `undefined` if the cursor is not for the content", () => {
      const result = contentCursorOf(testData, prefixCursor);
      expect(result).toBeUndefined();
    });

    it("should return `undefined` if the cursor's fragment is not found", () => {
      spyIsFoundIn.mockReturnValue(false);

      const result = contentCursorOf(testData, contentCursor);
      expect(result).toBeUndefined();
    });
  });

  describe("loose mode", () => {
    it("should use the given cursor if it is for the content", () => {
      const result = contentCursorOf(testData, contentCursor, true);
      expect(result).toBe(contentCursor);
    });

    it("should return `undefined` if the cursor is not for the content", () => {
      const result = contentCursorOf(testData, prefixCursor, true);
      expect(result).toBeUndefined();
    });

    it("should try to find a better cursor if the cursor's fragment is not found", () => {
      const altCursor = testData.inFrag(beforeFrag(testData.content[4]));
      spyIsFoundIn.mockReturnValue(false);
      spyFindBest.mockReturnValue(altCursor);

      const result = contentCursorOf(testData, contentCursor, true);
      expect(result).toBe(altCursor);
    });

    it("should not use the best cursor if it is outside the content block", () => {
      spyIsFoundIn.mockReturnValue(false);
      spyFindBest.mockReturnValue(prefixCursor);

      const result = contentCursorOf(testData, contentCursor, true);
      expect(result).toBeUndefined();
    });
  });
});