import { describe, it, expect } from "@jest/globals";
import { mockCursor } from "@spec/helpers-assembly";
import { insideFrag } from "@spec/helpers-assembly";
import { contiguousFrags, offsetFrags } from "@spec/helpers-assembly";
import { initAssembly } from "../_common";

describe("FragmentAssembly", () => {
  describe("cursor/selection methods", () => {
    describe("isFoundIn", () => {
      const testAssembly = initAssembly(offsetFrags);

      it.failing("should FAIL if cursor is for full-text", () => {
        const cursor = mockCursor(10, "fullText", testAssembly);
        // @ts-ignore - We're checking the runtime assertion.
        testAssembly.isFoundIn(cursor);
      });

      it.failing("should FAIL if cursor is for unrelated assembly", () => {
        const foreignAssembly = initAssembly({
          ...contiguousFrags,
          content: [],
          source: initAssembly(contiguousFrags)
        });

        const cursor = mockCursor(10, "fragment", foreignAssembly);
        testAssembly.isFoundIn(cursor);
      });

      it("should identify cursor in prefix", () => {
        const offset = insideFrag(testAssembly.prefix);
        const cursor = mockCursor(offset, "fragment", testAssembly);

        expect(testAssembly.isFoundIn(cursor)).toBe(true);
      });

      it("should identify cursor in suffix", () => {
        const offset = insideFrag(testAssembly.suffix);
        const cursor = mockCursor(offset, "fragment", testAssembly);

        expect(testAssembly.isFoundIn(cursor)).toBe(true);
      });

      it("should identify cursor in any content", () => {
        const offset = insideFrag(testAssembly.content[2]);
        const cursor = mockCursor(offset, "fragment", testAssembly);

        expect(testAssembly.isFoundIn(cursor)).toBe(true);
      });

      it("should not identify a cursor in missing content", () => {
        const childAssembly = initAssembly({
          ...offsetFrags,
          content: [
            // Dropping indices 2 and 3.
            ...offsetFrags.content.slice(0, 2),
            ...offsetFrags.content.slice(-1),
          ],
          source: testAssembly
        });

        const offset = insideFrag(testAssembly.content[2]);
        const cursor = mockCursor(offset, "fragment", testAssembly);

        expect(childAssembly.isFoundIn(cursor)).toBe(false);
      });
    });
  });
});