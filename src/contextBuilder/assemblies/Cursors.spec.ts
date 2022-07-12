import { jest, describe, it, expect } from "@jest/globals";
import { afterEach } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockFragment } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";

import $Cursors from "./Cursors";

import type { Cursor } from "../assemblies/Cursors";
import type { MatchResult } from "../MatcherService";

describe("isCursorInside", () => {
  const { isCursorInside } = $Cursors(fakeRequire);

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
  const { asFragmentCursor } = $Cursors(fakeRequire);

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
  const { toSelection } = $Cursors(fakeRequire);

  // This makes calls out to `asFragmentCursor` to handle the conversion
  // when the `type` argument is `"fullText"`.  We'll just use a spoof'd
  // implementation of `FragmentAssembly.fromFullText` to fake a conversion
  // in a detectable way.

  const mockOrigin = {
    fromFullText: jest.fn((cursor: Cursor.Any) => {
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