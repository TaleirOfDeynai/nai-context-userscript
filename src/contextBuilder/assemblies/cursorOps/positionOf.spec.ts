import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { getEmptyFrag } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";
import { contiguousFrags, offsetFrags } from "@spec/helpers-assembly";

import { first, last } from "@utils/iterables";
import $PositionOf from "./positionOf";

const { positionOf } = $PositionOf(fakeRequire);

describe("positionOf", () => {
  const testData = contiguousFrags;

  it.failing("should FAIL if cursor is for full-text", () => {
    positionOf(testData, testData.inText(10) as any);
  });

  it("should identify unrelated cursors", () => {
    // Relations are determined through referential equality.
    const cursor = mockCursor(10, "fragment", { source: {} });
    const result = positionOf(testData, cursor);

    expect(result).toBe("unrelated");
  });

  it("should identify cursors inside prefix", () => {
    const offset = insideFrag(testData.prefix);
    const cursor = testData.inFrag(offset);
    const result = positionOf(testData, cursor);

    expect(result).toBe("prefix");
  });

  it("should identify cursors inside suffix", () => {
    const offset = insideFrag(testData.suffix);
    const cursor = testData.inFrag(offset);
    const result = positionOf(testData, cursor);

    expect(result).toBe("suffix");
  });

  it("should identify cursors inside any content", () => {
    const firstOffset = insideFrag(first(testData.content));
    const firstCursor = testData.inFrag(firstOffset);
    const firstResult = positionOf(testData, firstCursor);

    expect(firstResult).toBe("content");

    const lastOffset = insideFrag(last(testData.content));
    const lastCursor = testData.inFrag(lastOffset);
    const lastResult = positionOf(testData, lastCursor);

    expect(lastResult).toBe("content");
  });

  it("should favor content when ambiguous with prefix", () => {
    const offset = afterFrag(testData.prefix);
    const cursor = testData.inFrag(offset);
    const result = positionOf(testData, cursor);

    expect(result).toBe("content");
  });

  it("should favor content when ambiguous with suffix", () => {
    const offset = beforeFrag(testData.suffix);
    const cursor = testData.inFrag(offset);
    const result = positionOf(testData, cursor);

    expect(result).toBe("content");
  });

  it("should favor prefix when content is empty and ambiguous with suffix", () => {
    const testData = generateData(0, { ...NO_AFFIX, content: [] });

    // Just to assert that the ambiguity is present for the test.
    const offset = afterFrag(testData.prefix);
    expect(offset).toBe(beforeFrag(testData.suffix));

    const cursor = testData.inFrag(offset);
    const result = positionOf(testData, cursor);

    expect(result).toBe("prefix");
  });

  it("should check against the source's `prefix`", () => {
    const sourceData = offsetFrags;
    const childData = {
      ...sourceData,
      prefix: getEmptyFrag(sourceData.prefix),
      source: sourceData
    };

    const offset = insideFrag(sourceData.prefix);
    const cursor = childData.inFrag(offset);
    const result = positionOf(childData, cursor);

    expect(result).toBe("prefix");
  });

  it("should check against the source's `suffix`", () => {
    const sourceData = offsetFrags;
    const childData = {
      ...sourceData,
      suffix: getEmptyFrag(sourceData.suffix),
      source: sourceData
    };

    const offset = insideFrag(offsetFrags.suffix);
    const cursor = childData.inFrag(offset);
    const result = positionOf(childData, cursor);

    expect(result).toBe("suffix");
  });
});