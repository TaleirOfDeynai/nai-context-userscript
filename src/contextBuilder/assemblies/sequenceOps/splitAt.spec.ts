import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockFragment } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, beforeFrag } from "@spec/helpers-assembly";
import { offsetFrags } from "@spec/helpers-assembly";

import $SplitAt from "./splitAt";

describe("splitSequenceAt", () => {
  const { splitAt } = $SplitAt(fakeRequire);

  // All of these are doing slice in the fragment with the text:
  // "This is the second fragment."

  it("should be able to split before a fragment", () => {
    const offset = beforeFrag(offsetFrags.content[2]);
    const cursor = mockCursor(offset, "fragment");
    const [left, right] = splitAt(offsetFrags.content, cursor);

    expect(left).toEqual(offsetFrags.content.slice(0, 2));
    expect(right).toEqual(offsetFrags.content.slice(2));
  });

  it("should be able to split after a fragment", () => {
    const offset = afterFrag(offsetFrags.content[2]);
    const cursor = mockCursor(offset, "fragment");
    const [left, right] = splitAt(offsetFrags.content, cursor);

    expect(left).toEqual(offsetFrags.content.slice(0, 3));
    expect(right).toEqual(offsetFrags.content.slice(3));
  });

  it("should be able to split inside a fragment", () => {
    const sliceOffset = ("This is the").length;
    const slicedFrag = offsetFrags.content[2];
    const offset = beforeFrag(slicedFrag) + sliceOffset;
    const cursor = mockCursor(offset, "fragment");
    const [left, right] = splitAt(offsetFrags.content, cursor);

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