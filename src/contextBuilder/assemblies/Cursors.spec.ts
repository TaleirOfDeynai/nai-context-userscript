import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockFragment } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { mockStory } from "@spec/mock-story";

import { dew } from "@utils/dew";
import $Cursors from "./Cursors";

import type { MatchResult } from "../MatcherService";
import type { IFragmentAssembly } from "./Fragment";

const mockOrigin: IFragmentAssembly = dew(() => {
  const prefix = mockFragment("", 0);
  const content = [mockFragment(mockStory, 10)];
  const suffix = mockFragment("", mockStory.length + 20);

  return Object.freeze({ prefix, content, suffix });
})

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

  it("should convert the cursor if it is a full-text cursor", () => {
    const cursor = mockCursor(30, "fullText", mockOrigin);
    expect(asFragmentCursor(cursor)).toEqual({
      type: "fragment",
      offset: 40,
      origin: mockOrigin
    });
  });
});

describe("toSelection", () => {
  const { toSelection } = $Cursors(fakeRequire);

  it("should convert from an assembly match", () => {
    const mockMatch: MatchResult = Object.freeze({
      match: mockStory.slice(30, 40),
      groups: Object.freeze([]),
      namedGroups: Object.freeze({}),
      index: 40,
      length: 10
    });
    const result = toSelection(mockMatch, mockOrigin, "fragment");

    expect(result).toEqual([
      mockCursor(40, "fragment", mockOrigin),
      mockCursor(50, "fragment", mockOrigin)
    ]);
  });

  it("should convert from a full-text match", () => {
    const mockMatch: MatchResult = Object.freeze({
      match: mockStory.slice(30, 40),
      groups: Object.freeze([]),
      namedGroups: Object.freeze({}),
      index: 30,
      length: 10
    });
    const result = toSelection(mockMatch, mockOrigin, "fullText");

    expect(result).toEqual([
      mockCursor(40, "fragment", mockOrigin),
      mockCursor(50, "fragment", mockOrigin)
    ]);
  });

  it("should return an identical cursor instance for a zero-length match", () => {
    const zeroMatch: MatchResult = Object.freeze({
      match: "",
      groups: Object.freeze([]),
      namedGroups: Object.freeze({}),
      index: 30,
      length: 0
    });

    const result = toSelection(zeroMatch, mockOrigin, "fragment");
    expect(result[0]).toEqual(mockCursor(30, "fragment", mockOrigin));
    expect(result[0]).toBe(result[1]);
  });
});