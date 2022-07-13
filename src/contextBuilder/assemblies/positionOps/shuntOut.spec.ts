import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, offsetFrags, NO_AFFIX } from "@spec/helpers-assembly";

import { dew } from "@utils/dew";
import $ShuntOut from "./shuntOut";

const { shuntOut } = $ShuntOut(fakeRequire);

describe("shuntOut", () => {
  const testData = offsetFrags;

  describe("nearest mode", () => {
    it("should shunt toward the top when closest", () => {
      const offset = insideFrag(offsetFrags.content[0]);
      const cursor = testData.inFrag(offset);
      const result = shuntOut(testData, cursor);

      expect(result).toEqual({
        type: "insertBefore",
        shunted: dew(() => {
          const prefixLength = offsetFrags.prefix.content.length;
          const lengthBefore = offset - beforeFrag(offsetFrags.content[0]);
          return prefixLength + lengthBefore;
        })
      });
    });

    it("should shunt toward the bottom when closest", () => {
      const offset = insideFrag(offsetFrags.content[4]);
      const cursor = testData.inFrag(offset);
      const result = shuntOut(testData, cursor);

      expect(result).toEqual({
        type: "insertAfter",
        shunted: dew(() => {
          const suffixLength = offsetFrags.suffix.content.length;
          const lengthAfter = afterFrag(offsetFrags.content[4]) - offset;
          return lengthAfter + suffixLength;
        })
      });
    });

    it("should shunt to the top when neither is closer", () => {
      const testData = generateData(3, {
        content: ["Some text.", "  ", "Some text."],
        ...NO_AFFIX
      });

      const offset = insideFrag(testData.content[1]);
      const cursor = testData.inFrag(offset);
      const result = shuntOut(testData, cursor);

      expect(result).toEqual({
        type: "insertBefore",
        // The dead center is in between the two spaces of the 2nd fragment.
        shunted: ("Some text. ").length
      });
    });
  });
  
  describe("toTop mode", () => {
    it("should shunt toward the top even when not closest", () => {
      const offset = insideFrag(offsetFrags.content[4]);
      const cursor = testData.inFrag(offset);
      const result = shuntOut(testData, cursor, "toTop");

      expect(result).toEqual({
        type: "insertBefore",
        shunted: dew(() => {
          const prefixLength = offsetFrags.prefix.content.length;
          const lengthBefore = offset - beforeFrag(offsetFrags.content[0]);
          return prefixLength + lengthBefore;
        })
      });
    });
  });

  describe("toBottom mode", () => {
    it("should shunt toward the bottom even when not closest", () => {
      const offset = insideFrag(offsetFrags.content[0]);
      const cursor = testData.inFrag(offset);
      const result = shuntOut(testData, cursor, "toBottom");

      expect(result).toEqual({
        type: "insertAfter",
        shunted: dew(() => {
          const suffixLength = offsetFrags.suffix.content.length;
          const lengthAfter = afterFrag(offsetFrags.content[4]) - offset;
          return lengthAfter + suffixLength;
        })
      });
    });
  });
});