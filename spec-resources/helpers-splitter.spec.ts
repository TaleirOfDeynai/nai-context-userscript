import { describe, it, expect } from "@jest/globals";

import * as helpers from "./helpers-splitter";
import type { TextFragment } from "@src/contextBuilder/TextSplitterService";

describe("sanity checks for helpers-splitter", () => {
  const input = Object.freeze(["Foo.", "Bar!"]);

  it("mockFragment", () => {
    expect(helpers.mockFragment("foo", 10))
      .toEqual({ content: "foo", offset: 10 });
    expect(helpers.mockFragment("bar", 10, { offset: 100 } as any))
      .toEqual({ content: "bar", offset: 110});
  });

  it("forSingleLine", () => {
    expect(helpers.forSingleLine(input)).toEqual(["Foo.", "Bar!", "Foo."]);
  });

  it("forManyLines", () => {
    expect(helpers.forManyLines(input)).toEqual([
      ["Foo.", "Bar!"],
      ["Bar!", "Foo."]
    ]);
  });

  it("toFragmentSeq", () => {
    expect(helpers.toFragmentSeq(input, 20)).toEqual([
      { content: "Foo.", offset: 20 },
      { content: "Bar!", offset: 24 }
    ]);
  });

  it("toExpectSeq", () => {
    const theFrag = { content: "Foo.Bar!", offset: 30 } as TextFragment;
    expect(helpers.toExpectSeq(theFrag, input)).toEqual([
      { content: "Foo.", offset: 30 },
      { content: "Bar!", offset: 34 }
    ]);
  });
});