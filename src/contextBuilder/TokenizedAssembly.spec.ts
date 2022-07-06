import { jest, describe, it, expect } from "@jest/globals";
import { beforeEach } from "@jest/globals";
import { getEmptyFrag, mockFragment, toContent } from "@spec/helpers-splitter";
import { mockCodec } from "@spec/helpers-tokenizer";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";

import { first, last } from "@utils/iterables";
import AppConstants from "@nai/AppConstants";
import $TokenizerService from "./TokenizerService";
import $TokenizedAssembly from "./TokenizedAssembly";

import type { SpyInstance } from "jest-mock";
import type { AssemblyInit } from "@spec/helpers-assembly";
import type { TokenizedAssembly } from "./TokenizedAssembly";

type SplitContent = [TokenizedAssembly, TokenizedAssembly];

const fakeRequire: any = (module: any) => {
  switch (module) {
    // Imported by `TextSplitterService`.
    case AppConstants: return {
      contextSize: 2000
    };
    default: return {};
  }
};

const { TokenizedAssembly } = $TokenizedAssembly(fakeRequire);
const { codecFor } = $TokenizerService(fakeRequire);

const initAssembly = async (data: AssemblyInit) => {
  const fullText = [data.prefix, ...data.content, data.suffix]
    .map(toContent)
    .join("");

  return new TokenizedAssembly(
    data.prefix,
    data.content,
    data.suffix,
    await mockCodec.encode(fullText),
    codecFor(0, mockCodec),
    data.isContiguous ?? true,
    data.source ?? null
  );
};

const foobarData = {
  prefix: "[ foofoo ]\n",
  content: [
    "foo foobar 2121 bar 32111",
    "\n",
    "bar bar foofoo barfoofoo",
    " ",
    "foobarfoo foofoo foobar foo foo..."
  ],
  suffix: "\n[ barbar ]"
};

const foobarFrags = generateData(3, foobarData);

