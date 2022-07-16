import { describe, it, expect } from "@jest/globals";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";

import { iterReverse } from "@utils/iterables";
import * as theBasics from "./theBasics";

import type { IFragmentAssembly } from "../_interfaces";

describe("iterateOn", () => {
  describe("in order", () => {
    it("should iterate through all fragments (no affixing)", () => {
      const testData = generateData(3, NO_AFFIX);
      const result = [...theBasics.iterateOn(testData, false)];

      expect(result).toEqual(testData.content);
    });

    it("should iterate through all fragments (with affixing)", () => {
      const testData = generateData(3);
      const result = [...theBasics.iterateOn(testData, false)];

      expect(result).toEqual([
        testData.prefix,
        ...testData.content,
        testData.suffix
      ]);
    });
  });

  describe("in reverse", () => {
    it("should iterate through all fragments (no affixing)", () => {
      const testData = generateData(3, NO_AFFIX);
      const result = [...theBasics.iterateOn(testData, true)];

      expect(result).toEqual([...iterReverse(testData.content)]);
    });

    it("should iterate through all fragments (with affixing)", () => {
      const testData = generateData(3);
      const result = [...theBasics.iterateOn(testData, true)];

      expect(result).toEqual([
        testData.suffix,
        ...iterReverse(testData.content),
        testData.prefix
      ]);
    });
  });
});

describe("getSource", () => {
  it("should return `source` if it is set", () => {
    const source = {};
    const assembly = { source };

    expect(theBasics.getSource(assembly as any)).toBe(source);
  });

  it("should return the assembly otherwise", () => {
    const assembly = {};

    expect(theBasics.getSource(assembly as any)).toBe(assembly);
  });
});

describe("getText", () => {
  it ("should return the concatenation of the assembly's fragments", () => {
    const withAffix = generateData(3);
    expect(theBasics.getText(withAffix)).toBe(withAffix.getText());

    const noAffix = generateData(3, NO_AFFIX);
    expect(theBasics.getText(noAffix)).toBe(noAffix.getText());
  });
});

describe("checkRelated", () => {
  // This just uses referential equality on the `source` property.

  const fooOrigin = {};
  const fooAssembly1 = { source: fooOrigin } as IFragmentAssembly;
  const fooAssembly2 = { source: fooOrigin } as IFragmentAssembly;

  const barOrigin = {};
  const barAssembly = { source: barOrigin } as IFragmentAssembly;

  it("should indicate when two assemblies are related", () => {
    const result = theBasics.checkRelated(fooAssembly1, fooAssembly2);

    expect(result).toBe(true);
  });

  it("should indicate when two assemblies are not related", () => {
    const result = theBasics.checkRelated(fooAssembly1, barAssembly);

    expect(result).toBe(false);
  });
});

describe("isAffixed", () => {
  it("should indicate when the assembly has a prefix", () => {
    const assembly = generateData(3, { prefix: "foo", suffix: "" });
    expect(theBasics.isAffixed(assembly)).toBe(true);
  });

  it("should indicate when the assembly has a suffix", () => {
    const assembly = generateData(3, { prefix: "", suffix: "foo" });
    expect(theBasics.isAffixed(assembly)).toBe(true);
  });

  it("should indicate when the assembly has neither prefix nor suffix", () => {
    const assembly = generateData(3, NO_AFFIX);
    expect(theBasics.isAffixed(assembly)).toBe(false);
  });
});

describe("isEmpty", () => {
  it("should indicate when the assembly is not empty", () => {
    const assembly = generateData(3);

    expect(theBasics.isEmpty(assembly)).toBe(false);
  });

  it("should indicate when the assembly is empty", () => {
    const assembly = generateData(0, { ...NO_AFFIX, content: [] });

    expect(theBasics.isEmpty(assembly)).toBe(true);
  });
});

describe("isSource", () => {
  it("should indicate `true` with no source property", () => {
    const assembly = {};

    expect(theBasics.isSource(assembly as any)).toBe(true);
  });

  it("should indicate `true` with itself as the source property", () => {
    const assembly = {
      get source() {
        return this;
      }
    };

    expect(theBasics.isSource(assembly as any)).toBe(true);
  });

  it("should indicate `false` when the source is not the assembly", () => {
    const assembly = { source: {} };

    expect(theBasics.isSource(assembly as any)).toBe(false);
  });
});