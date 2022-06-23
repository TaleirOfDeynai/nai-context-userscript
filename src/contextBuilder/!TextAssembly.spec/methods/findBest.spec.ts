import { describe, it, expect } from "@jest/globals";
import { getEmptyFrag } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { initAssembly } from "../_common";
import { offsetFrags } from "../_common";

import { first, last } from "@utils/iterables";

import type { TextAssembly } from "../../TextAssembly";
import type { TextFragment } from "../../TextSplitterService";

describe("TextAssembly", () => {
  describe("cursor/selection methods", () => {
    describe("findBest", () => {
      // This always repositions to the nearest existing fragment,
      // regardless of any pattern in its ordering.  The assembly
      // won't consider where missing content would be located if
      // they were present.

      const runCommonTests = (
        testAssembly: TextAssembly,
        minContent: TextFragment,
        maxContent: TextFragment
      ) => {
        it("should return the same cursor instance when found", () => {
          const offset = insideFrag(minContent);
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toBe(cursor);
        });

        it("should be able to position to prefix if closest", () => {
          const afterPrefix = afterFrag(testAssembly.prefix);

          const offset = afterPrefix + 1;
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toEqual(mockCursor(afterPrefix, "assembly", testAssembly));
        });

        it("should be able to position to suffix if closest", () => {
          const beforeSuffix = beforeFrag(testAssembly.suffix);

          const offset = beforeSuffix - 1;
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toEqual(mockCursor(beforeSuffix, "assembly", testAssembly));
        });

        it("should reposition to nearest content when possible (near prefix)", () => {
          const expectedOffset = beforeFrag(minContent);

          const offset = afterFrag(testAssembly.prefix) + 2;
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toEqual(mockCursor(expectedOffset, "assembly", testAssembly));
        });

        it("should reposition to nearest content when possible (near suffix)", () => {
          const expectedOffset = afterFrag(maxContent);

          const offset = beforeFrag(testAssembly.suffix) - 2;
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toEqual(mockCursor(expectedOffset, "assembly", testAssembly));
        });
      };

      describe("when fully contiguous", () => {
        const testAssembly = initAssembly(offsetFrags);

        runCommonTests(
          testAssembly,
          offsetFrags.content[0],
          offsetFrags.content[4]
        );
      });

      describe("when in order but with gap", () => {
        const testAssembly = initAssembly({
          ...offsetFrags,
          content: [
            offsetFrags.content[0],
            offsetFrags.content[1],
            offsetFrags.content[4]
          ],
          isContiguous: false
        });

        runCommonTests(
          testAssembly,
          offsetFrags.content[0],
          offsetFrags.content[4]
        );

        it("should reposition to nearest fragment when possible (in content gap)", () => {
          const expectedOffset = afterFrag(offsetFrags.content[1]);

          const offset = insideFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toEqual(mockCursor(expectedOffset, "assembly", testAssembly));
        });
      });

      describe("when out of order and with gap", () => {
        const testAssembly = initAssembly({
          ...offsetFrags,
          content: [
            offsetFrags.content[4],
            offsetFrags.content[3],
            offsetFrags.content[0]
          ],
          isContiguous: false
        });

        runCommonTests(
          testAssembly,
          offsetFrags.content[0],
          offsetFrags.content[4]
        );

        it("should reposition to nearest fragment when possible (in content gap)", () => {
          const expectedOffset = beforeFrag(offsetFrags.content[3]);

          const offset = insideFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toEqual(mockCursor(expectedOffset, "assembly", testAssembly));
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
            const testAssembly = initAssembly(offsetFrags);

            const offset = insideFrag(offsetFrags.prefix);
            const cursor = mockCursor(offset, "assembly", testAssembly);
            const result = testAssembly.findBest(cursor, true);

            expect(result.offset).toBe(beforeFrag(first(offsetFrags.content)));
          });

          it("should favor content even when prefix is closer in gap", () => {
            const testAssembly = initAssembly(offsetFrags);

            const offset = afterFrag(offsetFrags.prefix) + 1;
            const cursor = mockCursor(offset, "assembly", testAssembly);
            const result = testAssembly.findBest(cursor, true);

            expect(result.offset).toBe(beforeFrag(first(offsetFrags.content)));
          });

          it("should favor prefix when content is empty", () => {
            const testAssembly = initAssembly({ ...offsetFrags, content: [] });

            const offset = insideFrag(first(offsetFrags.content));
            const cursor = mockCursor(offset, "assembly", testAssembly);
            const result = testAssembly.findBest(cursor, true);

            expect(result.offset).toBe(afterFrag(offsetFrags.prefix));
          });

          it("should use the source's prefix when content is empty", () => {
            const sourceAssembly = initAssembly(offsetFrags);
            const childAssembly = initAssembly({
              ...offsetFrags,
              content: [],
              prefix: getEmptyFrag(offsetFrags.prefix),
              source: sourceAssembly
            });

            const offset = afterFrag(offsetFrags.prefix);
            const cursor = mockCursor(offset, "assembly", sourceAssembly);

            // Sanity check the cursor; will we do a shift?
            expect(childAssembly.isFoundIn(cursor)).toBe(false);

            const result = childAssembly.findBest(cursor, true);

            expect(result.offset).toBe(afterFrag(sourceAssembly.prefix));
            expect(result.offset).not.toBe(afterFrag(childAssembly.prefix));
          });
        });

        describe("concerning the suffix", () => {
          it("should move a suffix cursor to the end of content", () => {
            const testAssembly = initAssembly(offsetFrags);

            const offset = insideFrag(offsetFrags.suffix);
            const cursor = mockCursor(offset, "assembly", testAssembly);
            const result = testAssembly.findBest(cursor, true);

            expect(result.offset).toBe(afterFrag(last(offsetFrags.content)));
          });

          it("should favor content even when suffix is closer in gap", () => {
            const testAssembly = initAssembly(offsetFrags);

            const offset = beforeFrag(offsetFrags.suffix) - 1;
            const cursor = mockCursor(offset, "assembly", testAssembly);
            const result = testAssembly.findBest(cursor, true);

            expect(result.offset).toBe(afterFrag(last(offsetFrags.content)));
          });

          it("should favor suffix when content is empty", () => {
            const testAssembly = initAssembly({ ...offsetFrags, content: [] });

            const offset = insideFrag(last(offsetFrags.content));
            const cursor = mockCursor(offset, "assembly", testAssembly);
            const result = testAssembly.findBest(cursor, true);

            expect(result.offset).toBe(beforeFrag(offsetFrags.suffix));
          });

          it("should use the source's suffix when content is empty", () => {
            const sourceAssembly = initAssembly(offsetFrags);
            const childAssembly = initAssembly({
              ...offsetFrags,
              content: [],
              suffix: getEmptyFrag(offsetFrags.suffix),
              source: sourceAssembly
            });

            const offset = afterFrag(offsetFrags.suffix);
            const cursor = mockCursor(offset, "assembly", sourceAssembly);

            // Sanity check the cursor; will we do a shift?
            expect(childAssembly.isFoundIn(cursor)).toBe(false);

            const result = childAssembly.findBest(cursor, true);

            expect(result.offset).toBe(afterFrag(sourceAssembly.suffix));
            expect(result.offset).not.toBe(afterFrag(childAssembly.suffix));
          });
        });
      });
    });
  });
});