import { describe, it, expect } from "@jest/globals";
import { beforeEach } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockFragment, toContent } from "@spec/helpers-splitter";
import { mockCodec as rawCodec } from "@spec/helpers-tokenizer";
import { generateData, asMerged } from "@spec/helpers-assembly";

import { dew } from "@utils/dew";
import $TokenizerService from "../TokenizerService";
import $TokenizedAssembly from "./Tokenized";

import type { TokenizedAssembly } from "./Tokenized";

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

const foobarFrags = generateData(3, foobarData);

describe("isInstance", () => {
  const { isInstance, castTo } = $TokenizedAssembly(fakeRequire);

  it("should return true for an instance", async () => {
    const assembly = await castTo(mockCodec, foobarFrags);
    expect(isInstance(assembly)).toBe(true);
  });

  it("should return false for a non-instance", async () => {
    expect(isInstance(foobarFrags)).toBe(false);
  });
});

describe("castTo", () => {
  const { castTo, isInstance } = $TokenizedAssembly(fakeRequire);

  it("should wrap a plain object assembly", async () => {
    const testData = foobarFrags;
    const result = await castTo(mockCodec, foobarFrags);

    expect(result).not.toBe(testData);
    expect(isInstance(result)).toBe(true);
  });

  it("should use `tokens` when provided", async () => {
    const testData = foobarFrags;
    const fullText = testData.content.map(toContent).join("");
    const tokens = Object.freeze(await mockCodec.encode(fullText));
    const result = await castTo(mockCodec, { ...foobarFrags, tokens });

    expect(result.tokens).toBe(tokens);
  });

  it("should return the same instance for an instance", async () => {
    const assembly = await castTo(mockCodec, foobarFrags);
    expect(await castTo(mockCodec, assembly)).toBe(assembly);
  });
});

describe("fromDerived", () => {
  const { fromDerived, castTo } = $TokenizedAssembly(fakeRequire);

  let originAssembly: TokenizedAssembly;
  let childAssembly: TokenizedAssembly;

  beforeEach(async () => {
    originAssembly = await castTo(mockCodec, foobarFrags);
    childAssembly = await castTo(mockCodec, {
      ...foobarFrags,
      content: foobarFrags.content.slice(0, 3),
      source: originAssembly
    });
  });

  describe("when `fragments` is an assembly fast-path", () => {
    // A `TokenizedAssembly` is an `Iterable<TextFragment>`, so that case
    // is handled specially to do the minimum work.

    it("should return content assemblies as-is", async () => {
      const result = await fromDerived(childAssembly, originAssembly);

      expect(result).toBe(childAssembly);
    });

    it.failing("should FAIL if given an assembly that is not related to the origin assembly", async () => {
      // An internal sanity check.  If we're expecting the given assembly
      // to be related (since it should be derived from the given origin),
      // then it better be!

      const foreignAssembly = await castTo(mockCodec, {
        ...foobarFrags,
        content: []
      });

      const unrelatedAssembly = await castTo(mockCodec, {
        ...foobarFrags,
        content: foobarFrags.content.slice(0, 3),
        source: foreignAssembly
      });

      // This just uses referential equality as `ContentAssembly` instances
      // are expected to be immutable data structures.
      await fromDerived(unrelatedAssembly, originAssembly);
    });
  });

  it("should merge sequential fragments", async () => {
    // Just dropping the whitespace between index `2` and `4`.
    const firstSeq = foobarFrags.content.slice(0, 3);
    const secondSeq = foobarFrags.content.slice(4, 5);
    const derivedFrags = [...firstSeq, ...secondSeq];
    const result = await fromDerived(derivedFrags, originAssembly);

    expect(result.content).toEqual([asMerged(firstSeq), asMerged(secondSeq)]);
  });

  it("should remove the prefix/suffix fragment of the origin assembly from content", async () => {
    // Specifically for the case you convert another `FragmentAssembly` into
    // an iterable and do a transform on it without removing the prefix
    // or suffix fragments.  It can identify and remove them.

    const reducedFrags = foobarFrags.content.slice(0, 3);
    const derivedFrags = [originAssembly.prefix, ...reducedFrags, originAssembly.suffix];
    const result = await fromDerived(derivedFrags, originAssembly);

    expect(result.content).toEqual([asMerged(reducedFrags)]);
    expect(result.content).not.toBe(derivedFrags);
  });

  it("should set the source of the provided origin", async () => {
    const derivedFrags = foobarFrags.content.slice(0, 1);
    const result = await fromDerived(derivedFrags, childAssembly);

    expect(result.source).toBe(originAssembly);
  });

  // Specifically the `origin`, not `origin.source`.
  it("should use the same prefix/suffix as the origin", async () => {
    const childAssembly = await castTo(mockCodec, {
      prefix: mockFragment("[ foo ]\n", 0),
      content: foobarFrags.content.slice(0, 3),
      suffix: mockFragment("\n[ bar ]", foobarFrags.maxOffset),
      source: originAssembly
    });

    const derivedFrags = foobarFrags.content.slice(0, 1);
    const result = await fromDerived(derivedFrags, childAssembly);

    expect(result.prefix).toBe(childAssembly.prefix);
    expect(result.prefix).not.toBe(originAssembly.prefix);
    expect(result.suffix).toBe(childAssembly.suffix);
    expect(result.suffix).not.toBe(originAssembly.suffix);
  });

  it.todo("should assume continuity when told to");
});