describe("TokenizedAssembly", () => {
  describe("static methods", () => {
    // Being a private variable, there's no simple way to check that
    // the `assumeContinuity` option is doing what it should.
    // I'm going to leave those as todo, in case I care later.

    describe("fromDerived", () => {
      let originAssembly: TokenizedAssembly;
      let childAssembly: TokenizedAssembly;

      beforeEach(async () => {
        originAssembly = await initAssembly(foobarFrags);
        childAssembly = await initAssembly({
          ...foobarFrags,
          content: foobarFrags.content.slice(0, 3),
          source: originAssembly
        });
      });

      describe("when `fragments` is an assembly fast-path", () => {
        // A `ContentAssembly` is an `Iterable<TextFragment>`, so that case is
        // handled specially to do the minimum work.

        it("should return content assemblies as-is", async () => {
          const result = await TokenizedAssembly.fromDerived(childAssembly, originAssembly);

          expect(result).toBe(childAssembly);
        });

        it.failing("should FAIL if given an assembly that is not related to the origin assembly", async () => {
          // An internal sanity check.  If we're expecting the given assembly
          // to be related (since it should be derived from the given origin),
          // then it better be!

          const foreignAssembly = await initAssembly({
            ...foobarFrags,
            content: []
          });

          const unrelatedAssembly = await initAssembly({
            ...foobarFrags,
            content: foobarFrags.content.slice(0, 3),
            source: foreignAssembly
          });

          // This just uses referential equality as `ContentAssembly` instances
          // are expected to be immutable data structures.
          await TokenizedAssembly.fromDerived(unrelatedAssembly, originAssembly);
        });
      });

      it("should remove the prefix/suffix fragment of the origin assembly from content", async () => {
        // Specifically for the case you convert another `FragmentAssembly` into
        // an iterable and do a transform on it without removing the prefix
        // or suffix fragments.  It can identify and remove them.

        const reducedFrags = foobarFrags.content.slice(0, 3);
        const derivedFrags = [originAssembly.prefix, ...reducedFrags, originAssembly.suffix];
        const result = await TokenizedAssembly.fromDerived(derivedFrags, originAssembly);

        expect(result.content).toEqual(reducedFrags);
        expect(result.content).not.toBe(derivedFrags);
      });

      it("should set the source of the provided origin", async () => {
        const derivedFrags = foobarFrags.content.slice(0, 1);
        const result = await TokenizedAssembly.fromDerived(derivedFrags, childAssembly);

        expect(result.source).toBe(originAssembly);
      });

      // Specifically the `origin`, not `origin.source`.
      it("should use the same prefix/suffix as the origin", async () => {
        const childAssembly = await initAssembly({
          prefix: mockFragment("[ foo ]\n", 0),
          content: foobarFrags.content.slice(0, 3),
          suffix: mockFragment("\n[ bar ]", foobarFrags.maxOffset),
          source: originAssembly
        });

        const derivedFrags = foobarFrags.content.slice(0, 1);
        const result = await TokenizedAssembly.fromDerived(derivedFrags, childAssembly);

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
      let testAssembly: TokenizedAssembly;

      beforeEach(async () => {
        testAssembly = await initAssembly(foobarFrags);
      });

      describe("failure cases", () => {
        it("should return `undefined` if cursor is unrelated", async () => {
          const foreignData = generateData(0, foobarData);
          const foreignAssembly = await initAssembly(foreignData);
          
          const offset = insideFrag(first(foreignData.content));
          const cursor = mockCursor(offset, "fragment", foreignAssembly);
          const result = await testAssembly.splitAt(cursor);

          expect(result).toBeUndefined();
        });

        it("should return `undefined` if cursor is not within content block", async () => {
          const offset = insideFrag(foobarFrags.prefix);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const result = await testAssembly.splitAt(cursor);

          expect(result).toBeUndefined();
        });
      });

      describe("basic functionality", () => {
        it("should be able to split the assembly correctly", async () => {
          const sliceOffset = ("bar bar foofoo").length;
          const slicedFrag = foobarFrags.content[2];
          const offset = beforeFrag(slicedFrag) + sliceOffset;
          const cursor = mockCursor(offset, "fragment", testAssembly);
          
          const result = await testAssembly.splitAt(cursor) as SplitContent;

          // Left of the cut.
          expect(result[0].prefix).toBe(foobarFrags.prefix);
          expect(result[0].content).toEqual(expect.any(Array));
          expect(result[0].suffix).toEqual(getEmptyFrag(foobarFrags.suffix));
          expect(result[0].tokens).toEqual(
            await mockCodec.encode([
              foobarData.prefix,
              ...foobarData.content.slice(0, 2),
              slicedFrag.content.slice(0, sliceOffset)
            ].join(""))
          );

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(foobarFrags.prefix));
          expect(result[1].content).toEqual(expect.any(Array));
          expect(result[1].suffix).toBe(foobarFrags.suffix);
          expect(result[1].tokens).toEqual(
            await mockCodec.encode([
              slicedFrag.content.slice(sliceOffset),
              ...foobarData.content.slice(3),
              foobarData.suffix
            ].join(""))
          );
        });
      });

      describe("concerning the prefix", () => {
        it("should be able to split after the prefix", async () => {
          const offset = beforeFrag(foobarFrags.content[0]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const result = await testAssembly.splitAt(cursor) as SplitContent;

          // Left of the cut.
          expect(result[0].prefix).toBe(foobarFrags.prefix);
          expect(result[0].content).toEqual([]);
          expect(result[0].suffix).toEqual(getEmptyFrag(foobarFrags.suffix));
          expect(result[0].tokens).toEqual(
            await mockCodec.encode(foobarData.prefix)
          );

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(foobarFrags.prefix));
          expect(result[1].content).toEqual(foobarFrags.content);
          expect(result[1].suffix).toBe(foobarFrags.suffix);
          expect(result[1].tokens).toEqual(
            await mockCodec.encode([
              ...foobarData.content,
              foobarData.suffix
            ].join(""))
          );
        });

        it("should propagate the prefix correctly when splitting twice", async () => {
          const firstOffset = afterFrag(foobarFrags.content[2]);
          const firstCursor = mockCursor(firstOffset, "fragment", testAssembly);
          const firstSplit = first(await testAssembly.splitAt(firstCursor) ?? []);

          const secondOffset = afterFrag(foobarFrags.content[0]);
          const secondCursor = mockCursor(secondOffset, "fragment", testAssembly);
          const result = await firstSplit?.splitAt(secondCursor) as SplitContent;

          // Left of the cut.
          expect(result[0].prefix).toBe(foobarFrags.prefix);
          expect(result[0].content).toEqual(foobarFrags.content.slice(0, 1));
          expect(result[0].suffix).toEqual(getEmptyFrag(foobarFrags.suffix));
          expect(result[0].tokens).toEqual(
            await mockCodec.encode([
              foobarData.prefix,
              ...foobarData.content.slice(0, 1)
            ].join(""))
          );

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(foobarFrags.prefix));
          expect(result[1].content).toEqual(foobarFrags.content.slice(1, 3));
          expect(result[1].suffix).toEqual(getEmptyFrag(foobarFrags.suffix));
          expect(result[1].tokens).toEqual(
            await mockCodec.encode(foobarData.content.slice(1, 3).join(""))
          );
        });

        it("should reuse an empty prefix fragment", async () => {
          const assemblyData = generateData(3, { ...foobarData, prefix: "" });
          const testAssembly = await initAssembly(assemblyData);

          const offset = afterFrag(foobarFrags.content[2]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const result = first(await testAssembly.splitAt(cursor) ?? []);

          // Since the assembly already has an empty prefix, the instance should
          // be reused instead of creating a new empty fragment.
          expect(result?.prefix).toBe(assemblyData.prefix);
        });
      });

      describe("concerning the suffix", () => {
        it("should be able to split before the suffix", async () => {
          const offset = afterFrag(foobarFrags.content[4]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const result = await testAssembly.splitAt(cursor) as SplitContent;

          // Left of the cut.
          expect(result[0].prefix).toBe(foobarFrags.prefix);
          expect(result[0].content).toEqual(foobarFrags.content);
          expect(result[0].suffix).toEqual(getEmptyFrag(foobarFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(foobarFrags.prefix));
          expect(result[1].content).toEqual([]);
          expect(result[1].suffix).toBe(foobarFrags.suffix);
        });

        it("should propagate the suffix correctly when splitting twice", async () => {
          const firstOffset = beforeFrag(foobarFrags.content[2]);
          const firstCursor = mockCursor(firstOffset, "fragment", testAssembly);
          const firstSplit = last(await testAssembly.splitAt(firstCursor) ?? []);

          const secondOffset = beforeFrag(foobarFrags.content[4]);
          const secondCursor = mockCursor(secondOffset, "fragment", testAssembly);
          const result = await firstSplit?.splitAt(secondCursor) as SplitContent;

          // Left of the cut.
          expect(result[0].prefix).toEqual(getEmptyFrag(foobarFrags.prefix));
          expect(result[0].content).toEqual(foobarFrags.content.slice(2, 4));
          expect(result[0].suffix).toEqual(getEmptyFrag(foobarFrags.suffix));

          // Right of the cut.
          expect(result[1].prefix).toEqual(getEmptyFrag(foobarFrags.prefix));
          expect(result[1].content).toEqual(foobarFrags.content.slice(4));
          expect(result[1].suffix).toBe(foobarFrags.suffix);
        });

        it("should reuse an empty suffix fragment", async () => {
          const assemblyData = generateData(3, { ...foobarData, suffix: "" });
          const testAssembly = await initAssembly(assemblyData);

          const offset = beforeFrag(foobarFrags.content[2]);
          const cursor = mockCursor(offset, "fragment", testAssembly);
          const result = last(await testAssembly.splitAt(cursor) ?? []);

          // Since the assembly already has an empty suffix, the instance should
          // be reused instead of creating a new empty fragment.
          expect(result?.suffix).toBe(assemblyData.suffix);
        });
      });

      describe("concerning loose mode", () => {
        let testAssembly: TokenizedAssembly;
        let spyFindBest: SpyInstance<TokenizedAssembly["findBest"]>;
        let spyIsFoundIn: SpyInstance<TokenizedAssembly["isFoundIn"]>;

        beforeEach(async () => {
          testAssembly = await initAssembly(foobarFrags);
          spyFindBest = jest.spyOn(testAssembly, "findBest");
          spyIsFoundIn = jest.spyOn(testAssembly, "isFoundIn");
        });

        it("should call `findBest` with the input cursor when active", async () => {
          const offset = beforeFrag(foobarFrags.content[2]);
          const cursor = mockCursor(offset, "fragment", testAssembly);

          spyFindBest.mockReturnValue(cursor);
          await testAssembly.splitAt(cursor, true);

          expect(spyFindBest).toBeCalledWith(cursor, true);
        });

        it("should NOT call `findBest` with the input cursor when inactive", async () => {
          const offset = beforeFrag(foobarFrags.content[2]);
          const cursor = mockCursor(offset, "fragment", testAssembly);

          spyIsFoundIn.mockReturnValue(true);
          await testAssembly.splitAt(cursor, false);

          expect(spyFindBest).not.toHaveBeenCalled();
        });

        it("should not use the best cursor if it is outside the content block", async () => {
          const inputCursor = mockCursor(
            beforeFrag(foobarFrags.content[2]),
            "fragment", testAssembly
          );

          const prefixCursor = mockCursor(
            insideFrag(foobarFrags.prefix),
            "fragment", testAssembly
          );

          spyFindBest.mockReturnValue(prefixCursor);
          const result = await testAssembly.splitAt(inputCursor, true);

          expect(result).toBeUndefined();
        });
      });
    });

    describe("asOnlyContent", () => {
      it("should create a new assembly with prefix/suffix removed", async () => {
        const testAssembly = await initAssembly(foobarFrags);

        const result = await testAssembly.asOnlyContent();

        expect(result).not.toBe(testAssembly);
        expect(result.prefix).not.toEqual(testAssembly.prefix);
        expect(result.suffix).not.toEqual(testAssembly.suffix);

        expect(result.prefix).toEqual(getEmptyFrag(testAssembly.prefix));
        expect(result.suffix).toEqual(getEmptyFrag(testAssembly.suffix));

        expect(result.tokens).toEqual(
          await mockCodec.encode(foobarData.content.join(""))
        );
      });

      it("should return the same instance if no change is needed", async () => {
        const assemblyData = generateData(0, { ...foobarData, ...NO_AFFIX });
        const testAssembly = await initAssembly(assemblyData);

        const result = await testAssembly.asOnlyContent();

        expect(result).toBe(testAssembly);
      });

      it("should reuse the prefix fragment if it is empty", async () => {
        const assemblyData = generateData(0, { ...foobarData, prefix: "" });
        const testAssembly = await initAssembly(assemblyData);

        const result = await testAssembly.asOnlyContent();

        expect(result.prefix).toBe(testAssembly.prefix);
      });

      it("should reuse the suffix fragment if it is empty", async () => {
        const assemblyData = generateData(0, { ...foobarData, suffix: "" });
        const testAssembly = await initAssembly(assemblyData);

        const result = await testAssembly.asOnlyContent();

        expect(result.suffix).toBe(testAssembly.suffix);
      });
    });
  });
});