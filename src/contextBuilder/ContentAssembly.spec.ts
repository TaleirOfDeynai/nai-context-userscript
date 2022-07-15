import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockStory } from "@spec/mock-story";
import { getEmptyFrag, mockFragment } from "@spec/helpers-splitter";
import { contiguousFrags, offsetFrags } from "@spec/helpers-assembly";

import $ContentAssembly from "./ContentAssembly";

import type { AssemblyInit } from "@spec/helpers-assembly";
import type { ContentAssembly } from "./ContentAssembly";

const { ContentAssembly } = $ContentAssembly(fakeRequire);

const initAssembly = (data: AssemblyInit) => new ContentAssembly(
  data.prefix,
  data.content,
  data.suffix,
  data.isContiguous ?? true,
  data.source ?? null
);

describe("ContentAssembly", () => {
  describe("static methods", () => {
    // Being a private variable, there's no simple way to check that
    // the `assumeContinuity` option is doing what it should.
    // I'm going to leave those as todo, in case I care later.

    describe("fromSource", () => {
      it("should handle raw text", () => {
        const result = ContentAssembly.fromSource(mockStory);

        expect(result.content).toEqual([mockFragment(mockStory, 0)]);
        expect(Object.isFrozen(result.content)).toBe(true);
        expect(result.prefix).toEqual(mockFragment("", 0));
        expect(result.suffix).toEqual(mockFragment("", mockStory.length));
      });

      it("should handle a provided fragment", () => {
        const storyFrag = mockFragment(mockStory, 10);
        const result = ContentAssembly.fromSource(storyFrag);

        expect(result.content).toEqual([storyFrag]);
        expect(Object.isFrozen(result.content)).toBe(true);
        expect(result.prefix).toEqual(mockFragment("", 0));
        expect(result.suffix).toEqual(mockFragment("", mockStory.length + 10));
      });

      it("should create appropriate prefix and suffix fragments", () => {
        const result = ContentAssembly.fromSource(mockStory, {
          prefix: "PREFIX\n",
          suffix: "\nSUFFIX"
        });

        expect(result.content).toEqual([mockFragment(mockStory, 7)]);
        expect(result.prefix).toEqual(mockFragment("PREFIX\n", 0));
        expect(result.suffix).toEqual(mockFragment("\nSUFFIX", mockStory.length + 7));
      });

      it("should detect and handle empty strings (with affixing)", () => {
        const result = ContentAssembly.fromSource("", {
          prefix: "PREFIX\n",
          suffix: "\nSUFFIX"
        });

        expect(result.content).toEqual([]);
        expect(result.prefix).toEqual(mockFragment("PREFIX\n", 0));
        expect(result.suffix).toEqual(mockFragment("\nSUFFIX", 7));
      });

      it("should detect and handle empty strings (without affixing)", () => {
        const result = ContentAssembly.fromSource("");

        expect(result.content).toEqual([]);
        expect(result.prefix).toEqual(mockFragment("", 0));
        expect(result.suffix).toEqual(mockFragment("", 0));
      });
    });

    describe("fromFragments", () => {
      it("should create from an array of fragments", () => {
        const { content, maxOffset } = offsetFrags;

        const result = ContentAssembly.fromFragments(content);

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
        const result = ContentAssembly.fromFragments(genIterator);

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

        const result = ContentAssembly.fromFragments(content, {
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
        const result = ContentAssembly.fromFragments(fragments);

        expect(result.content).toEqual([
          ...content.slice(0, 2),
          ...content.slice(3)
        ]);
      });

      it.todo("should assume continuity when told to");
    });

    describe("fromDerived", () => {
      const originAssembly = initAssembly(offsetFrags);

      const childAssembly = initAssembly({
        ...offsetFrags,
        content: offsetFrags.content.slice(0, 3),
        source: originAssembly
      });

      describe("when `fragments` is an assembly fast-path", () => {
        // A `ContentAssembly` is an `Iterable<TextFragment>`, so that case is
        // handled specially to do the minimum work.

        it("should return content assemblies as-is", () => {
          const result = ContentAssembly.fromDerived(childAssembly, originAssembly);

          expect(result).toBe(childAssembly);
        });

        it.failing("should FAIL if given an assembly that is not related to the origin assembly", () => {
          // An internal sanity check.  If we're expecting the given assembly
          // to be related (since it should be derived from the given origin),
          // then it better be!

          const foreignAssembly = initAssembly({
            ...offsetFrags,
            content: []
          });

          const unrelatedAssembly = initAssembly({
            ...offsetFrags,
            content: offsetFrags.content.slice(0, 3),
            source: foreignAssembly
          });

          // This just uses referential equality as `ContentAssembly` instances
          // are expected to be immutable data structures.
          ContentAssembly.fromDerived(unrelatedAssembly, originAssembly);
        });
      });

      it("should remove the prefix/suffix fragment of the origin assembly from content", () => {
        // Specifically for the case you convert another `FragmentAssembly` into
        // an iterable and do a transform on it without removing the prefix
        // or suffix fragments.  It can identify and remove them.

        const reducedFrags = offsetFrags.content.slice(0, 3);
        const derivedFrags = [originAssembly.prefix, ...reducedFrags, originAssembly.suffix];
        const result = ContentAssembly.fromDerived(derivedFrags, originAssembly);

        expect(result.content).toEqual(reducedFrags);
        expect(result.content).not.toBe(derivedFrags);
      });

      it("should set the source of the provided origin", () => {
        const derivedFrags = offsetFrags.content.slice(0, 1);
        const result = ContentAssembly.fromDerived(derivedFrags, childAssembly);

        expect(result.source).toBe(originAssembly);
      });

      // Specifically the `origin`, not `origin.source`.
      it("should use the same prefix/suffix as the origin", () => {
        const childAssembly = initAssembly({
          prefix: mockFragment("PRE\n", 0),
          content: offsetFrags.content.slice(0, 3),
          suffix: mockFragment("\nSUF", offsetFrags.maxOffset),
          source: originAssembly
        });

        const derivedFrags = offsetFrags.content.slice(0, 1);
        const result = ContentAssembly.fromDerived(derivedFrags, childAssembly);

        expect(result.prefix).toBe(childAssembly.prefix);
        expect(result.prefix).not.toBe(originAssembly.prefix);
        expect(result.suffix).toBe(childAssembly.suffix);
        expect(result.suffix).not.toBe(originAssembly.suffix);
      });

      it.todo("should assume continuity when told to");
    });
  });
});