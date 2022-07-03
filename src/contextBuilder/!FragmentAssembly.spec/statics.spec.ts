import { describe, it, expect } from "@jest/globals";
import { Module } from "./_common";

import type { FragmentAssembly } from "../FragmentAssembly";

describe("FragmentAssembly", () => {
  const { FragmentAssembly } = Module;

  describe("static methods", () => {
    describe("checkRelated", () => {
      // This just uses referential equality on the `source` property.

      const fooOrigin = {};
      const fooAssembly1 = { source: fooOrigin } as FragmentAssembly;
      const fooAssembly2 = { source: fooOrigin } as FragmentAssembly;

      const barOrigin = {};
      const barAssembly = { source: barOrigin } as FragmentAssembly;

      it("should indicate when two assemblies are related", () => {
        const result = FragmentAssembly.checkRelated(fooAssembly1, fooAssembly2);

        expect(result).toBe(true);
      });

      it("should indicate when two assemblies are not related", () => {
        const result = FragmentAssembly.checkRelated(fooAssembly1, barAssembly);

        expect(result).toBe(false);
      });
    });
  });
});