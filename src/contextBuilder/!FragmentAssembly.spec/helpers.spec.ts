import { jest, describe, it, expect } from "@jest/globals";
import { afterEach } from "@jest/globals";
import { mockFragment } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, beforeFrag } from "@spec/helpers-assembly";
import { offsetFrags } from "@spec/helpers-assembly";
import { Module } from "./_common";

import type { AnyCursor } from "../FragmentAssembly";
import type { MatchResult } from "../MatcherService";

describe("isCursorInside", () => {
  const { isCursorInside } = Module;

  const fragment = mockFragment("0123456789", 10);

  it("should know when a cursor is inside a fragment", () => {
    const result = isCursorInside(mockCursor(13), fragment);
    expect(result).toBe(true);
  });

  it("should accept the start position as inside", () => {
    const result = isCursorInside(mockCursor(10), fragment);
    expect(result).toBe(true);
  });

  it("should accept the end position as inside", () => {
    const result = isCursorInside(mockCursor(20), fragment);
    expect(result).toBe(true);
  });

  it("should not accept any other position as inside", () => {
    const before = isCursorInside(mockCursor(9), fragment);
    expect(before).toBe(false);

    const after = isCursorInside(mockCursor(21), fragment);
    expect(after).toBe(false);
  });
});

describe("asFragmentCursor", () => {
  const { asFragmentCursor } = Module;

  // This relies heavily on `FragmentAssembly.fromFullText`.
  // We're only going to test that it attempts the conversion when
  // it is necessary, so we're not double-testing.

  it("should return the cursor as-is when already an fragment cursor", () => {
    const cursor = mockCursor(10, "fragment");
    expect(asFragmentCursor(cursor)).toBe(cursor);
  });

  it("should attempt to convert the cursor if it is a full-text cursor", () => {
    // We only need this function to test.
    const mockOrigin = { fromFullText: jest.fn() };
    const cursor = mockCursor(30, "fullText", mockOrigin);

    asFragmentCursor(cursor);
    expect(mockOrigin.fromFullText).toHaveBeenCalledWith(cursor);
  });
});

describe("toSelection", () => {
  const { toSelection } = Module;

  // This makes calls out to `asFragmentCursor` to handle the conversion
  // when the `type` argument is `"fullText"`.  We'll just use a spoof'd
  // implementation of `FragmentAssembly.fromFullText` to fake a conversion
  // in a detectable way.

  const mockOrigin = {
    fromFullText: jest.fn((cursor: AnyCursor) => {
      return mockCursor(cursor.offset + 10, "fragment", cursor.origin);
    })
  };

  afterEach(() => {
    mockOrigin.fromFullText.mockClear()
  });

  const mockMatch: MatchResult = Object.freeze({
    match: "foo",
    groups: Object.freeze([]),
    namedGroups: Object.freeze({}),
    index: 30,
    length: 3
  });

  it("should convert from an assembly match", () => {
    const result = toSelection(mockMatch, mockOrigin as any, "fragment");
    expect(result).toEqual([
      mockCursor(30, "fragment", mockOrigin),
      mockCursor(33, "fragment", mockOrigin)
    ]);

    expect(mockOrigin.fromFullText).not.toHaveBeenCalled();
  });

  it("should convert from a full-text match", () => {
    const result = toSelection(mockMatch, mockOrigin as any, "fullText");
    expect(result).toEqual([
      mockCursor(40, "fragment", mockOrigin),
      mockCursor(43, "fragment", mockOrigin)
    ]);

    expect(mockOrigin.fromFullText).toHaveBeenCalledTimes(2);
  });

  it("should return an identical cursor instance for a zero-length match", () => {
    const zeroMatch: MatchResult = Object.freeze({
      match: "",
      groups: Object.freeze([]),
      namedGroups: Object.freeze({}),
      index: 30,
      length: 0
    });

    const result = toSelection(zeroMatch, mockOrigin as any, "fragment");
    expect(result[0]).toEqual(mockCursor(30, "fragment", mockOrigin));
    expect(result[0]).toBe(result[1]);
  });
});

describe("getStats", () => {
  const { getStats } = Module;

  // This is just a simple convenience function for a few common
  // operations used to inspect a collection of fragments.
  // We'll test all the individual stats in aggregate.

  it("should determine the expected stats (in order)", () => {
    const fragments = [
      mockFragment("foo", 10),
      mockFragment("bar", 13)
    ];

    const result = getStats(fragments);

    expect(result).toEqual({
      minOffset: 10,
      maxOffset: 16,
      impliedLength: 6,
      concatLength: 6
    });
  });

  it("should determine the expected stats (with gaps)", () => {
    const fragments = [
      mockFragment("foo", 10),
      mockFragment("bar", 20)
    ];

    const result = getStats(fragments);

    expect(result).toEqual({
      minOffset: 10,
      maxOffset: 23,
      impliedLength: 13,
      concatLength: 6
    });
  });

  it("should determine the expected stats (out of order & with gaps)", () => {
    const fragments = [
      mockFragment("bar", 20),
      mockFragment("foo", 10)
    ];

    const result = getStats(fragments);

    expect(result).toEqual({
      minOffset: 10,
      maxOffset: 23,
      impliedLength: 13,
      concatLength: 6
    });
  });

  it("should assume `0` offset when fragments is empty", () => {
    const result = getStats([]);

    expect(result).toEqual({
      minOffset: 0,
      maxOffset: 0,
      impliedLength: 0,
      concatLength: 0
    });
  });

  it("should use `emptyOffset` param when fragments is empty", () => {
    const result = getStats([], 15);

    expect(result).toEqual({
      minOffset: 15,
      maxOffset: 15,
      impliedLength: 0,
      concatLength: 0
    });
  });
});

describe("splitSequenceAt", () => {
  const { splitSequenceAt } = Module;

  // All of these are doing slice in the fragment with the text:
  // "This is the second fragment."

  it("should be able to split before a fragment", () => {
    const offset = beforeFrag(offsetFrags.content[2]);
    const cursor = mockCursor(offset, "fragment");
    const [left, right] = splitSequenceAt(offsetFrags.content, cursor);

    expect(left).toEqual(offsetFrags.content.slice(0, 2));
    expect(right).toEqual(offsetFrags.content.slice(2));
  });

  it("should be able to split after a fragment", () => {
    const offset = afterFrag(offsetFrags.content[2]);
    const cursor = mockCursor(offset, "fragment");
    const [left, right] = splitSequenceAt(offsetFrags.content, cursor);

    expect(left).toEqual(offsetFrags.content.slice(0, 3));
    expect(right).toEqual(offsetFrags.content.slice(3));
  });

  it("should be able to split inside a fragment", () => {
    const sliceOffset = ("This is the").length;
    const slicedFrag = offsetFrags.content[2];
    const offset = beforeFrag(slicedFrag) + sliceOffset;
    const cursor = mockCursor(offset, "fragment");
    const [left, right] = splitSequenceAt(offsetFrags.content, cursor);

    expect(left).toEqual([
      ...offsetFrags.content.slice(0, 2),
      mockFragment("This is the", 0, slicedFrag)
    ]);
    expect(right).toEqual([
      mockFragment(" second fragment.", sliceOffset, slicedFrag),
      ...offsetFrags.content.slice(3)
    ]);
  });
});