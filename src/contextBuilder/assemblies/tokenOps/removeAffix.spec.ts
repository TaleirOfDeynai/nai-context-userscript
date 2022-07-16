import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { getEmptyFrag, toContent } from "@spec/helpers-splitter";
import { mockCodec as rawCodec } from "@spec/helpers-tokenizer";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";

import { dew } from "@utils/dew";
import $TokenizerService from "../../TokenizerService";
import $RemoveAffix from "./removeAffix";

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

const { removeAffix } = $RemoveAffix(fakeRequire);

describe("removeAffix", () => {
  it("should create a new assembly with prefix/suffix removed", async () => {
    const assemblyData = generateData(3, foobarData);
    const testAssembly = await initAssembly(assemblyData);

    const result = await removeAffix(testAssembly, mockCodec);

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
    const assemblyData = generateData(3, { ...foobarData, ...NO_AFFIX });
    const testAssembly = await initAssembly(assemblyData);

    const result = await removeAffix(testAssembly, mockCodec);

    expect(result).toBe(testAssembly);
  });

  it("should reuse the prefix fragment if it is empty", async () => {
    const assemblyData = generateData(3, { ...foobarData, prefix: "" });
    const testAssembly = await initAssembly(assemblyData);

    const result = await removeAffix(testAssembly, mockCodec);

    expect(result.prefix).toBe(testAssembly.prefix);
  });

  it("should reuse the suffix fragment if it is empty", async () => {
    const assemblyData = generateData(3, { ...foobarData, suffix: "" });
    const testAssembly = await initAssembly(assemblyData);

    const result = await removeAffix(testAssembly, mockCodec);

    expect(result.suffix).toBe(testAssembly.suffix);
  });

  it("should work with an assembly with no content fragments", async () => {
    const assemblyData = generateData(3, { ...foobarData, content: [] });
    const testAssembly = await initAssembly(assemblyData);

    const result = await removeAffix(testAssembly, mockCodec);

    // Should just be an empty assembly.
    expect(result.prefix).toEqual(getEmptyFrag(testAssembly.prefix));
    expect(result.content).toEqual([]);
    expect(result.suffix).toEqual(getEmptyFrag(testAssembly.suffix));
    expect(result.tokens).toEqual([]);
  });
});