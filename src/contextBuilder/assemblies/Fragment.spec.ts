import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockStory } from "@spec/mock-story";
import { getEmptyFrag, mockFragment } from "@spec/helpers-splitter";
import { contiguousFrags, offsetFrags } from "@spec/helpers-assembly";

import $FragmentAssembly from "./Fragment";

describe("isInstance", () => {
  const { isInstance, castTo } = $FragmentAssembly(fakeRequire);

  it("should return true for an instance", () => {
    const assembly = castTo(offsetFrags);
    expect(isInstance(assembly)).toBe(true);
  });

  it("should return false for a non-instance", () => {
    expect(isInstance(offsetFrags)).toBe(false);
  });
});

describe("castTo", () => {
  const { castTo, isInstance } = $FragmentAssembly(fakeRequire);

  it("should wrap a plain object assembly", () => {
    const testData = offsetFrags;
    const result = castTo(offsetFrags);

    expect(result).not.toBe(testData);
    expect(isInstance(result)).toBe(true);
  });

  it("should return the same instance for an instance", () => {
    const assembly = castTo(offsetFrags);
    expect(castTo(assembly)).toBe(assembly);
  });
});

describe("fromSource", () => {
  const { fromSource } = $FragmentAssembly(fakeRequire);

  it("should handle raw text", () => {
    const result = fromSource(mockStory);

    expect(result.content).toEqual([mockFragment(mockStory, 0)]);
    expect(Object.isFrozen(result.content)).toBe(true);
    expect(result.prefix).toEqual(mockFragment("", 0));
    expect(result.suffix).toEqual(mockFragment("", mockStory.length));
  });

  it("should handle a provided fragment", () => {
    const storyFrag = mockFragment(mockStory, 10);
    const result = fromSource(storyFrag);

    expect(result.content).toEqual([storyFrag]);
    expect(Object.isFrozen(result.content)).toBe(true);
    expect(result.prefix).toEqual(mockFragment("", 0));
    expect(result.suffix).toEqual(mockFragment("", mockStory.length + 10));
  });

  it("should create appropriate prefix and suffix fragments", () => {
    const result = fromSource(mockStory, {
      prefix: "PREFIX\n",
      suffix: "\nSUFFIX"
    });

    expect(result.content).toEqual([mockFragment(mockStory, 7)]);
    expect(result.prefix).toEqual(mockFragment("PREFIX\n", 0));
    expect(result.suffix).toEqual(mockFragment("\nSUFFIX", mockStory.length + 7));
  });

  it("should detect and handle empty strings (with affixing)", () => {
    const result = fromSource("", {
      prefix: "PREFIX\n",
      suffix: "\nSUFFIX"
    });

    expect(result.content).toEqual([]);
    expect(result.prefix).toEqual(mockFragment("PREFIX\n", 0));
    expect(result.suffix).toEqual(mockFragment("\nSUFFIX", 7));
  });

  it("should detect and handle empty strings (without affixing)", () => {
    const result = fromSource("");

    expect(result.content).toEqual([]);
    expect(result.prefix).toEqual(mockFragment("", 0));
    expect(result.suffix).toEqual(mockFragment("", 0));
  });
});

