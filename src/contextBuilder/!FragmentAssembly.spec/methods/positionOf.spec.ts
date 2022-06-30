import { describe, it, expect } from "@jest/globals";
import { getEmptyFrag } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";
import { contiguousFrags, offsetFrags } from "@spec/helpers-assembly";
import { initAssembly } from "../_common";

import { first, last } from "@utils/iterables";

describe("FragmentAssembly", () => {
  describe("cursor/selection methods", () => {
    describe("positionOf", () => {
      const testAssembly = initAssembly(contiguousFrags);

      it.failing("should FAIL if cursor is for full-text", () => {
        // @ts-ignore - This is intentional for the test.
        testAssembly.positionOf(mockCursor(10, "fullText", testAssembly));
      });

      it("should identify unrelated cursors", () => {
        // Relations are determined through referential equality.
        const cursor = mockCursor(10, "fragment", { source: {} });
        const result = testAssembly.positionOf(cursor);

        expect(result).toBe("unrelated");
      });

      it("should identify cursors inside prefix", () => {
        const offset = insideFrag(testAssembly.prefix);
        const cursor = mockCursor(offset, "fragment", testAssembly);
        const result = testAssembly.positionOf(cursor);

        expect(result).toBe("prefix");
      });

      it("should identify cursors inside suffix", () => {
        const offset = insideFrag(testAssembly.suffix);
        const cursor = mockCursor(offset, "fragment", testAssembly);
        const result = testAssembly.positionOf(cursor);

        expect(result).toBe("suffix");
      });

      it("should identify cursors inside any content", () => {
        const firstOffset = insideFrag(first(testAssembly.content));
        const firstCursor = mockCursor(firstOffset, "fragment", testAssembly);
        const firstResult = testAssembly.positionOf(firstCursor);

        expect(firstResult).toBe("content");

        const lastOffset = insideFrag(last(testAssembly.content));
        const lastCursor = mockCursor(lastOffset, "fragment", testAssembly);
        const lastResult = testAssembly.positionOf(lastCursor);

        expect(lastResult).toBe("content");
      });

      it("should favor content when ambiguous with prefix", () => {
        const offset = afterFrag(testAssembly.prefix);
        const cursor = mockCursor(offset, "fragment", testAssembly);
        const result = testAssembly.positionOf(cursor);

        expect(result).toBe("content");
      });

      it("should favor content when ambiguous with suffix", () => {
        const offset = beforeFrag(testAssembly.suffix);
        const cursor = mockCursor(offset, "fragment", testAssembly);
        const result = testAssembly.positionOf(cursor);

        expect(result).toBe("content");
      });

      it("should favor prefix when content is empty and ambiguous with suffix", () => {
        const assemblyData = generateData(0, { ...NO_AFFIX, content: [] });
        const testAssembly = initAssembly(assemblyData);

        // Just to assert that the ambiguity is present for the test.
        const offset = afterFrag(assemblyData.prefix);
        expect(offset).toBe(beforeFrag(assemblyData.suffix));

        const cursor = mockCursor(offset, "fragment", testAssembly);
        const result = testAssembly.positionOf(cursor);

        expect(result).toBe("prefix");
      });

      it("should check against the source's `prefix`", () => {
        const sourceAssembly = initAssembly(offsetFrags);
        const childAssembly = initAssembly({
          ...offsetFrags,
          prefix: getEmptyFrag(offsetFrags.prefix),
          source: sourceAssembly
        });

        const offset = insideFrag(offsetFrags.prefix);
        const cursor = mockCursor(offset, "fragment", childAssembly);
        const result = childAssembly.positionOf(cursor);

        expect(result).toBe("prefix");
      });

      it("should check against the source's `suffix`", () => {
        const sourceAssembly = initAssembly(offsetFrags);
        const childAssembly = initAssembly({
          ...offsetFrags,
          suffix: getEmptyFrag(offsetFrags.suffix),
          source: sourceAssembly
        });

        const offset = insideFrag(offsetFrags.suffix);
        const cursor = mockCursor(offset, "fragment", childAssembly);
        const result = childAssembly.positionOf(cursor);

        expect(result).toBe("suffix");
      });
    });
  });
});