import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockFragment } from "@spec/helpers-splitter";

import $GetStats from "./getStats";

describe("getStats", () => {
  const { getStats } = $GetStats(fakeRequire);

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