describe("fromFragments", () => {
  const { fromFragments } = $FragmentAssembly(fakeRequire);

  it("should create from an array of fragments", () => {
    const { content, maxOffset } = offsetFrags;

    const result = fromFragments(content);

    // It should make a safe, immutable copy of the fragments.
    expect(result.content).not.toBe(content);
    expect(result.content).toBeInstanceOf(Array);
    expect(Object.isFrozen(result.content)).toBe(true);
    expect(result.content).toEqual(content);

    expect(result.prefix).toEqual(mockFragment("", 0));
    expect(result.suffix).toEqual(mockFragment("", maxOffset));
  });

  it("should create from any other iterable of fragments", () => {
    const { content, maxOffset } = contiguousFrags;

    const genFrags = function*() { yield* content; };
    const genIterator = genFrags();
    const result = fromFragments(genIterator);

    // It should convert to an immutable array.
    expect(result.content).not.toBe(genIterator);
    expect(result.content).toBeInstanceOf(Array);
    expect(Object.isFrozen(result.content)).toBe(true);
    expect(result.content).toEqual(content);

    expect(result.prefix).toEqual(mockFragment("", 0));
    expect(result.suffix).toEqual(mockFragment("", maxOffset));
  });

  it("should create appropriate prefix and suffix fragments and offset content", () => {
    const { content, maxOffset } = offsetFrags;

    const result = fromFragments(content, {
      prefix: "PREFIX\n",
      suffix: "\nSUFFIX"
    });

    // Since we're applying an offset, it must make a new array.
    expect(result.content).not.toBe(content);
    expect(result.content).toBeInstanceOf(Array);
    expect(Object.isFrozen(result.content)).toBe(true);
    expect(result.content).toEqual(
      content.map((f) => mockFragment(f.content, f.offset + 7))
    );

    expect(result.prefix).toEqual(mockFragment("PREFIX\n", 0));
    expect(result.suffix).toEqual(mockFragment("\nSUFFIX", maxOffset + 7));
  });

  it("should filter out any empty fragments", () => {
    const { content } = offsetFrags;

    const fragments = [
      ...content.slice(0, 2),
      getEmptyFrag(content[2]),
      ...content.slice(3)
    ];
    const result = fromFragments(fragments);

    expect(result.content).toEqual([
      ...content.slice(0, 2),
      ...content.slice(3)
    ]);
  });

  it.todo("should assume continuity when told to");
});

describe("fromDerived", () => {
  const { fromDerived, castTo } = $FragmentAssembly(fakeRequire);

  const parentData = offsetFrags;

  const childData = {
    ...offsetFrags,
    content: offsetFrags.content.slice(0, 3),
    source: parentData
  };

  describe("when `fragments` is an assembly fast-path", () => {
    // A `ContentAssembly` is an `Iterable<TextFragment>`, so that case is
    // handled specially to do the minimum work.

    it("should return content assemblies as-is", () => {
      const assembly = castTo(childData);
      const result = fromDerived(assembly, parentData);

      expect(result).toBe(assembly);
    });

    it.failing("should FAIL if given an assembly that is not related to the origin assembly", () => {
      // An internal sanity check.  If we're expecting the given assembly
      // to be related (since it should be derived from the given origin),
      // then it better be!

      const foreignAssembly = {
        ...offsetFrags,
        content: []
      };

      const unrelatedAssembly = castTo({
        ...offsetFrags,
        content: offsetFrags.content.slice(0, 3),
        source: foreignAssembly
      });

      // This just uses referential equality as `ContentAssembly` instances
      // are expected to be immutable data structures.
      fromDerived(unrelatedAssembly, parentData);
    });
  });

  it("should remove the prefix/suffix fragment of the origin assembly from content", () => {
    // Specifically for the case you convert another `FragmentAssembly` into
    // an iterable and do a transform on it without removing the prefix
    // or suffix fragments.  It can identify and remove them.

    const reducedFrags = offsetFrags.content.slice(0, 3);
    const derivedFrags = [parentData.prefix, ...reducedFrags, parentData.suffix];
    const result = fromDerived(derivedFrags, parentData);

    expect(result.content).toEqual(reducedFrags);
    expect(result.content).not.toBe(derivedFrags);
  });

  it("should set the source of the provided origin", () => {
    const derivedFrags = offsetFrags.content.slice(0, 1);
    const result = fromDerived(derivedFrags, childData);

    expect(result.source).toBe(parentData);
  });

  // Specifically the `origin`, not `origin.source`.
  it("should use the same prefix/suffix as the origin", () => {
    const childAssembly = castTo({
      prefix: mockFragment("PRE\n", 0),
      content: offsetFrags.content.slice(0, 3),
      suffix: mockFragment("\nSUF", offsetFrags.maxOffset),
      source: parentData
    });

    const derivedFrags = offsetFrags.content.slice(0, 1);
    const result = fromDerived(derivedFrags, childAssembly);

    expect(result.prefix).toBe(childAssembly.prefix);
    expect(result.prefix).not.toBe(parentData.prefix);
    expect(result.suffix).toBe(childAssembly.suffix);
    expect(result.suffix).not.toBe(parentData.suffix);
  });

  it.todo("should assume continuity when told to");
});