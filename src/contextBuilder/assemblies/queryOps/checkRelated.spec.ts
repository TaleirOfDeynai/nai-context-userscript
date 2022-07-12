import { describe, it, expect } from "@jest/globals";
import checkRelated from "./checkRelated";

import type { IFragmentAssembly } from "../Fragment";

describe("checkRelated", () => {
  // This just uses referential equality on the `source` property.

  const fooOrigin = {};
  const fooAssembly1 = { source: fooOrigin } as IFragmentAssembly;
  const fooAssembly2 = { source: fooOrigin } as IFragmentAssembly;

  const barOrigin = {};
  const barAssembly = { source: barOrigin } as IFragmentAssembly;

  it("should indicate when two assemblies are related", () => {
    const result = checkRelated(fooAssembly1, fooAssembly2);

    expect(result).toBe(true);
  });

  it("should indicate when two assemblies are not related", () => {
    const result = checkRelated(fooAssembly1, barAssembly);

    expect(result).toBe(false);
  });
});