import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { toContent } from "@spec/helpers-splitter";
import { afterFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";
import { offsetFrags } from "@spec/helpers-assembly";

import { first, last } from "@utils/iterables";
import $TheStats from "./theStats";

describe("getStats", () => {
  const { getStats } = $TheStats(fakeRequire);

  it("should use all fragments to build stats", () => {
    const testData = offsetFrags;

    const allFrags = [testData.prefix, ...testData.content, testData.suffix];
    const totalLength = allFrags.map(toContent).reduce((a, c) => a + c.length, 0);
    const minOffset = beforeFrag(testData.prefix);
    const maxOffset = afterFrag(testData.suffix);

    expect(getStats(testData)).toEqual({
      minOffset, maxOffset,
      impliedLength: maxOffset - minOffset,
      concatLength: totalLength
    });
  });

  it("should defer to the `stats` property when present", () => {
    const testData = {
      ...offsetFrags,
      stats: {} as any
    };

    expect(getStats(testData)).toBe(testData.stats);
  });

  it("should defer to `getContentStats` when un-affixed", () => {
    const testData = {
      ...generateData(15, NO_AFFIX),
      contentStats: {} as any
    };

    // `getContentStats` will return the `contentStats` property if
    // it was called (unless that test is failing, I guess).
    expect(getStats(testData)).toBe(testData.contentStats);
  });
});

describe("getContentStats", () => {
  const { getContentStats } = $TheStats(fakeRequire);

  it("should use only the content fragments to build stats", () => {
    const testData = offsetFrags;

    const { content } = testData;
    const totalLength = content.map(toContent).reduce((a, c) => a + c.length, 0);

    expect(getContentStats(testData)).toEqual({
      minOffset: beforeFrag(first(content)),
      maxOffset: afterFrag(last(content)),
      impliedLength: totalLength,
      concatLength: totalLength
    });
  });

  it("should offset after the prefix when empty", () => {
    const testData = { ...offsetFrags, content: [] };

    expect(getContentStats(testData)).toEqual({
      minOffset: afterFrag(offsetFrags.prefix),
      maxOffset: afterFrag(offsetFrags.prefix),
      impliedLength: 0,
      concatLength: 0
    });
  });

  it("should defer to the `contentStats` property when present", () => {
    const testData = {
      ...offsetFrags,
      contentStats: {} as any
    };

    expect(getContentStats(testData)).toBe(testData.contentStats);
  });
});