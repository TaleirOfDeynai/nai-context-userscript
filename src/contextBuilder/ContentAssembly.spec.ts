import { describe, it, expect } from "@jest/globals";
import { beforeAll, afterEach } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockStory } from "@spec/mock-story";
import { getEmptyFrag, mockFragment } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";
import { contiguousFrags, offsetFrags } from "@spec/helpers-assembly";

import { first, last } from "@utils/iterables";
import $FindBest from "./assemblies/queryOps/findBest";
import $IsFoundIn from "./assemblies/queryOps/isFoundIn";
import $ContentAssembly from "./ContentAssembly";

import type { SpyInstance } from "jest-mock";
import type { AssemblyInit } from "@spec/helpers-assembly";
import type { ContentAssembly } from "./ContentAssembly";

type SplitContent = [ContentAssembly, ContentAssembly];

let spyFindBest: SpyInstance<ReturnType<typeof $FindBest>["findBest"]>;
fakeRequire.inject($FindBest, (exports, jestFn) => {
  spyFindBest = jestFn(exports.findBest);
  return Object.assign(exports, { findBest: spyFindBest });
});

let spyIsFoundIn: SpyInstance<ReturnType<typeof $IsFoundIn>["isFoundIn"]>;
fakeRequire.inject($IsFoundIn, (exports, jestFn) => {
  spyIsFoundIn = jestFn(exports.isFoundIn);
  return Object.assign(exports, { isFoundIn: spyIsFoundIn });
});

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

  describe("manipulation methods", () => {
    describe("splitAt", () => {
      const testAssembly = initAssembly(offsetFrags);

      describe("failure cases", () => {
        it("should return `undefined` if cursor is unrelated", () => {
          const foreignAssembly = initAssembly(contiguousFrags);
          
          const offset = insideFrag(first(contiguousFrags.content));
          const cursor = mockCursor(offset, "fragment", foreignAssembly);
          const result = testAssembly.splitAt(cursor);

          expect(result).toBeUndefined();
        });

        it("should return `undefined` if cursor is not within content block", () => {
          const offset = insideFrag(offsetFrags.prefix);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const result = testAssembly.splitAt(cursor);

          expect(result).toBeUndefined();
        });
      });

      describe("basic functionality", () => {
        // This is all handled by `splitSequenceAt` in the `FragmentAssembly`
        // module.  We're just going to check that it's splitting the assembly
        // and not go into much detail.

        it("should be able to split the assembly correctly", () => {
          const sliceOffset = ("This is the").length;
          const slicedFrag = offsetFrags.content[2];
          const offset = beforeFrag(slicedFrag) + sliceOffset;
          const cursor = mockCursor(offset, "fragment", testAssembly);
          
          const result = testAssembly.splitAt(cursor) as SplitContent;

          // Left of the cut.
          expect(result[0].prefix).toBe(offsetFrags.prefix);
          expect(result[0].content).toEqual(expect.any(Array));
          expect(result[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[1].content).toEqual(expect.any(Array));
          expect(result[1].suffix).toBe(offsetFrags.suffix);
        });
      });

      describe("concerning the prefix", () => {
        it("should be able to split after the prefix", () => {
          const offset = beforeFrag(offsetFrags.content[0]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const result = testAssembly.splitAt(cursor) as SplitContent;

          // Left of the cut.
          expect(result[0].prefix).toBe(offsetFrags.prefix);
          expect(result[0].content).toEqual([]);
          expect(result[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[1].content).toEqual(offsetFrags.content);
          expect(result[1].suffix).toBe(offsetFrags.suffix);
        });

        it("should propagate the prefix correctly when splitting twice", () => {
          const firstOffset = afterFrag(offsetFrags.content[2]);
          const firstCursor = mockCursor(firstOffset, "fragment", testAssembly);
          const firstSplit = first(testAssembly.splitAt(firstCursor) ?? []);

          const secondOffset = afterFrag(offsetFrags.content[0]);
          const secondCursor = mockCursor(secondOffset, "fragment", testAssembly);
          const result = firstSplit?.splitAt(secondCursor) as SplitContent;

          // Left of the cut.
          expect(result[0].prefix).toBe(offsetFrags.prefix);
          expect(result[0].content).toEqual(offsetFrags.content.slice(0, 1));
          expect(result[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[1].content).toEqual(offsetFrags.content.slice(1, 3));
          expect(result[1].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));
        });

        it("should reuse an empty prefix fragment", () => {
          const assemblyData = generateData(3, { prefix: "" });
          const testAssembly = initAssembly(assemblyData);

          const offset = afterFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const result = first(testAssembly.splitAt(cursor) ?? []);

          // Since the assembly already has an empty prefix, the instance should
          // be reused instead of creating a new empty fragment.
          expect(result?.prefix).toBe(assemblyData.prefix);
        });
      });

      describe("concerning the suffix", () => {
        it("should be able to split before the suffix", () => {
          const offset = afterFrag(offsetFrags.content[4]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const result = testAssembly.splitAt(cursor) as SplitContent;

          // Left of the cut.
          expect(result[0].prefix).toBe(offsetFrags.prefix);
          expect(result[0].content).toEqual(offsetFrags.content);
          expect(result[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[1].content).toEqual([]);
          expect(result[1].suffix).toBe(offsetFrags.suffix);
        });

        it("should propagate the suffix correctly when splitting twice", () => {
          const firstOffset = beforeFrag(offsetFrags.content[2]);
          const firstCursor = mockCursor(firstOffset, "fragment", testAssembly);
          const firstSplit = last(testAssembly.splitAt(firstCursor) ?? []);

          const secondOffset = beforeFrag(offsetFrags.content[4]);
          const secondCursor = mockCursor(secondOffset, "fragment", testAssembly);
          const result = firstSplit?.splitAt(secondCursor) as SplitContent;

          // Left of the cut.
          expect(result[0].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[0].content).toEqual(offsetFrags.content.slice(2, 4));
          expect(result[0].suffix).toEqual(getEmptyFrag(offsetFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(offsetFrags.prefix));
          expect(result[1].content).toEqual(offsetFrags.content.slice(4));
          expect(result[1].suffix).toBe(offsetFrags.suffix);
        });

        it("should reuse an empty suffix fragment", () => {
          const assemblyData = generateData(3, { suffix: "" });
          const testAssembly = initAssembly(assemblyData);

          const offset = beforeFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const result = last(testAssembly.splitAt(cursor) ?? []);

          // Since the assembly already has an empty suffix, the instance should
          // be reused instead of creating a new empty fragment.
          expect(result?.suffix).toBe(assemblyData.suffix);
        });
      });

      describe("concerning loose mode", () => {
        const testAssembly = initAssembly(offsetFrags);

        const resetMocks = () => {
          spyFindBest.mockReset();
          spyIsFoundIn.mockReset();
        };

        beforeAll(resetMocks);
        afterEach(resetMocks);

        it("should call `findBest` with the input cursor when active", () => {
          const offset = beforeFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "fragment", testAssembly);

          spyFindBest.mockReturnValue(cursor);
          testAssembly.splitAt(cursor, true);

          expect(spyFindBest).toBeCalledWith(testAssembly, cursor, true);
          expect(spyIsFoundIn).not.toHaveBeenCalled();
        });

        it("should NOT call `findBest` with the input cursor when inactive", () => {
          const offset = beforeFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "fragment", testAssembly);

          spyIsFoundIn.mockReturnValue(true);
          testAssembly.splitAt(cursor, false);

          expect(spyIsFoundIn).toBeCalledWith(testAssembly, cursor);
          expect(spyFindBest).not.toHaveBeenCalled();
        });

        it("should not use the best cursor if it is outside the content block", () => {
          const inputCursor = mockCursor(
            beforeFrag(offsetFrags.content[2]),
            "fragment", testAssembly
          );

          const prefixCursor = mockCursor(
            insideFrag(offsetFrags.prefix),
            "fragment", testAssembly
          );

          spyFindBest.mockReturnValue(prefixCursor);
          const result = testAssembly.splitAt(inputCursor, true);

          expect(result).toBeUndefined();
        });
      });
    });

    describe("asOnlyContent", () => {
      it("should create a new assembly with prefix/suffix removed", () => {
        const testAssembly = initAssembly(offsetFrags);

        const result = testAssembly.asOnlyContent();

        expect(result).not.toBe(testAssembly);
        expect(result.prefix).not.toEqual(testAssembly.prefix);
        expect(result.suffix).not.toEqual(testAssembly.suffix);

        expect(result.prefix).toEqual(getEmptyFrag(testAssembly.prefix));
        expect(result.suffix).toEqual(getEmptyFrag(testAssembly.suffix));
      });

      it("should return the same instance if no change is needed", () => {
        const assemblyData = generateData(0, NO_AFFIX);
        const testAssembly = initAssembly(assemblyData);

        const result = testAssembly.asOnlyContent();

        expect(result).toBe(testAssembly);
      });

      it("should reuse the prefix fragment if it is empty", () => {
        const assemblyData = generateData(0, { prefix: "" });
        const testAssembly = initAssembly(assemblyData);

        const result = testAssembly.asOnlyContent();

        expect(result.prefix).toBe(testAssembly.prefix);
      });

      it("should reuse the suffix fragment if it is empty", () => {
        const assemblyData = generateData(0, { suffix: "" });
        const testAssembly = initAssembly(assemblyData);

        const result = testAssembly.asOnlyContent();

        expect(result.suffix).toBe(testAssembly.suffix);
      });
    });
  });
});