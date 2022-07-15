import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { getEmptyFrag } from "@spec/helpers-splitter";
import { offsetFrags } from "@spec/helpers-assembly";

import $GetAffixForSplit from "./getAffixForSplit";

describe("splitSequenceAt", () => {
  const { getAffixForSplit } = $GetAffixForSplit(fakeRequire);

  describe("basic functionality", () => {
    const testData = offsetFrags;

    describe("for the before result", () => {
      it("should return the same prefix", () => {
        const [{ prefix }, _] = getAffixForSplit(testData);
    
        expect(prefix).toBe(testData.prefix);
      });
  
      it("should return an empty suffix", () => {
        const [{ suffix }, _] = getAffixForSplit(testData);
    
        expect(suffix).not.toEqual(testData.suffix);
        expect(suffix).toEqual(getEmptyFrag(testData.suffix));
      });
    });
    
    describe("for the after result", () => {
      it("should return an empty prefix", () => {
        const [_, { prefix }] = getAffixForSplit(testData);
  
        expect(prefix).not.toEqual(testData.prefix);
        expect(prefix).toEqual(getEmptyFrag(testData.prefix));
      });
  
      it("should return the same suffix", () => {
        const [_, { suffix }] = getAffixForSplit(testData);
  
        expect(suffix).toBe(testData.suffix);
      });
    });
  });

  describe("when prefix is empty", () => {
    const testData = { ...offsetFrags, prefix: getEmptyFrag(offsetFrags.prefix) };

    it("should reuse the prefix in both results", () => {
      const [before, after] = getAffixForSplit(testData);

      expect(before.prefix).toBe(testData.prefix);
      expect(after.prefix).toBe(testData.prefix);
    });
  });

  describe("when suffix is empty", () => {
    const testData = { ...offsetFrags, suffix: getEmptyFrag(offsetFrags.suffix) };

    it("should reuse the suffix in both results", () => {
      const [before, after] = getAffixForSplit(testData);

      expect(before.suffix).toBe(testData.suffix);
      expect(after.suffix).toBe(testData.suffix);
    });
  });
});