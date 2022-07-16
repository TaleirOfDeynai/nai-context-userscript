import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { getEmptyFrag, toContent } from "@spec/helpers-splitter";
import { mockCodec as rawCodec } from "@spec/helpers-tokenizer";
import { beforeFrag, insideFrag } from "@spec/helpers-assembly";
import { generateData } from "@spec/helpers-assembly";

import { dew } from "@utils/dew";
import { assertExists } from "@utils/assert";
import { first } from "@utils/iterables";
import $TokenizerService from "../../TokenizerService";
import $SplitAt from "./splitAt";

import type { AssemblyData } from "@spec/helpers-assembly";
import type { Tokens } from "../../TokenizerService";

type TokenizedAssemblyData = AssemblyData & { tokens: Tokens };

const mockCodec = dew(() => {
  const { codecFor } = $TokenizerService(fakeRequire);
  return codecFor(0, rawCodec);
});

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

const initAssembly = async (data: AssemblyData): Promise<TokenizedAssemblyData> => {
  const text = [data.prefix, ...data.content, data.suffix]
    .map(toContent)
    .join("");

  return {
    ...data,
    tokens: await mockCodec.encode(text),
  };
};

const { splitAt } = $SplitAt(fakeRequire);

describe("splitAt", () => {
  // This uses `manipOps.splitAt` and `getTokensForSplit` to do the heavy
  // lifting, so we're just doing integration tests here.

  describe("failure cases", () => {
    it("should return `undefined` if cursor is unrelated", async () => {
      const testAssembly = await initAssembly(generateData(3, foobarData));
      const foreignAssembly = await initAssembly(generateData(0, foobarData));
      
      const offset = insideFrag(first(foreignAssembly.content));
      const cursor = foreignAssembly.inFrag(offset);
      const result = await splitAt(testAssembly, mockCodec, cursor);

      expect(result).toBeUndefined();
    });

    it("should return `undefined` if cursor is not within content block", async () => {
      const testAssembly = await initAssembly(generateData(3, foobarData));

      const offset = insideFrag(testAssembly.prefix);
      const cursor = testAssembly.inFrag(offset);
      const result = await splitAt(testAssembly, mockCodec, cursor);

      expect(result).toBeUndefined();
    });
  });

  describe("basic functionality", () => {
    it("should be able to split an assembly correctly", async () => {
      const testAssembly = await initAssembly(generateData(3, foobarData));
  
      const sliceOffset = ("bar bar foofoo").length;
      const slicedFrag = testAssembly.content[2];
      const offset = beforeFrag(slicedFrag) + sliceOffset;
      const cursor = testAssembly.inFrag(offset);
      
      const result = assertExists(
        "Expected to split the assembly.",
        await splitAt(testAssembly, mockCodec, cursor)
      );
  
      // Left of the cut.
      expect(result.assemblies[0].prefix).toBe(testAssembly.prefix);
      expect(result.assemblies[0].content).toEqual(expect.any(Array));
      expect(result.assemblies[0].suffix).toEqual(getEmptyFrag(testAssembly.suffix));
      expect(result.assemblies[0].tokens).toEqual(
        await mockCodec.encode([
          testAssembly.prefix.content,
          ...testAssembly.content.slice(0, 2).map(toContent),
          slicedFrag.content.slice(0, sliceOffset)
        ].join(""))
      );
  
      // Right of the cut.
      expect(result.assemblies[1].prefix).toEqual(getEmptyFrag(testAssembly.prefix));
      expect(result.assemblies[1].content).toEqual(expect.any(Array));
      expect(result.assemblies[1].suffix).toBe(testAssembly.suffix);
      expect(result.assemblies[1].tokens).toEqual(
        await mockCodec.encode([
          slicedFrag.content.slice(sliceOffset),
          ...testAssembly.content.slice(3).map(toContent),
          testAssembly.suffix.content
        ].join(""))
      );
    });
  });
});