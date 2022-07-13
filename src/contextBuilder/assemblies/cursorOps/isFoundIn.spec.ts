import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { insideFrag } from "@spec/helpers-assembly";
import { contiguousFrags, offsetFrags } from "@spec/helpers-assembly";

import _pullAt from "lodash/pullAt";
import $IsFoundIn from "./isFoundIn";

const { isFoundIn } = $IsFoundIn(fakeRequire);

describe("isFoundIn", () => {
  const testData = offsetFrags;

  it.failing("should FAIL if cursor is for full-text", () => {
    isFoundIn(testData, testData.inText(10) as any);
  });

  it.failing("should FAIL if cursor is for unrelated assembly", () => {
    const foreignData = {
      ...contiguousFrags,
      content: [],
      source: contiguousFrags
    };

    isFoundIn(testData, foreignData.inFrag(10));
  });

  it("should identify cursor in prefix", () => {
    const offset = insideFrag(testData.prefix);
    const cursor = testData.inFrag(offset);

    expect(isFoundIn(testData, cursor)).toBe(true);
  });

  it("should identify cursor in suffix", () => {
    const offset = insideFrag(testData.suffix);
    const cursor = testData.inFrag(offset);

    expect(isFoundIn(testData, cursor)).toBe(true);
  });

  it("should identify cursor in any content", () => {
    const offset = insideFrag(testData.content[2]);
    const cursor = testData.inFrag(offset);

    expect(isFoundIn(testData, cursor)).toBe(true);
  });

  it("should not identify a cursor in missing content", () => {
    const childData = {
      ...testData,
      content: [
        // Dropping indices 2 and 3.
        ...testData.content.slice(0, 2),
        ...testData.content.slice(-1),
      ],
      source: testData
    };

    const offset = insideFrag(testData.content[2]);
    const cursor = testData.inFrag(offset);

    expect(isFoundIn(childData, cursor)).toBe(false);
  });
});