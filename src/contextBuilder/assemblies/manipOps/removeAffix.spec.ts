import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { getEmptyFrag } from "@spec/helpers-splitter";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";
import { contiguousFrags } from "@spec/helpers-assembly";

import $RemoveAffix from "./removeAffix";

describe("removeAffix", () => {
  const { removeAffix } = $RemoveAffix(fakeRequire);

  it("should create a new assembly with prefix/suffix removed", () => {
    const testData = contiguousFrags;
    const result = removeAffix(testData);

    expect(result).not.toBe(testData);
    expect(result.prefix).not.toEqual(testData.prefix);
    expect(result.suffix).not.toEqual(testData.suffix);

    expect(result.prefix).toEqual(getEmptyFrag(testData.prefix));
    expect(result.suffix).toEqual(getEmptyFrag(testData.suffix));
  });

  it("should return the same instance if no change is needed", () => {
    const testData = generateData(0, NO_AFFIX);
    const result = removeAffix(testData);

    expect(result).toBe(testData);
  });

  it("should reuse the prefix fragment if it is empty", () => {
    const testData = generateData(0, { prefix: "" });
    const result = removeAffix(testData);

    expect(result.prefix).toBe(testData.prefix);
  });

  it("should reuse the suffix fragment if it is empty", () => {
    const testData = generateData(0, { suffix: "" });
    const result = removeAffix(testData);

    expect(result.suffix).toBe(testData.suffix);
  });
});