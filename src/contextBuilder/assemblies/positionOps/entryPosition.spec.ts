import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { afterFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData } from "@spec/helpers-assembly";

import { first, last } from "@utils/iterables";
import $EntryPosition from "./entryPosition";

const { entryPosition } = $EntryPosition(fakeRequire);

describe("entryPosition", () => {
  const NP = { prefix: "" };
  const NS = { suffix: "" };
  const NC = { content: [] };

  const theData = {
    base: generateData(3),
    noPrefix: generateData(3, NP),
    onlyPrefix: generateData(3, { ...NC, ...NS }),
    noSuffix: generateData(3, NS),
    onlySuffix: generateData(3, { ...NP, ...NC }),
    empty: generateData(3, { ...NP, ...NC, ...NS })
  };

  describe("for `toBottom`", () => {
    describe("without an insertion type", () => {
      it("should enter before prefix when it is non-empty", () => {
        const testData = theData.base;
        const result = entryPosition(testData, "toBottom");

        expect(result).toEqual(
          theData.base.inFrag(beforeFrag(testData.prefix))
        );
      });

      it("should enter before first content fragment when prefix is empty", () => {
        const testData = theData.noPrefix;
        const result = entryPosition(testData, "toBottom");

        expect(result).toEqual(
          theData.noPrefix.inFrag(beforeFrag(first(testData.content)))
        );
      });

      it("should enter before suffix otherwise", () => {
        const testData = theData.onlySuffix;
        const result = entryPosition(testData, "toBottom");

        expect(result).toEqual(
          theData.onlySuffix.inFrag(beforeFrag(testData.suffix))
        );
      });

      it("should work with empty assemblies", () => {
        const result = entryPosition(theData.empty, "toBottom");

        expect(result).toEqual(
          theData.empty.inFrag(beforeFrag(theData.empty.suffix))
        );
      });
    });

    describe("with an insertion type", () => {
      it("should enter before prefix when it is non-empty", () => {
        const testData = theData.base;
        const result = entryPosition(testData, "toBottom", "sentence");

        expect(result).toEqual(
          theData.base.inFrag(beforeFrag(testData.prefix))
        );
      });

      it("should enter before first content when prefix is empty", () => {
        const testData = theData.noPrefix;
        const result = entryPosition(testData, "toBottom", "sentence");

        expect(result).toEqual(
          theData.noPrefix.inFrag(beforeFrag(first(testData.content)))
        );
      });

      it("should enter before suffix otherwise", () => {
        const testData = theData.onlySuffix;
        const result = entryPosition(testData, "toBottom", "sentence");

        expect(result).toEqual(
          // Accounting for the `\n` before it.
          theData.onlySuffix.inFrag(beforeFrag(testData.suffix) + 1)
        );
      });

      it("should return same as without insertion type for empty assemblies", () => {
        const expected = entryPosition(theData.empty, "toBottom");
        const result = entryPosition(theData.empty, "toBottom", "sentence");

        expect(result).toEqual(expected);
      });
    });
  });

  describe("for `toTop`", () => {
    describe("without an insertion type", () => {
      it("should enter after suffix when it is non-empty", () => {
        const testData = theData.base;
        const result = entryPosition(testData, "toTop");

        expect(result).toEqual(
          theData.base.inFrag(afterFrag(testData.suffix))
        );
      });

      it("should enter after last content fragment when suffix is empty", () => {
        const testData = theData.noSuffix;
        const result = entryPosition(testData, "toTop");

        expect(result).toEqual(
          theData.noSuffix.inFrag(afterFrag(last(testData.content)))
        );
      });

      it("should enter after prefix otherwise", () => {
        const testData = theData.onlyPrefix;
        const result = entryPosition(testData, "toTop");

        expect(result).toEqual(
          theData.onlyPrefix.inFrag(afterFrag(testData.prefix))
        );
      });

      it("should work with empty assemblies", () => {
        const result = entryPosition(theData.empty, "toTop");

        expect(result).toEqual(
          theData.empty.inFrag(afterFrag(theData.empty.prefix))
        );
      });
    });

    describe("with an insertion type", () => {
      it("should enter before suffix when it is non-empty", () => {
        const testData = theData.base;
        const result = entryPosition(testData, "toTop", "sentence");

        expect(result).toEqual(
          // Accounting for the `\n` before it.
          theData.base.inFrag(beforeFrag(testData.suffix) + 1)
        );
      });

      it("should enter before last position in content when suffix is empty", () => {
        const testData = theData.noSuffix;
        const result = entryPosition(testData, "toTop", "sentence");

        expect(result).toEqual(
          theData.noSuffix.inFrag(beforeFrag(last(testData.content)))
        );
      });

      it("should enter before prefix otherwise", () => {
        const testData = theData.onlyPrefix;
        const result = entryPosition(testData, "toTop", "sentence");

        expect(result).toEqual(
          theData.onlyPrefix.inFrag(beforeFrag(testData.prefix))
        );
      });

      it("should return same as without insertion type for empty assemblies", () => {
        const expected = entryPosition(theData.empty, "toTop");
        const result = entryPosition(theData.empty, "toTop", "sentence");

        expect(result).toEqual(expected);
      });
    });
  });
});