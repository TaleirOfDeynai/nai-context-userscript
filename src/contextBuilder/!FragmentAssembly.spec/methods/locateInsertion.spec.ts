import { jest, describe, it, expect } from "@jest/globals";
import { beforeEach } from "@jest/globals";
import { toFragmentSeq, toContent } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";
import { Module, initAssembly } from "../_common";

import { dew } from "@utils/dew";
import { assert } from "@utils/assert";
import { isArray } from "@utils/is";
import { first, last } from "@utils/iterables";

import type { SpyInstance } from "jest-mock";
import type { FragmentAssembly, InsertionPosition } from "../../FragmentAssembly";

describe("FragmentAssembly", () => {
  describe("query methods", () => {
    describe("locateInsertion", () => {
      // Most of the heavy lifting is done by `fragmentsFrom`, which is
      // already tested.  Since this is more about what this method does
      // with the fragments it gets back from `fragmentsFrom`, we're
      // just going to use simulated fragments and test its own internal
      // behavior.

      const mockPosition = (
        position: InsertionPosition["position"],
        direction: InsertionPosition["direction"],
        offset: InsertionPosition["offset"]
      ): InsertionPosition => ({ position, direction, offset });

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

        return {
          rawFrags,
          prefixFrags, contentFrags, suffixFrags,
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

      const withSimulatedData = () => {
        // Just using it.  Don't care.
        const { isCursorInside } = Module;

        let testAssembly: FragmentAssembly;
        let spy: SpyInstance<FragmentAssembly["fragmentsFrom"]>;

        beforeEach(() => {
          testAssembly = initAssembly(simulated.data);
          spy = jest.spyOn(testAssembly, "fragmentsFrom")
            .mockImplementation(function* (pos, _st, dir) {
              assert("Expected a cursor.", !isArray(pos));
              const srcFrags = dew(() => {
                if (dir === "toBottom") return simulated.rawFrags;
                return [...simulated.rawFrags].reverse();
              });
              const index = srcFrags.findIndex((f) => isCursorInside(pos as any, f));
              assert("Expected to find a fragment.", index > 0);
              yield* srcFrags.slice(index);
            });
        });

        return {
          get testAssembly() { return testAssembly; },
          get spy() { return spy; }
        };
      };

      describe("basic functionality", () => {
        const theSpied = withSimulatedData();

        // In NovelAI, this would be `insertionPosition === 0`.
        describe("with offset of 0 (to bottom)", () => {
          // A function since `testAssembly` is only set during a test.
          const getExpectedResult = (testAssembly: FragmentAssembly) => ({
            type: "inside",
            cursor: mockCursor(
              afterFrag(simulated.rawFrags[8]),
              "fragment",
              testAssembly
            )
          });

          it("should position result cursor at end of fragment", () => {
            const { testAssembly, spy } = theSpied;

            const offset = insideFrag(simulated.rawFrags[8]);
            const cursor = mockCursor(offset, "fragment", testAssembly);
            const position = mockPosition(cursor, "toBottom", 0);
            const result = testAssembly.locateInsertion("newline", position);

            expect(spy).toHaveBeenCalledWith(cursor, "newline", "toBottom");
            expect(result).toEqual(getExpectedResult(testAssembly));
          });

          it("should work with input cursor at the end of the fragment", () => {
            const { testAssembly, spy } = theSpied;

            const offset = afterFrag(simulated.rawFrags[8]);
            const cursor = mockCursor(offset, "fragment", testAssembly);
            const position = mockPosition(cursor, "toBottom", 0);
            const result = testAssembly.locateInsertion("newline", position);

            expect(spy).toHaveBeenCalledWith(cursor, "newline", "toBottom");
            expect(result).toEqual(getExpectedResult(testAssembly));
          });
        });

        // In NovelAI, this would be `insertionPosition === -1`.
        describe("with offset of 0 (to top)", () => {
          // A function since `testAssembly` is only set during a test.
          const getExpectedResult = (testAssembly: FragmentAssembly) => ({
            type: "inside",
            cursor: mockCursor(
              beforeFrag(simulated.rawFrags[8]),
              "fragment",
              testAssembly
            )
          });

          it("should position result cursor at start of fragment", () => {
            const { testAssembly, spy } = theSpied;

            const offset = insideFrag(simulated.rawFrags[8]);
            const cursor = mockCursor(offset, "fragment", testAssembly);
            const position = mockPosition(cursor, "toTop", 0);
            const result = testAssembly.locateInsertion("newline", position);

            expect(spy).toHaveBeenCalledWith(cursor, "newline", "toTop");
            expect(result).toEqual(getExpectedResult(testAssembly));
          });

          it("should work with input cursor at the start of the fragment", () => {
            const { testAssembly, spy } = theSpied;

            const offset = beforeFrag(simulated.rawFrags[8]);
            const cursor = mockCursor(offset, "fragment", testAssembly);
            const position = mockPosition(cursor, "toTop", 0);
            const result = testAssembly.locateInsertion("newline", position);

            expect(spy).toHaveBeenCalledWith(cursor, "newline", "toTop");
            expect(result).toEqual(getExpectedResult(testAssembly));
          });
        });

        describe("with non-zero offsets", () => {
          it("should position result cursor after multiple elements", () => {
            const { testAssembly, spy } = theSpied;

            const offset = insideFrag(simulated.rawFrags[8]);
            const cursor = mockCursor(offset, "fragment", testAssembly);
            const position = mockPosition(cursor, "toBottom", 2);
            const result = testAssembly.locateInsertion("newline", position);

            expect(spy).toHaveBeenCalledWith(cursor, "newline", "toBottom");
            expect(result).toEqual({
              type: "inside",
              cursor: mockCursor(
                // After the fragment with text: "Fragment 6."
                afterFrag(simulated.rawFrags[12]),
                "fragment",
                testAssembly
              )
            });
          });

          it("should position result cursor before multiple elements", () => {
            const { testAssembly, spy } = theSpied;

            const offset = insideFrag(simulated.rawFrags[8]);
            const cursor = mockCursor(offset, "fragment", testAssembly);
            const position = mockPosition(cursor, "toTop", 2);
            const result = testAssembly.locateInsertion("newline", position);

            expect(spy).toHaveBeenCalledWith(cursor, "newline", "toTop");
            expect(result).toEqual({
              type: "inside",
              cursor: mockCursor(
                // Before the fragment with text: "Fragment 2."
                beforeFrag(simulated.rawFrags[4]),
                "fragment",
                testAssembly
              )
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

        const assemblyData = generateData(0, {
          ...NO_AFFIX,
          content: [rawFrags.map(toContent).join("")]
        });

        let testAssembly: FragmentAssembly;
        let spy: SpyInstance<FragmentAssembly["fragmentsFrom"]>;

        beforeEach(() => {
          testAssembly = initAssembly(assemblyData);
          spy = jest.spyOn(testAssembly, "fragmentsFrom")
            .mockImplementation(function* (_p, _st, dir) {
              if (dir === "toBottom") yield* rawFrags;
              else yield* rawFrags.slice().reverse();
            });
        });

        it("should position cursor between two empty newline characters (to bottom)", () => {
          // Cursor not currently important; making it correctly anyways.
          const offset = beforeFrag(first(rawFrags));
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const position = mockPosition(cursor, "toBottom", 2);
          const result = testAssembly.locateInsertion("newline", position);

          expect(spy).toHaveBeenCalledWith(cursor, "newline", "toBottom");
          expect(result).toEqual({
            type: "inside",
            cursor: mockCursor(
              // After the first "\n" and before the second "\n".
              afterFrag(rawFrags[3]),
              "fragment",
              testAssembly
            )
          });
        });

        it("should position cursor between two empty newline characters (to top)", () => {
          // Cursor not currently important; making it correctly anyways.
          const offset = afterFrag(last(rawFrags));
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const position = mockPosition(cursor, "toTop", 2);
          const result = testAssembly.locateInsertion("newline", position);

          expect(spy).toHaveBeenCalledWith(cursor, "newline", "toTop");
          expect(result).toEqual({
            type: "inside",
            cursor: mockCursor(
              // After the first "\n" and before the second "\n".
              afterFrag(rawFrags[3]),
              "fragment",
              testAssembly
            )
          });
        });
      });

      describe("unusual circumstance: empty assembly", () => {
        const assemblyData = generateData(0, { ...NO_AFFIX, content: [] });

        let testAssembly: FragmentAssembly;
        let spy: SpyInstance<FragmentAssembly["fragmentsFrom"]>;

        beforeEach(() => {
          testAssembly = initAssembly(assemblyData);
          spy = jest.spyOn(testAssembly, "fragmentsFrom")
            .mockImplementation(() => []);
        });

        const getResult = (dir: "toTop" | "toBottom", offset: number) => {
          const cursor = mockCursor(0, "fragment", testAssembly);
          const position = mockPosition(cursor, dir, offset);
          return testAssembly.locateInsertion("newline", position);
        };

        it("should return the original offset as the remainder", () => {
          expect(getResult("toBottom", 2)).toEqual({ type: "toBottom", remainder: 2 });
          expect(getResult("toBottom", 0)).toEqual({ type: "toBottom", remainder: 0 });
          expect(getResult("toTop", 2)).toEqual({ type: "toTop", remainder: 2 });
          expect(getResult("toTop", 0)).toEqual({ type: "toTop", remainder: 0 });
        });
      });

      // These next two might change in the future.  I'm torn on exactly
      // how they should work.  For now, this is likely fine.

      describe("when it would try to place result cursor inside prefix", () => {
        const theSpied = withSimulatedData();

        it("should indicate `insertBefore`", () => {
          const { testAssembly } = theSpied;

          const offset = insideFrag(simulated.contentFrags[3]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const position = mockPosition(cursor, "toTop", 2);
          const result = testAssembly.locateInsertion("newline", position);

          expect(result).toEqual({
            type: "insertBefore",
            shunted: 6
          });
        });
      });

      describe("when it would try to place result cursor inside suffix", () => {
        const theSpied = withSimulatedData();

        it("should indicate `insertAfter`", () => {
          const { testAssembly } = theSpied;

          const offset = insideFrag(simulated.contentFrags[10]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const position = mockPosition(cursor, "toBottom", 2);
          const result = testAssembly.locateInsertion("newline", position);

          expect(result).toEqual({
            type: "insertAfter",
            shunted: 6
          });
        });
      });

      describe("when the offset goes beyond the bounds of the assembly", () => {
        const theSpied = withSimulatedData();

        it("should indicate the same direction with a remainder (to bottom)", () => {
          const { testAssembly } = theSpied;

          // With `toTop` and an offset of `5`, we expect to move through
          // fragments like this:
          // - 0: "Fragment 6."
          // - 1: "Fragment 7."
          // - 2: "SUFFIX"
          // - 3: "Next 1."
          // - 4: "Next 2."
          // - 5: "Next 3."

          // But we can only move until we hit "Suffix".  That means there is
          // some amount of moves that must be passed on to the next fragment.
          // Here you can see how the `0` offset could still be significant.
          // 0: "Next 1."
          // 1: "Next 2."
          // 2: "Next 2."

          const offset = insideFrag(simulated.contentFrags[10]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const position = mockPosition(cursor, "toBottom", 5);
          const result = testAssembly.locateInsertion("newline", position);

          expect(result).toEqual({ type: "toBottom", remainder: 2 });
        });

        it("should be able to continue with offset `0` (to bottom)", () => {
          const { testAssembly } = theSpied;

          const offset = insideFrag(simulated.contentFrags[10]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const position = mockPosition(cursor, "toBottom", 3);
          const result = testAssembly.locateInsertion("newline", position);

          expect(result).toEqual({ type: "toBottom", remainder: 0 });          
        });

        it("should indicate the same direction with a remainder (to top)", () => {
          const { testAssembly } = theSpied;

          // With `toTop` and an offset of `5`, we expect to move through
          // fragments like this:
          // - 5: "Previous 3."
          // - 4: "Previous 2."
          // - 3: "Previous 1."
          // - 2: "PREFIX"
          // - 1: "Fragment 1."
          // - 0: "Fragment 2."

          // But we can only move until we hit "PREFIX".  That means there is
          // some amount of moves that must be passed on to the next fragment.
          // Here you can see how the `0` offset could still be significant.
          // 2: "Previous 3."
          // 1: "Previous 2."
          // 0: "Previous 1."

          const offset = insideFrag(simulated.contentFrags[3]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const position = mockPosition(cursor, "toTop", 5);
          const result = testAssembly.locateInsertion("newline", position);

          expect(result).toEqual({ type: "toTop", remainder: 2 });
        });

        it("should be able to continue with offset `0` (to top)", () => {
          const { testAssembly } = theSpied;

          const offset = insideFrag(simulated.contentFrags[3]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const position = mockPosition(cursor, "toTop", 3);
          const result = testAssembly.locateInsertion("newline", position);

          expect(result).toEqual({ type: "toTop", remainder: 0 });          
        });
      });

      describe("when using a selection", () => {
        const theSpied = withSimulatedData();

        it("should call `fragmentsFrom` with that selection", () => {
          const { spy, testAssembly } = theSpied;
          spy.mockImplementation(() => [...simulated.rawFrags]);

          const selection = [
            mockCursor(beforeFrag(simulated.contentFrags[3]), "fragment", testAssembly),
            mockCursor(afterFrag(simulated.contentFrags[3]), "fragment", testAssembly)
          ] as const;
          const position = mockPosition(selection, "toBottom", 1);
          testAssembly.locateInsertion("newline", position);

          // We only care to know it still passed the selection.
          expect(spy).toHaveBeenCalledWith(selection, "newline", "toBottom");
        });
      });

      describe("exceptions", () => {
        const theSpied = withSimulatedData();

        it.failing("should FAIL if offset is negative", () => {
          const { testAssembly } = theSpied;

          const offset = insideFrag(simulated.contentFrags[3]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const position = mockPosition(cursor, "toBottom", -1);
          testAssembly.locateInsertion("newline", position);
        });
      });
    });
  });
});