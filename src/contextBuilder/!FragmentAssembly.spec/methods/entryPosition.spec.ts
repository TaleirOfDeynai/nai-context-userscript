import { describe, it, expect } from "@jest/globals";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, offsetFrags, NO_AFFIX } from "@spec/helpers-assembly";
import { initAssembly } from "../_common";

import { dew } from "@utils/dew";
import { first, last } from "@utils/iterables";

describe("FragmentAssembly", () => {
  describe("query methods", () => {
    describe("entryPosition", () => {
      const NP = { prefix: "" };
      const NS = { suffix: "" };
      const NC = { content: [] };

      describe("for `toBottom`", () => {
        it("should enter before prefix when it is non-empty", () => {
          const testAssembly = initAssembly(generateData(3));
          const result = testAssembly.entryPosition("toBottom");

          expect(result).toEqual(mockCursor(
            beforeFrag(testAssembly.prefix), "fragment", testAssembly
          ));
        });

        it("should enter before first content when prefix is empty", () => {
          const testAssembly = initAssembly(generateData(3, NP));
          const result = testAssembly.entryPosition("toBottom");

          expect(result).toEqual(mockCursor(
            beforeFrag(first(testAssembly.content)), "fragment", testAssembly
          ));
        });

        it("should enter before suffix otherwise", () => {
          const testAssembly = initAssembly(generateData(3, { ...NP, ...NC }));
          const result = testAssembly.entryPosition("toBottom");

          expect(result).toEqual(mockCursor(
            beforeFrag(testAssembly.suffix), "fragment", testAssembly
          ));
        });

        it("should work with empty assemblies", () => {
          const testAssembly = initAssembly(generateData(3, { ...NP, ...NC, ...NS }));
          const result = testAssembly.entryPosition("toBottom");

          expect(result).toEqual(mockCursor(
            beforeFrag(testAssembly.suffix), "fragment", testAssembly
          ));
        });
      });

      describe("for `toTop`", () => {
        it("should enter after suffix when it is non-empty", () => {
          const testAssembly = initAssembly(generateData(3));
          const result = testAssembly.entryPosition("toTop");

          expect(result).toEqual(mockCursor(
            afterFrag(testAssembly.suffix), "fragment", testAssembly
          ));
        });

        it("should enter after last content when suffix is empty", () => {
          const testAssembly = initAssembly(generateData(3, NS));
          const result = testAssembly.entryPosition("toTop");

          expect(result).toEqual(mockCursor(
            afterFrag(last(testAssembly.content)), "fragment", testAssembly
          ));
        });

        it("should enter after prefix otherwise", () => {
          const testAssembly = initAssembly(generateData(3, { ...NS, ...NC }));
          const result = testAssembly.entryPosition("toTop");

          expect(result).toEqual(mockCursor(
            afterFrag(testAssembly.prefix), "fragment", testAssembly
          ));
        });

        it("should work with empty assemblies", () => {
          const testAssembly = initAssembly(generateData(3, { ...NS, ...NC, ...NP }));
          const result = testAssembly.entryPosition("toTop");

          expect(result).toEqual(mockCursor(
            afterFrag(testAssembly.prefix), "fragment", testAssembly
          ));
        });
      });
      
    });
  });
});