import { describe, it, expect } from "@jest/globals";
import { mockFragment } from "@spec/helpers-splitter";
import { afterFrag } from "@spec/helpers-assembly";
import { SpecAssembly } from "./_common";

import type { IFragmentAssembly } from "../assemblies/Fragment";

describe("FragmentAssembly", () => {

  describe("construction", () => {
    it("should throw if given a `source` that is not a source assembly", () => {
      const trial = () => {
        const prefixFrag = mockFragment("", 0);
        const contentFrag = mockFragment("This is content.", afterFrag(prefixFrag));
        const suffixFrag = mockFragment("", afterFrag(contentFrag));
        return new SpecAssembly(
          prefixFrag, [contentFrag], suffixFrag,
          true,
          { source: {} } as IFragmentAssembly
        );
      };

      expect(trial).toThrow("Expected `source` to be a source assembly.");
    });

    it("should throw if given a `prefix` that is not at offset `0`", () => {
      const trial = () => {
        const prefixFrag = mockFragment("", 10);
        const contentFrag = mockFragment("This is content.", afterFrag(prefixFrag));
        const suffixFrag = mockFragment("", afterFrag(contentFrag));
        return new SpecAssembly(
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
        return new SpecAssembly(
          prefixFrag, [firstFrag, secondFrag], suffixFrag,
          true,
          null
        );
      };

      expect(trial).toThrow("Expected content to contain only non-empty fragments.");
    });
  });
});