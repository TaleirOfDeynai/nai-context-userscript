import { describe, it, expect } from "@jest/globals";
import { mockFragment } from "@spec/helpers-splitter";
import { afterFrag } from "@spec/helpers-assembly";
import { Module } from "./_common";

import type { TextAssembly } from "../TextAssembly";

describe("TextAssembly", () => {
  const { TextAssembly } = Module;

  describe("construction", () => {
    it("should throw if given a `source` that is not a source assembly", () => {
      const trial = () => {
        const prefixFrag = mockFragment("", 0);
        const contentFrag = mockFragment("This is content.", afterFrag(prefixFrag));
        const suffixFrag = mockFragment("", afterFrag(contentFrag));
        return new TextAssembly(
          prefixFrag, [contentFrag], suffixFrag,
          true,
          { isSource: false } as TextAssembly
        );
      };

      expect(trial).toThrow("Expected `source` to be a source assembly.");
    });

    it("should throw if given a `prefix` that is not at offset `0`", () => {
      const trial = () => {
        const prefixFrag = mockFragment("", 10);
        const contentFrag = mockFragment("This is content.", afterFrag(prefixFrag));
        const suffixFrag = mockFragment("", afterFrag(contentFrag));
        return new TextAssembly(
          prefixFrag, [contentFrag], suffixFrag,
          true,
          null
        );
      };

      expect(trial).toThrow("Expected prefix's offset to be 0.");
    });

    // This only happens when debug logging or running in a test environment.
    it("should throw if `content` contains any empty fragments", () => {
      const trial = () => {
        const prefixFrag = mockFragment("", 0);
        const firstFrag = mockFragment("", afterFrag(prefixFrag));
        const secondFrag = mockFragment("This is content.", afterFrag(firstFrag));
        const suffixFrag = mockFragment("", afterFrag(secondFrag));
        return new TextAssembly(
          prefixFrag, [firstFrag, secondFrag], suffixFrag,
          true,
          null
        );
      };

      expect(trial).toThrow("Expected content to contain only non-empty fragments.");
    });
  });
});