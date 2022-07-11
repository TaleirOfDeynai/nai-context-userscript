import { describe, it, expect } from "@jest/globals";
import { toContent, mockFragment } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData } from "@spec/helpers-assembly";
import { initAssembly } from "../_common";

import { first, last } from "@utils/iterables";

import type { AssemblyInit } from "@spec/helpers-assembly";

describe("FragmentAssembly", () => {
  describe("query methods", () => {
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

      const makeAssembly = (data: AssemblyInit) => {
        const content = !data.content.length ? [] : [mockFragment(
          data.content.map(toContent).join(""),
          data.content[0].offset
        )];

        return initAssembly({ ...data, content });
      };

      describe("for `toBottom`", () => {
        describe("without an insertion type", () => {
          it("should enter before prefix when it is non-empty", () => {
            const testData = theData.base;
            const testAssembly = makeAssembly(testData);
            const result = testAssembly.entryPosition("toBottom");
  
            expect(result).toEqual(mockCursor(
              beforeFrag(testData.prefix), "fragment", testAssembly
            ));
          });

          it("should enter before first content fragment when prefix is empty", () => {
            const testData = theData.noPrefix;
            const testAssembly = makeAssembly(testData);
            const result = testAssembly.entryPosition("toBottom");
  
            expect(result).toEqual(mockCursor(
              beforeFrag(first(testData.content)), "fragment", testAssembly
            ));
          });

          it("should enter before suffix otherwise", () => {
            const testData = theData.onlySuffix;
            const testAssembly = makeAssembly(testData);
            const result = testAssembly.entryPosition("toBottom");
  
            expect(result).toEqual(mockCursor(
              beforeFrag(testData.suffix), "fragment", testAssembly
            ));
          });

          it("should work with empty assemblies", () => {
            const testAssembly = makeAssembly(theData.empty);
            const result = testAssembly.entryPosition("toBottom");
  
            expect(result).toEqual(mockCursor(
              beforeFrag(testAssembly.suffix), "fragment", testAssembly
            ));
          });
        });

        describe("with an insertion type", () => {
          it("should enter after prefix when it is non-empty", () => {
            const testData = theData.base;
            const testAssembly = makeAssembly(testData);
            const result = testAssembly.entryPosition("toBottom", "sentence");

            expect(result).toEqual(mockCursor(
              // Accounting for the `\n` after it.
              afterFrag(testData.prefix) - 1,
              "fragment", testAssembly
            ));
          });

          it("should enter after first content when prefix is empty", () => {
            const testData = theData.noPrefix;
            const testAssembly = makeAssembly(testData);
            const result = testAssembly.entryPosition("toBottom", "sentence");

            expect(result).toEqual(mockCursor(
              afterFrag(first(testData.content)), "fragment", testAssembly
            ));
          });

          it("should enter after suffix otherwise", () => {
            const testData = theData.onlySuffix;
            const testAssembly = makeAssembly(testData);
            const result = testAssembly.entryPosition("toBottom", "sentence");

            expect(result).toEqual(mockCursor(
              afterFrag(testData.suffix), "fragment", testAssembly
            ));
          });

          it("should work with empty assemblies", () => {
            const testAssembly = makeAssembly(theData.empty);
            const result = testAssembly.entryPosition("toBottom", "sentence");

            expect(result).toEqual(mockCursor(
              beforeFrag(testAssembly.suffix), "fragment", testAssembly
            ));
          });
        });
      });

      describe("for `toTop`", () => {
        describe("without an insertion type", () => {
          it("should enter after suffix when it is non-empty", () => {
            const testData = theData.base;
            const testAssembly = makeAssembly(testData);
            const result = testAssembly.entryPosition("toTop");
  
            expect(result).toEqual(mockCursor(
              afterFrag(testData.suffix), "fragment", testAssembly
            ));
          });

          it("should enter after last content fragment when suffix is empty", () => {
            const testData = theData.noSuffix;
            const testAssembly = makeAssembly(testData);
            const result = testAssembly.entryPosition("toTop");
  
            expect(result).toEqual(mockCursor(
              afterFrag(last(testData.content)), "fragment", testAssembly
            ));
          });

          it("should enter after prefix otherwise", () => {
            const testData = theData.onlyPrefix;
            const testAssembly = makeAssembly(testData);
            const result = testAssembly.entryPosition("toTop");
  
            expect(result).toEqual(mockCursor(
              afterFrag(testData.prefix), "fragment", testAssembly
            ));
          });

          it("should work with empty assemblies", () => {
            const testAssembly = makeAssembly(theData.empty);
            const result = testAssembly.entryPosition("toTop");
  
            expect(result).toEqual(mockCursor(
              afterFrag(testAssembly.prefix), "fragment", testAssembly
            ));
          });
        });

        describe("with an insertion type", () => {
          it("should enter before suffix when it is non-empty", () => {
            const testData = theData.base;
            const testAssembly = makeAssembly(testData);
            const result = testAssembly.entryPosition("toTop", "sentence");
  
            expect(result).toEqual(mockCursor(
              // Accounting for the `\n` before it.
              beforeFrag(testData.suffix) + 1,
              "fragment", testAssembly
            ));
          });
  
          it("should enter before last position in content when suffix is empty", () => {
            const testData = theData.noSuffix;
            const testAssembly = makeAssembly(testData);
            const result = testAssembly.entryPosition("toTop", "sentence");
  
            expect(result).toEqual(mockCursor(
              beforeFrag(last(testData.content)), "fragment", testAssembly
            ));
          });
  
          it("should enter before prefix otherwise", () => {
            const testData = theData.onlyPrefix;
            const testAssembly = makeAssembly(testData);
            const result = testAssembly.entryPosition("toTop", "sentence");
  
            expect(result).toEqual(mockCursor(
              beforeFrag(testData.prefix), "fragment", testAssembly
            ));
          });
  
          it("should work with empty assemblies", () => {
            const testAssembly = makeAssembly(theData.empty);
            const result = testAssembly.entryPosition("toTop", "sentence");
  
            expect(result).toEqual(mockCursor(
              afterFrag(testAssembly.prefix), "fragment", testAssembly
            ));
          });
        });
      });
      
    });
  });
});