import { describe, it, expect } from "@jest/globals";
import { beforeEach } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockFragment, toContent } from "@spec/helpers-splitter";
import { mockCodec } from "@spec/helpers-tokenizer";
import { generateData } from "@spec/helpers-assembly";

import $TokenizerService from "./TokenizerService";
import $TokenizedAssembly from "./TokenizedAssembly";

import type { AssemblyInit } from "@spec/helpers-assembly";
import type { TokenizedAssembly } from "./TokenizedAssembly";

const { TokenizedAssembly } = $TokenizedAssembly(fakeRequire);
const { codecFor } = $TokenizerService(fakeRequire);

const initAssembly = async (data: AssemblyInit) => {
  const text = [data.prefix, ...data.content, data.suffix]
    .map(toContent)
    .join("");

  return new TokenizedAssembly(
    data.prefix,
    data.content,
    data.suffix,
    await mockCodec.encode(text),
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
});