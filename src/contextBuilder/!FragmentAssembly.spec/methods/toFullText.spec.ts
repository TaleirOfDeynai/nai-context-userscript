import { describe, it, expect } from "@jest/globals";
import { mockFragment, toContent } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { offsetFrags } from "@spec/helpers-assembly";
import { initAssembly } from "../_common";

import { dew } from "@utils/dew";

describe("FragmentAssembly", () => {
  describe("cursor/selection methods", () => {
    describe("toFullText", () => {
      const testAssembly = initAssembly(offsetFrags);

      describe("sanity checks", () => {
        it.failing("should FAIL if cursor is not assembly", () => {
          const offset = insideFrag(mockFragment(testAssembly.text, 0));
          const cursor = mockCursor(offset, "fullText", testAssembly);
          
          // @ts-ignore - We're checking this assertion fails at runtime.
          testAssembly.toFullText(cursor);
        });
  
        it.failing("should FAIL if cursor is not related to the assembly", () => {
          const offset = insideFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "fragment", { origin: {} });

          testAssembly.toFullText(cursor);
        });

        it.failing("should FAIL is cursor targets a non-existent fragment", () => {
          const testAssembly = initAssembly({
            ...offsetFrags,
            // Removing index 2.
            content: [
              ...offsetFrags.content.slice(0, 2),
              ...offsetFrags.content.slice(3)
            ]
          });

          const offset = insideFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "fragment", testAssembly);

          testAssembly.toFullText(cursor);
        });
      });

      describe("basic functionality", () => {
        it("should work for the prefix", () => {
          const offset = insideFrag(offsetFrags.prefix);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const result = testAssembly.toFullText(cursor);

          expect(result).toEqual(mockCursor(
            offset - beforeFrag(offsetFrags.prefix),
            "fullText",
            testAssembly
          ));
        });

        it("should work for any content", () => {
          const offset = insideFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const result = testAssembly.toFullText(cursor);

          expect(result).toEqual(mockCursor(
            dew(() => {
              const upToFrag = [offsetFrags.prefix, ...offsetFrags.content.slice(0, 2)];
              const totalLength = upToFrag.map(toContent).reduce((p, c) => p + c.length, 0);
              const innerOffset = offset - beforeFrag(offsetFrags.content[2]);
              return totalLength + innerOffset;
            }),
            "fullText",
            testAssembly
          ));
        });

        it("should work for the suffix", () => {
          const offset = insideFrag(offsetFrags.suffix);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const result = testAssembly.toFullText(cursor);

          expect(result).toEqual(mockCursor(
            dew(() => {
              const upToFrag = [offsetFrags.prefix, ...offsetFrags.content];
              const totalLength = upToFrag.map(toContent).reduce((p, c) => p + c.length, 0);
              const innerOffset = offset - beforeFrag(offsetFrags.suffix);
              return totalLength + innerOffset;
            }),
            "fullText",
            testAssembly
          ));
        });
      });
    });
  });
});