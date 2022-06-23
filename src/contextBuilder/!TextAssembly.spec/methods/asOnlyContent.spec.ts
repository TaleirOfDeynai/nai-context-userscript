import { describe, it, expect } from "@jest/globals";
import { getEmptyFrag } from "@spec/helpers-splitter";
import { generateData, initAssembly, NO_AFFIX } from "../_common";
import { offsetFrags } from "../_common";

describe("TextAssembly", () => {
  describe("manipulation methods", () => {
    describe("asOnlyContent", () => {
      it("should create a new assembly with prefix/suffix removed", () => {
        const testAssembly = initAssembly(offsetFrags);

        const result = testAssembly.asOnlyContent();

        expect(result).not.toBe(testAssembly);
        expect(result.prefix).not.toEqual(testAssembly.prefix);
        expect(result.suffix).not.toEqual(testAssembly.suffix);

        expect(result.prefix).toEqual(getEmptyFrag(testAssembly.prefix));
        expect(result.suffix).toEqual(getEmptyFrag(testAssembly.suffix));
      });

      it("should return the same instance if no change is needed", () => {
        const assemblyData = generateData(0, NO_AFFIX);
        const testAssembly = initAssembly(assemblyData);

        const result = testAssembly.asOnlyContent();

        expect(result).toBe(testAssembly);
      });

      it("should reuse the prefix fragment if it is empty", () => {
        const assemblyData = generateData(0, { prefix: "" });
        const testAssembly = initAssembly(assemblyData);

        const result = testAssembly.asOnlyContent();

        expect(result.prefix).toBe(testAssembly.prefix);
      });

      it("should reuse the suffix fragment if it is empty", () => {
        const assemblyData = generateData(0, { suffix: "" });
        const testAssembly = initAssembly(assemblyData);

        const result = testAssembly.asOnlyContent();

        expect(result.suffix).toBe(testAssembly.suffix);
      });
    });
  });
});