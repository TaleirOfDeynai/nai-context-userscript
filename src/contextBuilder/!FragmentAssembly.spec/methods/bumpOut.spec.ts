import { describe, it, expect } from "@jest/globals";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, offsetFrags, NO_AFFIX } from "@spec/helpers-assembly";
import { initAssembly } from "../_common";

import { dew } from "@utils/dew";

describe("FragmentAssembly", () => {
  describe("query methods", () => {
    describe("bumpOut", () => {
      const testAssembly = initAssembly(offsetFrags);

      it("should bump toward the top when closest", () => {
        const offset = insideFrag(offsetFrags.content[0]);
        const cursor = mockCursor(offset, "fragment", testAssembly);
        const result = testAssembly.bumpOut(cursor);

        expect(result).toEqual({
          type: "insertBefore",
          shunted: dew(() => {
            const prefixLength = offsetFrags.prefix.content.length;
            const lengthBefore = offset - beforeFrag(offsetFrags.content[0]);
            return prefixLength + lengthBefore;
          })
        });
      });

      it("should bump toward the bottom when closest", () => {
        const offset = insideFrag(offsetFrags.content[4]);
        const cursor = mockCursor(offset, "fragment", testAssembly);
        const result = testAssembly.bumpOut(cursor);

        expect(result).toEqual({
          type: "insertAfter",
          shunted: dew(() => {
            const suffixLength = offsetFrags.suffix.content.length;
            const lengthAfter = afterFrag(offsetFrags.content[4]) - offset;
            return lengthAfter + suffixLength;
          })
        });
      });

      it("should bump to the top when neither is closer", () => {
        const assemblyData = generateData(3, {
          content: ["Some text.", "  ", "Some text."],
          ...NO_AFFIX
        });

        const testAssembly = initAssembly(assemblyData);

        const offset = insideFrag(assemblyData.content[1]);
        const cursor = mockCursor(offset, "fragment", testAssembly);
        const result = testAssembly.bumpOut(cursor);

        expect(result).toEqual({
          type: "insertBefore",
          // The dead center is in between the two spaces of the 2nd fragment.
          shunted: ("Some text. ").length
        });
      });
    });
  });
});