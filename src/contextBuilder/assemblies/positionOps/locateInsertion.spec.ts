import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { toFragmentSeq, toContent, mockFragment } from "@spec/helpers-splitter";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";

import { dew } from "@utils/dew";
import { first, last, iterReverse, scan } from "@utils/iterables";
import $EntryPosition from "./entryPosition";
import $LocateInsertion from "./locateInsertion";

import type { AssemblyData } from "@spec/helpers-assembly";
import type { InsertionPosition, Position } from "./locateInsertion";

const { entryPosition } = $EntryPosition(fakeRequire);
const { locateInsertion } = $LocateInsertion(fakeRequire);

describe("locateInsertion", () => {
  // Most of the heavy lifting is done by `splitToSelections`, which
  // is already tested.  Since this is more about what this method
  // does with the fragments it gets back from `splitToSelections`,
  // we're just going to use simulated fragments and test its own
  // internal behavior.

  const mockPosition = (
    cursor: InsertionPosition["cursor"],
    direction: InsertionPosition["direction"],
    offset: InsertionPosition["offset"]
  ): InsertionPosition => ({ cursor, direction, offset });

  const simulated = dew(() => {
    const rawFrags = toFragmentSeq([
      "PREFIX", "\n",
      "Fragment 1.", "\n",
      "Fragment 2.", " ",
      "Fragment 3.", "\n",
      "Fragment 4.", "\n",
      "Fragment 5.", " ",
      "Fragment 6.", " ",
      "Fragment 7.",
      "\n", "SUFFIX"
    ], 0);

    const prefixFrags = rawFrags.slice(0, 2);
    const suffixFrags = rawFrags.slice(-2);
    const contentFrags = rawFrags.slice(2, -2);

    const data = generateData(0, {
      prefix: prefixFrags.map(toContent).join(""),
      content: [contentFrags.map(toContent).join("")],
      suffix: suffixFrags.map(toContent).join("")
    });

    /** To help with test understandability. */
    const fragFor = (pattern: "PREFIX" | "SUFFIX" | `Fragment ${number}`) => {
      switch (pattern) {
        case "PREFIX": return rawFrags[0];
        case "SUFFIX": return rawFrags[rawFrags.length - 1];
        default: {
          const index = rawFrags.findIndex((f) => f.content.startsWith(pattern));
          return rawFrags[index];
        }
      }
    };

    return {
      rawFrags,
      prefixFrags, contentFrags, suffixFrags,
      fragFor,
      data
    };
  });

  // Just to make sure that the simulated data is what we expect.
  describe("sanity checks for simulated data", () => {
    it("should have correct prefix", () => {
      expect(simulated.data.prefix).toEqual({
        content: simulated.prefixFrags.map(toContent).join(""),
        offset: first(simulated.prefixFrags)?.offset
      });
    });

    it("should have correct suffix", () => {
      expect(simulated.data.suffix).toEqual({
        content: simulated.suffixFrags.map(toContent).join(""),
        offset: first(simulated.suffixFrags)?.offset
      });
    });

    it("should have correct content", () => {
      expect(simulated.data.content).toEqual([{
        content: simulated.contentFrags.map(toContent).join(""),
        offset: first(simulated.contentFrags)?.offset
      }]);
    });
  });

  describe("basic functionality", () => {
    const testData = simulated.data;

    // In NovelAI, this would be `insertionPosition === 0`.
    describe("with offset of 0 (to bottom)", () => {
      it("should return the same result cursor", () => {
        const offset = insideFrag(simulated.fragFor("Fragment 4"));
        const cursor = testData.inFrag(offset);
        const position = mockPosition(cursor, "toBottom", 0);
        const result = locateInsertion(testData, "sentence", position);

        expect(result).toEqual({ type: "inside", cursor });
      });
    });

    // In NovelAI, this would be `insertionPosition === -1`.
    describe("with offset of 0 (to top)", () => {
      it("should return the same result cursor", () => {
        const offset = insideFrag(simulated.fragFor("Fragment 4"));
        const cursor = testData.inFrag(offset);
        const position = mockPosition(cursor, "toTop", 0);
        const result = locateInsertion(testData, "sentence", position);

        expect(result).toEqual({ type: "inside", cursor });
      });
    });

    // In NovelAI, this would be `insertionPosition === 1`.
    describe("with offset of 1 (to bottom)", () => {
      it("should position result cursor at start of next fragment", () => {
        const offset = insideFrag(simulated.fragFor("Fragment 4"));
        const cursor = testData.inFrag(offset);
        const position = mockPosition(cursor, "toBottom", 1);
        const result = locateInsertion(testData, "sentence", position);

        expect(result).toEqual({
          type: "inside",
          cursor: testData.inFrag(beforeFrag(simulated.fragFor("Fragment 5")))
        });
      });

      it("should work with input cursor at the start of the fragment", () => {
        const offset = beforeFrag(simulated.fragFor("Fragment 4"));
        const cursor = testData.inFrag(offset);
        const position = mockPosition(cursor, "toBottom", 1);
        const result = locateInsertion(testData, "sentence", position);

        expect(result).toEqual({
          type: "inside",
          cursor: testData.inFrag(beforeFrag(simulated.fragFor("Fragment 5")))
        });
      });
    });

    // In NovelAI, this would be `insertionPosition === -2`.
    describe("with offset of 1 (to top)", () => {
      it("should position result cursor at start of fragment", () => {
        const offset = insideFrag(simulated.fragFor("Fragment 4"));
        const cursor = testData.inFrag(offset);
        const position = mockPosition(cursor, "toTop", 1);
        const result = locateInsertion(testData, "sentence", position);

        expect(result).toEqual({
          type: "inside",
          cursor: testData.inFrag(beforeFrag(simulated.fragFor("Fragment 4")))
        });
      });

      it("should work with input cursor at the start of the fragment", () => {
        const offset = beforeFrag(simulated.fragFor("Fragment 4"));
        const cursor = testData.inFrag(offset);
        const position = mockPosition(cursor, "toTop", 1);
        const result = locateInsertion(testData, "sentence", position);

        expect(result).toEqual({
          type: "inside",
          cursor: testData.inFrag(beforeFrag(simulated.fragFor("Fragment 3")))
        });
      });
    });

    describe("with offsets greater than 1", () => {
      it("should position result cursor (to bottom)", () => {
        const offset = insideFrag(simulated.fragFor("Fragment 4"));
        const cursor = testData.inFrag(offset);
        const position = mockPosition(cursor, "toBottom", 3);
        const result = locateInsertion(testData, "sentence", position);

        expect(result).toEqual({
          type: "inside",
          cursor: testData.inFrag(beforeFrag(simulated.fragFor("Fragment 7")))
        });
      });

      it("should position result cursor (to top)", () => {
        const offset = insideFrag(simulated.fragFor("Fragment 4"));
        const cursor = testData.inFrag(offset);
        const position = mockPosition(cursor, "toTop", 3);
        const result = locateInsertion(testData, "sentence", position);

        expect(result).toEqual({
          type: "inside",
          cursor: testData.inFrag(beforeFrag(simulated.fragFor("Fragment 2")))
        });
      });
    });
  });

  // A unique situation that can come up with the `newline` insertion type.
  describe("unusual circumstance: multiple newlines", () => {
    const rawFrags = toFragmentSeq([
      "Fragment 1.", "  ", "Fragment 2.",
      "\n", "\n",
      "Fragment 3.", "  ", "Fragment 4."
    ], 0);

    const testData = generateData(0, {
      ...NO_AFFIX,
      content: [rawFrags.map(toContent).join("")]
    });

    it("should position cursor between two empty newline characters (to bottom)", () => {
      const offset = beforeFrag(first(rawFrags));
      const cursor = testData.inFrag(offset);
      const position = mockPosition(cursor, "toBottom", 2);
      const result = locateInsertion(testData, "sentence", position);

      expect(result).toEqual({
        type: "inside",
        // After the first "\n" and before the second "\n".
        cursor: testData.inFrag(beforeFrag(rawFrags[4]))
      });
    });

    it("should position cursor between two empty newline characters (to top)", () => {
      const offset = afterFrag(last(rawFrags));
      const cursor = testData.inFrag(offset);
      const position = mockPosition(cursor, "toTop", 3);
      const result = locateInsertion(testData, "sentence", position);

      expect(result).toEqual({
        type: "inside",
        // After the first "\n" and before the second "\n".
        cursor: testData.inFrag(beforeFrag(rawFrags[4]))
      });
    });
  });

  describe("unusual circumstance: empty assembly", () => {
    const testData = generateData(0, { ...NO_AFFIX, content: [] });

    const getResult = (dir: "toTop" | "toBottom", offset: number) => {
      const cursor = testData.inFrag(0);
      const position = mockPosition(cursor, dir, offset);
      return locateInsertion(testData, "sentence", position);
    };

    it("should return the original offset as the remainder", () => {
      expect(getResult("toBottom", 3)).toEqual({ type: "toBottom", remainder: 3 });
      expect(getResult("toBottom", 0)).toEqual({ type: "toBottom", remainder: 0 });
      expect(getResult("toTop", 3)).toEqual({ type: "toTop", remainder: 3 });
      expect(getResult("toTop", 0)).toEqual({ type: "toTop", remainder: 0 });
    });
  });

  // These next two might change in the future.  I'm torn on exactly
  // how they should work.  For now, this is likely fine.

  describe("when it would try to place result cursor inside prefix", () => {
    const testData = simulated.data;

    it("should indicate `insertBefore`", () => {
      const offset = insideFrag(simulated.fragFor("Fragment 2"));
      const cursor = testData.inFrag(offset);
      const position = mockPosition(cursor, "toTop", 3);
      const result = locateInsertion(testData, "sentence", position);

      expect(result).toEqual({
        type: "insertBefore",
        shunted: 0
      });
    });
  });

  describe("when it would try to place result cursor inside suffix", () => {
    const testData = simulated.data;

    it("should indicate `insertAfter`", () => {
      const offset = insideFrag(simulated.fragFor("Fragment 6"));
      const cursor = testData.inFrag(offset);
      const position = mockPosition(cursor, "toBottom", 2);
      const result = locateInsertion(testData, "sentence", position);

      expect(result).toEqual({
        type: "insertAfter",
        // Shunted from the start of "SUFFIX" to the end.
        shunted: simulated.fragFor("SUFFIX").content.length
      });
    });
  });

  describe("when the offset goes beyond the bounds of the assembly", () => {
    const testData = simulated.data;

    it("should indicate the same direction with a remainder (to bottom)", () => {
      // With `toBottom` and an offset of `6`, we expect to move through
      // fragments like this:
      // - 0: (at location of cursor)
      // - 1: "Fragment 7."
      // - 2: "SUFFIX"
      // - 3: "Next 1."
      // - 4: "Next 2."
      // - 5: "Next 3."

      // But we can only move until we hit "Suffix".  That means there is
      // some amount of moves that must be passed on to the next fragment.
      // 0: "Next 1."
      // 1: "Next 2."
      // 2: "Next 3."

      const offset = insideFrag(simulated.fragFor("Fragment 6"));
      const cursor = testData.inFrag(offset);
      const position = mockPosition(cursor, "toBottom", 5);
      const result = locateInsertion(testData, "sentence", position);

      expect(result).toEqual({ type: "toBottom", remainder: 2 });
    });

    it("should be able to continue with offset `0` (to bottom)", () => {
      const offset = insideFrag(simulated.fragFor("Fragment 6"));
      const cursor = testData.inFrag(offset);
      const position = mockPosition(cursor, "toBottom", 3);
      const result = locateInsertion(testData, "sentence", position);

      expect(result).toEqual({ type: "toBottom", remainder: 0 });          
    });

    it("should indicate the same direction with a remainder (to top)", () => {
      // With `toTop` and an offset of `6`, we expect to move through
      // fragments like this:
      // - 6: "Previous 3."
      // - 5: "Previous 2."
      // - 4: "Previous 1."
      // - 3: "PREFIX"
      // - 2: "Fragment 1."
      // - 1: "Fragment 2."
      // - 0: (at location of cursor)

      // But we can only move until we hit "PREFIX".  That means there is
      // some amount of moves that must be passed on to the next fragment.
      // 2: "Previous 3."
      // 1: "Previous 2."
      // 0: "Previous 1."

      const offset = insideFrag(simulated.fragFor("Fragment 2"));
      const cursor = testData.inFrag(offset);
      const position = mockPosition(cursor, "toTop", 6);
      const result = locateInsertion(testData, "sentence", position);

      expect(result).toEqual({ type: "toTop", remainder: 2 });
    });

    it("should be able to continue with offset `0` (to top)", () => {
      const offset = insideFrag(simulated.fragFor("Fragment 2"));
      const cursor = testData.inFrag(offset);
      const position = mockPosition(cursor, "toTop", 4);
      const result = locateInsertion(testData, "sentence", position);

      expect(result).toEqual({ type: "toTop", remainder: 0 });          
    });
  });

  describe("exceptions", () => {
    const testData = simulated.data;

    it.failing("should FAIL if offset is negative", () => {
      const offset = insideFrag(simulated.fragFor("Fragment 2"));
      const cursor = testData.inFrag(offset);
      const position = mockPosition(cursor, "toBottom", -1);
      locateInsertion(testData, "sentence", position);
    });
  });

  // We're going to travel across two assemblies into a third.
  // Each assembly will have five fragments total (including prefix
  // and suffix).
  describe("consistency across assemblies", () => {
    // The `foldIn` argument is inserted between fragments.
    const makeAssembly = (content: string, foldIn: [string, string]) => {
      const data = generateData(0, {
        content: [
          // SUFFIX
          `${content} 1.`, foldIn[0],
          `${content} 2.`, foldIn[1],
          `${content} 3.`
          // PREFIX
        ]
      });
      const theContent = mockFragment(
        data.content.map(toContent).join(""),
        data.content[0].offset
      );
      return [
        data,
        { ...data, content: [theContent] }
      ] as [AssemblyData, AssemblyData];
    };

    const [topData, topAssembly] = makeAssembly("Top", ["\n", " "]);
    const [, midAssembly] = makeAssembly("Middle", ["\n", "\n"]);
    const [botData, botAssembly] = makeAssembly("Bottom", [" ", "\n"]);

    const assemblies = [topAssembly, midAssembly, botAssembly];

    const isContinue = (result?: Position.Result): result is Position.ContinueResult => {
      if (!result) return false;
      if (result.type === "toBottom") return true;
      if (result.type === "toTop") return true;
      return false;
    };

    const getResult = (
      assemblies: Iterable<AssemblyData>,
      position: InsertionPosition
    ): Position.Result => {
      const copy = [...assemblies];
      for (const [cur, next] of scan(copy)) {
        const curResult = locateInsertion(cur, "sentence", position);
        if (!isContinue(curResult)) return curResult;
        position = mockPosition(
          entryPosition(next, curResult.type, "sentence"),
          curResult.type,
          curResult.remainder
        );
      }

      const lastData = last(copy);
      if (lastData) return locateInsertion(lastData, "sentence", position);

      // Just spit back out the original position.
      return {
        type: position.direction,
        remainder: position.offset
      };
    };

    it("when iterating to bottom", () => {
      // From inside of: Top 2.
      const startOffset = insideFrag(topData.content[2]);
      // To start of: Bottom 2.
      const endOffset = beforeFrag(botData.content[2]);

      // We expect to need to travel across 10 positions:
      // 0:I 1:T3 2:S 3:P 4:M1 5:M2 6:M3 7:S 8:P 9:B1 10:B2
      const cursor = topAssembly.inFrag(startOffset);
      const position = mockPosition(cursor, "toBottom", 10);
      const result = getResult(assemblies, position);

      expect(result).toEqual({
        type: "inside",
        cursor: botAssembly.inFrag(endOffset)
      });
    });

    it("when iterating to top", () => {
      // From inside of: Bottom 2.
      const startOffset = insideFrag(botData.content[2]);
      // To start of: Top 2.
      const endOffset = beforeFrag(topData.content[2]);

      // We expect to need to travel across 11 positions:
      // 0:I 1:B2 2:B1 3:P 4:S 5:M3 6:M2 7:M1 8:P 9:S 10:T3 11:T2
      const cursor = botAssembly.inFrag(startOffset);
      const position = mockPosition(cursor, "toTop", 11);
      const result = getResult(iterReverse(assemblies), position);

      expect(result).toEqual({
        type: "inside",
        cursor: topAssembly.inFrag(endOffset)
      });
    });
  });
});