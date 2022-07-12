import { describe, it, expect } from "@jest/globals";
import { toContent } from "@spec/helpers-splitter";
import { afterFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, offsetFrags, NO_AFFIX } from "@spec/helpers-assembly";
import { initAssembly } from "./_common";

import { first, last } from "@utils/iterables";

describe("FragmentAssembly", () => {
  describe("properties", () => {
    const sourceAssembly = initAssembly(offsetFrags);

    const childAssembly = initAssembly({
      ...offsetFrags,
      content: offsetFrags.content.slice(0, 3),
      source: sourceAssembly
    });

    describe("text", () => {
      it("should produce the full, concatenated text (no affixing)", () => {
        const assemblyData = generateData(3, NO_AFFIX);
        const testAssembly = initAssembly(assemblyData);

        expect(testAssembly.text).toBe(assemblyData.content.map(toContent).join(""));
      });

      it("should produce the full, concatenated text (with affixing)", () => {
        const { prefix, content, suffix } = offsetFrags;

        const allFrags = [prefix, ...content, suffix];

        expect(sourceAssembly.text).toBe(allFrags.map(toContent).join(""));
      });
    });

    describe("isSource", () => {
      it("should be able to determine it is a source", () => {
        expect(sourceAssembly.isSource).toBe(true);
      });

      it("should be able to determine it is not a source", () => {
        expect(childAssembly.isSource).toBe(false);
      });
    });

    describe("source", () => {
      it("should return `this` if it is a source assembly", () => {
        expect(sourceAssembly.source).toBe(sourceAssembly);
      });

      it("should return the correct source if it is not a source assembly", () => {
        expect(childAssembly.source).toBe(sourceAssembly);
      });
    });

    describe("stats", () => {
      it("should use all fragments to build stats", () => {
        const allFrags = [offsetFrags.prefix, ...offsetFrags.content, offsetFrags.suffix];
        const totalLength = allFrags.map(toContent).reduce((a, c) => a + c.length, 0);
        const minOffset = beforeFrag(offsetFrags.prefix);
        const maxOffset = afterFrag(offsetFrags.suffix);

        expect(sourceAssembly.stats).toEqual({
          minOffset, maxOffset,
          impliedLength: maxOffset - minOffset,
          concatLength: totalLength
        });
      });

      it("should reuse `contentStats` when un-affixed", () => {
        const assemblyData = generateData(15, NO_AFFIX);
        const testAssembly = initAssembly(assemblyData);

        expect(testAssembly.stats).toBe(testAssembly.contentStats);
      });
    });

    describe("contentStats", () => {
      it("should use only the content fragments to build stats", () => {
        const { content } = offsetFrags;
        const totalLength = content.map(toContent).reduce((a, c) => a + c.length, 0);

        expect(sourceAssembly.contentStats).toEqual({
          minOffset: beforeFrag(first(content)),
          maxOffset: afterFrag(last(content)),
          impliedLength: totalLength,
          concatLength: totalLength
        });
      });

      it("should offset after the prefix when empty", () => {
        const emptyAssembly = initAssembly({ ...offsetFrags, content: [] });

        expect(emptyAssembly.contentStats).toEqual({
          minOffset: afterFrag(offsetFrags.prefix),
          maxOffset: afterFrag(offsetFrags.prefix),
          impliedLength: 0,
          concatLength: 0
        });
      });
    });
  });
});