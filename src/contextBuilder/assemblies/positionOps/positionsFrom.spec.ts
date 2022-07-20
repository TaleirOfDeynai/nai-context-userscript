import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { toFragmentSeq } from "@spec/helpers-splitter";
import { afterFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";

import _zip from "lodash/zip";
import * as IterOps from "@utils/iterables";
import $PositionsFrom from "./positionsFrom";

import type { TextFragment } from "@src/contextBuilder/TextSplitterService";
import { IterDirection } from "./cursorForDir";

/**
 * These represent the expected values for the positions.  The
 * position starting at `0` will be where we expect to see the
 * first result fragment.
 */
type ExpectedSource = Array<[number, string]>;

const buildExpected = (direction: IterDirection, input: ExpectedSource) => {
  const assemblyText = input.map(([, text]) => text).join("");
  const testData = generateData(0, { ...NO_AFFIX, content: [assemblyText] });

  const expected = IterOps.chain(input)
    .thru((iter) => {
      const positions = iter.map(([pos]) => pos);
      const frags = toFragmentSeq(iter.map(([, text]) => text), 0);
      return _zip(positions, frags) as Iterable<[number, TextFragment]>;
    })
    .thru((iter) => direction === "toTop" ? IterOps.iterReverse(iter) : iter)
    .pipe(IterOps.skipUntil, ([pos]) => pos >= 0)
    .map(([, frag]) => testData.inFrag(beforeFrag(frag)))
    .toArray();

  return { testData, expected };
};

describe("positionsFrom", () => {
  const { positionsFrom } = $PositionsFrom(fakeRequire);

  it("should work from top-to-bottom, from start", () => {
    const { testData, expected } = buildExpected("toBottom", [
      [0, "Line one, sentence one.  "],
      [1, "Sentence two.\n"],
      [2, "Line two, sentence three.\n"],
      [3, "\n"],
      [4, "\n"],
      [5, "Line five, sentence four.  "],
      [6, "Sentence five.  "],
      [7, "Sentence six."]
    ]);

    const offset = beforeFrag(testData.content[0]);
    const cursor = testData.inFrag(offset);
    const actual = positionsFrom(testData, cursor, "sentence", "toBottom");

    expect([...actual]).toEqual(expected);
  });

  it("should work from top-to-bottom, from cursor", () => {
    // With `"toBottom"`, the fragment containing the cursor is not included.
    // The offset of that fragment will be before the cursor.
    const { testData, expected } = buildExpected("toBottom", [
      [-3, "Line one, sentence one.  "],
      [-2, "Sentence two.\n"],
      [-1, "Line two, sentence three.\n"],
      [0, "\n"],
      [1, "\n"],
      [2, "Line five, sentence four.  "],
      [3, "Sentence five.  "],
      [4, "Sentence six."]
    ]);

    // Relative to the `"three"` in the third sentence.
    const offset = testData.content[0].content.indexOf("three");
    const cursor = testData.inFrag(offset);
    const actual = positionsFrom(testData, cursor, "sentence", "toBottom");

    expect([...actual]).toEqual(expected);
  });

  it("should work from bottom-to-top, from end", () => {
    const { testData, expected } = buildExpected("toTop", [
      [7, "Line one, sentence one.  "],
      [6, "Sentence two.\n"],
      [5, "Line two, sentence three.\n"],
      [4, "\n"],
      [3, "\n"],
      [2, "Line five, sentence four.  "],
      [1, "Sentence five.  "],
      [0, "Sentence six."]
    ]);

    const offset = afterFrag(testData.content[0]);
    const cursor = testData.inFrag(offset);
    const actual = positionsFrom(testData, cursor, "sentence", "toTop");

    expect([...actual]).toEqual(expected);
  });

  it("should work from bottom-to-top, from cursor", () => {
    // With `"toTop"`, the fragment containing the cursor is included.
    // Going toward the top, that position will be crossed.
    const { testData, expected } = buildExpected("toTop",[
      [5, "Line one, sentence one.  "],
      [4, "Sentence two.\n"],
      [3, "Line two, sentence three.\n"],
      [2, "\n"],
      [1, "\n"],
      [0, "Line five, sentence four.  "],
      [-1, "Sentence five.  "],
      [-2, "Sentence six."]
    ]);

    // Relative to the `"four"` in the fourth sentence.
    const offset = testData.content[0].content.indexOf("four") + "four".length;
    const cursor = testData.inFrag(offset);
    const actual = positionsFrom(testData, cursor, "sentence", "toTop");

    expect([...actual]).toEqual(expected);
  });
});