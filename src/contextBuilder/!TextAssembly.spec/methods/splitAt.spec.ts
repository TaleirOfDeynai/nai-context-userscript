import { jest, describe, it, expect } from "@jest/globals";
import { mockFragment, getEmptyFrag } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, initAssembly } from "../_common";
import { contiguousFrags, offsetFrags } from "../_common";

import { first, last } from "@utils/iterables";

import type { SpyInstance } from "jest-mock";
import type { TextAssembly } from "../../TextAssembly";

describe("TextAssembly", () => {
  describe("manipulation methods", () => {
    describe("splitAt", () => {
      const testAssembly = initAssembly(offsetFrags);

      describe("failure cases", () => {
        it("should return `undefined` if cursor is unrelated", () => {
          const foreignAssembly = initAssembly(contiguousFrags);
          
          const offset = insideFrag(first(contiguousFrags.content));
          const cursor = mockCursor(offset, "assembly", foreignAssembly);
          const result = testAssembly.splitAt(cursor);

          expect(result).toBeUndefined();
        });

        it("should return `undefined` if cursor is not within content block", () => {
          const offset = insideFrag(offsetFrags.prefix);
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.splitAt(cursor);

          expect(result).toBeUndefined();
        });
      });

      describe("basic functionality", () => {
        // All of these are doing slice in the fragment with the text:
        // "This is the second fragment."

        it("should be able to split before a fragment", () => {
          const offset = beforeFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.splitAt(cursor) as [TextAssembly, TextAssembly];

          // Left of the cut.
          expect(result[0].prefix).toBe(offsetFrags.prefix);
          expect(result[0].content).toEqual(offsetFrags.content.slice(0, 2));
          expect(result[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[1].content).toEqual(offsetFrags.content.slice(2));
          expect(result[1].suffix).toBe(offsetFrags.suffix);
        });

        it("should be able to split after a fragment", () => {
          const offset = afterFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.splitAt(cursor) as [TextAssembly, TextAssembly];

          // Left of the cut.
          expect(result[0].prefix).toBe(offsetFrags.prefix);
          expect(result[0].content).toEqual(offsetFrags.content.slice(0, 3));
          expect(result[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[1].content).toEqual(offsetFrags.content.slice(3));
          expect(result[1].suffix).toBe(offsetFrags.suffix);
        });

        it("should be able to split inside a fragment", () => {
          const sliceOffset = ("This is the").length;
          const slicedFrag = offsetFrags.content[2];
          const offset = beforeFrag(slicedFrag) + sliceOffset;
          const cursor = mockCursor(offset, "assembly", testAssembly);
          
          const result = testAssembly.splitAt(cursor) as [TextAssembly, TextAssembly];

          // Left of the cut.
          expect(result[0].prefix).toBe(offsetFrags.prefix);
          expect(result[0].content).toEqual([
            ...offsetFrags.content.slice(0, 2),
            mockFragment("This is the", 0, slicedFrag)
          ]);
          expect(result[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[1].content).toEqual([
            mockFragment(" second fragment.", sliceOffset, slicedFrag),
            ...offsetFrags.content.slice(3)
          ]);
          expect(result[1].suffix).toBe(offsetFrags.suffix);
        });
      });

      describe("concerning the prefix", () => {
        it("should be able to split after the prefix", () => {
          const offset = beforeFrag(offsetFrags.content[0]);
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.splitAt(cursor) as [TextAssembly, TextAssembly];

          // Left of the cut.
          expect(result[0].prefix).toBe(offsetFrags.prefix);
          expect(result[0].content).toEqual([]);
          expect(result[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[1].content).toEqual(offsetFrags.content);
          expect(result[1].suffix).toBe(offsetFrags.suffix);
        });

        it("should propagate the prefix correctly when splitting twice", () => {
          const firstOffset = afterFrag(offsetFrags.content[2]);
          const firstCursor = mockCursor(firstOffset, "assembly", testAssembly);
          const firstSplit = first(testAssembly.splitAt(firstCursor) ?? []);

          const secondOffset = afterFrag(offsetFrags.content[0]);
          const secondCursor = mockCursor(secondOffset, "assembly", testAssembly);
          const result = firstSplit?.splitAt(secondCursor) as [TextAssembly, TextAssembly];

          // Left of the cut.
          expect(result[0].prefix).toBe(offsetFrags.prefix);
          expect(result[0].content).toEqual(offsetFrags.content.slice(0, 1));
          expect(result[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[1].content).toEqual(offsetFrags.content.slice(1, 3));
          expect(result[1].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));
        });

        it("should reuse an empty prefix fragment", () => {
          const assemblyData = generateData(3, { prefix: "" });
          const testAssembly = initAssembly(assemblyData);

          const offset = afterFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = first(testAssembly.splitAt(cursor) ?? []);

          // Since the assembly already has an empty prefix, the instance should
          // be reused instead of creating a new empty fragment.
          expect(result?.prefix).toBe(assemblyData.prefix);
        });
      });

      describe("concerning the suffix", () => {
        it("should be able to split before the suffix", () => {
          const offset = afterFrag(offsetFrags.content[4]);
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.splitAt(cursor) as [TextAssembly, TextAssembly];

          // Left of the cut.
          expect(result[0].prefix).toBe(offsetFrags.prefix);
          expect(result[0].content).toEqual(offsetFrags.content);
          expect(result[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[1].content).toEqual([]);
          expect(result[1].suffix).toBe(offsetFrags.suffix);
        });

        it("should propagate the suffix correctly when splitting twice", () => {
          const firstOffset = beforeFrag(offsetFrags.content[2]);
          const firstCursor = mockCursor(firstOffset, "assembly", testAssembly);
          const firstSplit = last(testAssembly.splitAt(firstCursor) ?? []);

          const secondOffset = beforeFrag(offsetFrags.content[4]);
          const secondCursor = mockCursor(secondOffset, "assembly", testAssembly);
          const result = firstSplit?.splitAt(secondCursor) as [TextAssembly, TextAssembly];

          // Left of the cut.
          expect(result[0].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[0].content).toEqual(offsetFrags.content.slice(2, 4));
          expect(result[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[1].content).toEqual(offsetFrags.content.slice(4));
          expect(result[1].suffix).toBe(offsetFrags.suffix);
        });

        it("should reuse an empty suffix fragment", () => {
          const assemblyData = generateData(3, { suffix: "" });
          const testAssembly = initAssembly(assemblyData);

          const offset = beforeFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = last(testAssembly.splitAt(cursor) ?? []);

          // Since the assembly already has an empty suffix, the instance should
          // be reused instead of creating a new empty fragment.
          expect(result?.suffix).toBe(assemblyData.suffix);
        });
      });

      describe("concerning loose mode", () => {
        let testAssembly: TextAssembly;
        let spyFindBest: SpyInstance<TextAssembly["findBest"]>;
        let spyIsFoundIn: SpyInstance<TextAssembly["isFoundIn"]>;

        beforeEach(() => {
          testAssembly = initAssembly(offsetFrags);
          spyFindBest = jest.spyOn(testAssembly, "findBest");
          spyIsFoundIn = jest.spyOn(testAssembly, "isFoundIn");
        });

        it("should call `findBest` with the input cursor when active", () => {
          const offset = beforeFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "assembly", testAssembly);

          spyFindBest.mockReturnValue(cursor);
          testAssembly.splitAt(cursor, true);

          expect(spyFindBest).toBeCalledWith(cursor, true);
          expect(spyIsFoundIn).not.toHaveBeenCalled();
        });

        it("should NOT call `findBest` with the input cursor when inactive", () => {
          const offset = beforeFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "assembly", testAssembly);

          spyIsFoundIn.mockReturnValue(true);
          testAssembly.splitAt(cursor, false);

          expect(spyIsFoundIn).toBeCalledWith(cursor);
          expect(spyFindBest).not.toHaveBeenCalled();
        });

        it("should not use the best cursor if it is outside the content block", () => {
          const inputCursor = mockCursor(
            beforeFrag(offsetFrags.content[2]),
            "assembly", testAssembly
          );

          const prefixCursor = mockCursor(
            insideFrag(offsetFrags.prefix),
            "assembly", testAssembly
          );

          spyFindBest.mockReturnValue(prefixCursor);
          const result = testAssembly.splitAt(inputCursor, true);

          expect(result).toBeUndefined();
        });
      });
    });
  });
});