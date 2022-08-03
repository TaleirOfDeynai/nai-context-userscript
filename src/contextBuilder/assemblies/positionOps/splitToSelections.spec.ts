import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { offsetFrags } from "@spec/helpers-assembly";

import { isNumber, isString } from "@utils/is";
import { chain, first, last, scan } from "@utils/iterables";
import $SplitToSelections from "./splitToSelections";

import type { AssemblyData } from "@spec/helpers-assembly";
import type { SplitSelection } from "./splitToSelections";

const { splitToSelections } = $SplitToSelections(fakeRequire);

/**
 * The `parts` array has the expected strings, but a number can be
 * used to shift the cursor in different ways:
 * - A positive number will move the preceding part's end cursor
 *   forward by that amount.
 * - A negative number will move the following part's end cursor
 *   forward by the absolute value of that amount.
 * 
 * This let's us deal with the behavior of assemblies where they
 * like to prefer cursors with offsets in the content.
 */
const toExpected = (assembly: AssemblyData, parts: Array<string | number>) => {
  const result: SplitSelection[] = [];

  const isShiftBack = (v: string | number): v is number => isNumber(v) && v <= 0;
  const isShiftUp = (v: string | number): v is number => isNumber(v) && v >= 0;

  const withOffsets = chain(parts)
    .prependVal(0)
    .appendVal(0)
    .thru((iter) => scan(iter, 3))
    .collect(([l, part, r]) => {
      if (!isString(part)) return undefined;

      const back = isShiftBack(l) ? Math.abs(l) : 0;
      const up = isShiftUp(r) ? Math.abs(r) : 0;
      return { content: part, offset: back + up };
    })
    .value();

  for (const part of withOffsets) {
    const { content, offset } = part;
    const baseOffset = last(result)?.selection[1].offset ?? 0;
    
    const start = assembly.inFrag(baseOffset);
    const end = assembly.inFrag(baseOffset + content.length + offset);
    result.push({ content, selection: [start, end] });
  }

  return result;
};

const middleSel = ({ selection }: SplitSelection) =>
  Math.floor((selection[0].offset + selection[1].offset) / 2);

describe("splitToSelections", () => {
  describe("basic functionality", () => {
    it("should split into fragments of the desired granularity (newline)", () => {
      const result = [...splitToSelections(offsetFrags, "newline", "toBottom")];

      expect(result).toEqual(toExpected(offsetFrags, [
        "PREFIX", "\n", 3,
        "This is the first fragment.",
        "\n",
        "This is the second fragment.  This is the third fragment.",
        -3, "\n", "SUFFIX"
      ]));
    });

    it("should split into fragments of the desired granularity (sentence)", () => {
      const result = [...splitToSelections(offsetFrags, "sentence", "toBottom")];

      expect(result).toEqual(toExpected(offsetFrags, [
        "PREFIX", "\n", 3,
        "This is the first fragment.",
        "\n",
        "This is the second fragment.",
        "  ",
        "This is the third fragment.",
        -3, "\n", "SUFFIX"
      ]));
    });

    it("should split into fragments of the desired granularity (token)", () => {
      const result = [...splitToSelections(offsetFrags, "token", "toBottom")];

      // Only checking through into the second sentence here.
      const expected = toExpected(offsetFrags, [
        "PREFIX", "\n", 3,
        "This", " ", "is", " ", "the", " ", "first", " ", "fragment", ".",
        "\n",
        "This", " ", "is", " ", "the", " ", "second", " ", "fragment", "."
      ]);

      expect(result.slice(0, expected.length)).toEqual(expected);
    });

    // The above tests all checked the "from top to bottom" case.

    it("should iterate from bottom to top (IE: in reverse)", () => {
      const result = [...splitToSelections(offsetFrags, "sentence", "toTop")];

      // Lazily copy and pasted the above and added the `reverse` call.
      expect(result).toEqual(toExpected(offsetFrags, [
        "PREFIX", "\n", 3,
        "This is the first fragment.",
        "\n",
        "This is the second fragment.",
        "  ",
        "This is the third fragment.",
        -3, "\n", "SUFFIX"
      ]).reverse());
    });
  });

  describe("when cursor is inside a fragment", () => {
    const expectedSplit = toExpected(offsetFrags, [
      "PREFIX", "\n", 3,
      "This is the first fragment.", "\n",
      "This is the second fragment.", "  ",
      "This is the third fragment.",
      -3, "\n", "SUFFIX"
    ]);

    // We're going to be starting at the "second fragment".
    const startOffset = middleSel(expectedSplit[4]);

    it("should start at the fragment containing the cursor (to bottom)", () => {
      const cursor = offsetFrags.inFrag(startOffset);
      const result = [...splitToSelections(offsetFrags, "sentence", "toBottom", cursor)];

      expect(result).toEqual(expectedSplit.slice(4));
    });

    it("should start at the fragment containing the cursor (to top)", () => {
      const cursor = offsetFrags.inFrag(startOffset);
      const result = [...splitToSelections(offsetFrags, "sentence", "toTop", cursor)];

      expect(result).toEqual(expectedSplit.slice(0, 5).reverse());
    });
  });

  describe("when cursor at fragment boundary", () => {
    const expectedSplit = toExpected(offsetFrags, [
      "PREFIX", "\n", 3,
      "This is the first fragment.", "\n",
      "This is the second fragment.", "  ",
      "This is the third fragment.",
      -3, "\n", "SUFFIX"
    ]);

    it("should start at earliest fragment (to bottom)", () => {
      const offset = expectedSplit[4].selection[1].offset;
      const cursor = offsetFrags.inFrag(offset);
      const result = [...splitToSelections(offsetFrags, "sentence", "toBottom", cursor)];

      expect(first(result)?.content).toEqual(offsetFrags.content[2].content);
    });

    it("should start at latest fragment (to top)", () => {
      const offset = expectedSplit[4].selection[0].offset;
      const cursor = offsetFrags.inFrag(offset);
      const result = [...splitToSelections(offsetFrags, "sentence", "toTop", cursor)];

      // Still `first`, because this iterates in reverse.
      expect(first(result)?.content).toEqual(offsetFrags.content[2].content);
    });
  });
});