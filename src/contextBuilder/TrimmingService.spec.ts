import { describe, it, expect } from "@jest/globals";
import { beforeAll, beforeEach, afterEach } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockFragment, toContent } from "@spec/helpers-splitter";
import { mockCodec } from "@spec/helpers-tokenizer";
import { mockStory } from "@spec/mock-story";

import levDist from "fast-levenshtein";
import $TokenizerService from "./TokenizerService";
import $TrimmingService from "./TrimmingService";
import $TrimmingProviders from "./TrimmingProviders";
import $FragmentAssembly from "./assemblies/Fragment";
import $TokenizedAssembly from "./assemblies/Tokenized";

import type { SpyInstance } from "jest-mock";
import type { TextFragment } from "./TextSplitterService";
import type { TrimDirection } from "./TrimmingProviders";
import type { Trimmer } from "./TrimmingService";
import type { ContextParams } from "./ParamsService";
import type { Assembly } from "./assemblies";

type FragmentFromDerived = ReturnType<typeof $FragmentAssembly>["fromDerived"];
type TokenizedFromDerived = ReturnType<typeof $TokenizedAssembly>["fromDerived"];

const mockAssembly = <T extends Assembly.IFragment = Assembly.IFragment>(
  content: Iterable<TextFragment>,
  prefix: TextFragment,
  suffix: TextFragment,
  extraProps?: Object
): T => {
  return {
    prefix, content, suffix,
    *[Symbol.iterator]() {
      if (prefix.content) yield prefix;
      yield* content;
      if (suffix.content) yield suffix;
    },
    ...extraProps
  } as any;
}

// We'll need the `prefix`, `content`, and `suffix` properties
// for these tests.
const mockNewAssembly = (
  srcContent: string,
  srcPrefix?: string,
  srcSuffix?: string
): Assembly.Any => {
  const prefix = mockFragment(srcPrefix ?? "", 0);
  const content = mockFragment(srcContent, 0, prefix);
  const suffix = mockFragment(srcSuffix ?? "", 0, content);
  return mockAssembly(Object.freeze([content]), prefix, suffix);
};

let spyDeriveFragment: SpyInstance<FragmentFromDerived>;
fakeRequire.inject($FragmentAssembly, (exports, jestFn) => {
  spyDeriveFragment = jestFn((f, o) => {
    return mockAssembly<Assembly.Fragment>(f, o.prefix, o.suffix);
  });
  return Object.assign(exports, { fromDerived: spyDeriveFragment });
});

let spyDeriveTokenized: SpyInstance<TokenizedFromDerived>;
fakeRequire.inject($TokenizedAssembly, (exports, jestFn) => {
  spyDeriveTokenized = jestFn((f, o, opts) => {
    const tokens = opts?.tokens ?? [];
    const assembly = mockAssembly<Assembly.Tokenized>(f, o.prefix, o.suffix, { tokens });
    return Promise.resolve(assembly);
  });
  Object.assign(exports, { fromDerived: spyDeriveTokenized });
  return exports;
});

beforeEach(() => {
  spyDeriveFragment.mockReset();
  spyDeriveTokenized.mockReset();
});

const { codecFor } = $TokenizerService(fakeRequire);
const providers = $TrimmingProviders(fakeRequire);
const trimming = $TrimmingService(fakeRequire);

const mockParams: ContextParams = Object.freeze({ tokenCodec: codecFor(0, mockCodec) }) as any;

/**
 * Sets up the mock story, producing useful information for use in tests.
 * 
 * The returned object should only be used inside of tests.
 */
const withMockStory = () => {
  const assembly = mockNewAssembly(mockStory);
  const halfLength = Math.floor(mockStory.length / 2);
  const fullLength = mockStory.length + 20;
  let fullyEncoded: number[];
  let halfTokens: number;
  let fullTokens: number;

  beforeAll(async () => {
    fullyEncoded = await mockCodec.encode(mockStory);
    halfTokens = Math.floor(fullyEncoded.length / 2);
    fullTokens = fullyEncoded.length + 20;
  });

  return {
    get assembly() { return assembly; },
    get rawText() { return mockStory; },
    get fullyEncoded() { return fullyEncoded; },
    get halfLength() { return halfLength; },
    get fullLength() { return fullLength; },
    get halfTokens() { return halfTokens; },
    get fullTokens() { return fullTokens; }
  };
};

describe("createTrimmer", () => {
  // These will just test the structure of the object.
  // More complete tests of the trimming behaviors itself
  // will come in the `execTrimTokens` tests.

  it("should create a trimmer with the expected properties", () => {
    const assembly = mockNewAssembly(mockStory);
    const trimmer = trimming.createTrimmer(assembly, mockParams);

    expect(trimmer).toEqual(expect.any(Function));
    expect(trimmer).toEqual(expect.objectContaining({
      origin: assembly,
      provider: providers.basic.doNotTrim
    }));
  });

  it("should create a trimmer with replay capabilities", () => {
    const assembly = mockNewAssembly(mockStory);
    const trimmer = trimming.createTrimmer(assembly, mockParams, {}, true);

    expect(trimmer).toEqual(expect.any(Function));
    expect(trimmer).toEqual(expect.objectContaining({
      origin: assembly,
      provider: providers.basic.doNotTrim,
      clear: expect.any(Function)
    }));
  });

  it("should accept a specified provider as an option (by string)", () => {
    const assembly = mockNewAssembly(mockStory);
    const trimmer = trimming.createTrimmer(assembly, mockParams, {
      provider: "trimTop"
    });

    expect(trimmer).toEqual(expect.objectContaining({
      provider: providers.basic.trimTop
    }));
  });

  it("should accept a specified provider as an option (by reference)", () => {
    const assembly = mockNewAssembly(mockStory);
    const trimmer = trimming.createTrimmer(assembly, mockParams, {
      provider: providers.removeComments.trimBottom
    });

    expect(trimmer).toEqual(expect.objectContaining({
      provider: providers.removeComments.trimBottom
    }));
  });
});

describe("execTrimTokens", () => {
  // These are largely just going to be sanity checks that trimming
  // is doing what we expect.  Failures here might indicate a need
  // for a new test in another spec.

  const theStory = withMockStory();

  const basicTests = (trimmer: Trimmer) => {
    it("should trim to a budget", async () => {
      const { halfTokens } = theStory;

      const result = await trimming.execTrimTokens(trimmer, halfTokens);
      expect(result).not.toBeUndefined();

      const tokens = result?.tokens ?? [];
      expect(tokens.length).toBeLessThanOrEqual(halfTokens);
    });

    it("should have roughly half the characters of the assembly", async () => {
      const { rawText, halfTokens } = theStory;

      const result = await trimming.execTrimTokens(trimmer, halfTokens);
      const tokens = result?.tokens ?? [];
      const decoded = await mockCodec.decode(tokens);
      const distance = levDist.get(rawText, decoded);
      const ratio = distance / rawText.length;

      // Should be 50±1% similar.
      expect(ratio).toBeGreaterThanOrEqual(0.49);
      expect(ratio).toBeLessThanOrEqual(0.51);
    });
  };

  describe("with `trimBottom` trimmer", () => {
    const trimmer = trimming.createTrimmer(theStory.assembly, mockParams, {
      provider: "trimBottom",
      maximumTrimType: "token"
    });

    basicTests(trimmer);

    it("should include the beginning of the assembly, but not the end", async () => {
      const { rawText, halfTokens } = theStory;

      const result = await trimming.execTrimTokens(trimmer, halfTokens);
      const tokens = result?.tokens ?? [];

      const theStart = await mockCodec.decode(tokens.slice(0, 10));
      expect(Boolean(theStart && rawText.startsWith(theStart))).toBe(true);

      const theEnd = await mockCodec.decode(tokens.slice(-10));
      expect(Boolean(theEnd && rawText.endsWith(theEnd))).toBe(false);
    });

    it("should include the prefix/suffix in the tokens", async () => {
      const { halfTokens } = theStory;

      // Use an assembly/trimmer with prefix/suffix.
      const affixedAssembly = mockNewAssembly(mockStory, "[ foo ]\n", "\n[ bar ]");
      const affixedTrimmer = trimming.createTrimmer(affixedAssembly, mockParams, {
        provider: "trimBottom",
        maximumTrimType: "token"
      });

      const result = await trimming.execTrimTokens(affixedTrimmer, halfTokens);
      const tokens = result?.tokens ?? [];
      const decoded = await mockCodec.decode(tokens);

      expect(decoded).toMatch(/^\[ foo \]\n/);
      expect(decoded).toMatch(/\n\[ bar \]$/);
    });
  });

  describe("with `trimTop` trimmer", () => {
    const trimmer = trimming.createTrimmer(theStory.assembly, mockParams, {
      provider: "trimTop",
      maximumTrimType: "token"
    });

    basicTests(trimmer);

    it("should include the end of the assembly, but not the beginning", async () => {
      const { rawText, halfTokens } = theStory;

      const result = await trimming.execTrimTokens(trimmer, halfTokens);
      const tokens = result?.tokens ?? [];

      const theStart = await mockCodec.decode(tokens.slice(0, 10));
      expect(Boolean(theStart && rawText.startsWith(theStart))).toBe(false);

      const theEnd = await mockCodec.decode(tokens.slice(-10));
      expect(Boolean(theEnd && rawText.endsWith(theEnd))).toBe(true);
    });

    it("should include the prefix/suffix in the tokens", async () => {
      const { halfTokens } = theStory;

      // Use an assembly/trimmer with prefix/suffix.
      const affixedAssembly = mockNewAssembly(mockStory, "[ foo ]\n", "\n[ bar ]");
      const affixedTrimmer = trimming.createTrimmer(affixedAssembly, mockParams, {
        provider: "trimTop",
        maximumTrimType: "token"
      });

      const result = await trimming.execTrimTokens(affixedTrimmer, halfTokens);
      const tokens = result?.tokens ?? [];
      const decoded = await mockCodec.decode(tokens);

      expect(decoded).toMatch(/^\[ foo \]\n/);
      expect(decoded).toMatch(/\n\[ bar \]$/);
    });
  });

  describe("with `doNotTrim` trimmer", () => {
    // This trimmer works differently, as it ...does not trim.
    // But, it still produces a valid trimmer and it should check out.

    const trimmer = trimming.createTrimmer(theStory.assembly, mockParams, {
      provider: "doNotTrim"
    });

    it("should produce no result if it cannot fit the budget", async () => {
      const { halfTokens } = theStory;
      const result = await trimming.execTrimTokens(trimmer, halfTokens);
      expect(result).toBeUndefined();
    });

    it("should produce a the complete text if it fits the budget", async () => {
      const { rawText, fullTokens } = theStory;
      const result = await trimming.execTrimTokens(trimmer, fullTokens);
      expect(result).not.toBeUndefined();

      const decoded = await mockCodec.decode(result?.tokens ?? []);
      expect(decoded).toBe(rawText);
    });

    it("should include the prefix/suffix in the tokens", async () => {
      const { fullTokens } = theStory;

      // Use an assembly/trimmer with prefix/suffix.
      const affixedAssembly = mockNewAssembly(mockStory, "[ foo ]\n", "\n[ bar ]");
      const affixedTrimmer = trimming.createTrimmer(affixedAssembly, mockParams, {
        provider: "doNotTrim"
      });

      const result = await trimming.execTrimTokens(affixedTrimmer, fullTokens);
      const tokens = result?.tokens ?? [];
      const decoded = await mockCodec.decode(tokens);

      expect(decoded).toMatch(/^\[ foo \]\n/);
      expect(decoded).toMatch(/\n\[ bar \]$/);
    });
  });

  describe("the `preserveEnds` option", () => {
    // The way `preserveEnds` works is it just removes content-less
    // fragments produced by the trim-sequencers, but only:
    // - At the START of the FIRST trim-sequencer used.
    // - At the END of the LAST trim-sequencer used.

    // It does not function like `String.trim()` or anything like that.
    // It only removes content-less fragments produced by the splitters
    // when the above conditions are met, which is why:
    // - `byLine` separates out `"\n"` characters.
    // - `bySentence` separates out `"\n"` and whitespace between sentences.
    // - `byWord` separates out `"\n"` and whitespace between words.
    // These are all considered content-less.
    
    // Setting `preserveEnds` to `false` exploits this so these
    // content-less fragments get skipped so only fragments with
    // meaning to a person are ultimately provided for encoding.

    // That said, the encoders of the `TokenizerService` use contentful
    // fragments as encoding breakpoints; it skips content-less fragments
    // until it gets a contentful fragment or the iteration ends.
    // This will result in it dropping these fragments itself except
    // when it reaches the end of iteration, which is the only time this
    // will have an actual effect.
    
    // Why build that into the encoder instead of controlling it with
    // this option?  Because, encoding `"\nSentence here."` in one go
    // is faster than encoding `"\n"` and `"Sentence here."` separately,
    // with two costly hits to that background worker.  It's a performance
    // optimization for the encoder.

    // This is 13 tokens, when encoded.
    const assembly = mockNewAssembly("\n\n    foo.  bar.    \n\n");

    describe("with `byLine` splitting only", () => {
      it("should preserve ends when `true` (the default)", async () => {
        const trimmer = trimming.createTrimmer(assembly, mockParams, {
          provider: "trimBottom",
          maximumTrimType: "token",
          preserveEnds: true
        });

        const result = await trimming.execTrimTokens(trimmer, 100);
        const tokens = result?.tokens ?? [];
        // Since we can fit everything into budget, we'll get the exact
        // same output as we input.
        expect(tokens).toEqual(
          await mockCodec.encode("\n\n    foo.  bar.    \n\n")
        );
      });
    
      it("should not preserve ends when `false`", async () => {
        const trimmer = trimming.createTrimmer(assembly, mockParams, {
          provider: "trimBottom",
          maximumTrimType: "token",
          preserveEnds: false
        });

        const result = await trimming.execTrimTokens(trimmer, 100);
        const tokens = result?.tokens ?? [];
        // We'll lose the empty lines because we never had to switch from
        // the `newline` sequencer, but the trailing spaces will remain
        // since we never split a fragment any further.
        expect(tokens).toEqual(
          await mockCodec.encode("    foo.  bar.    ")
        );
      });
    });

    describe("with more aggressive splitting", () => {
      it("should preserve ends when `true` (the default)", async () => {
        const trimmer = trimming.createTrimmer(assembly, mockParams, {
          provider: "trimBottom",
          maximumTrimType: "token",
          preserveEnds: true
        });

        // With 7 tokens, we could fit up to: `"\n\n    foo.  "`
        const result = await trimming.execTrimTokens(trimmer, 7);
        const tokens = result?.tokens ?? [];
        // The leading `"\n\n"` is preserved during `newline` sequencing,
        // but the encoder won't encode the `"  "` on its own, which
        // busts the budget when `"bar."` comes in after it.  We ended
        // up with 6 tokens.
        expect(tokens).toEqual(
          await mockCodec.encode("\n\n    foo.")
        );
      });
    
      it("should not preserve ends when `false`", async () => {
        const trimmer = trimming.createTrimmer(assembly, mockParams, {
          provider: "trimBottom",
          maximumTrimType: "token",
          preserveEnds: false
        });

        // With 5 tokens, we could fit up to: `"\n\n    foo"`
        const result = await trimming.execTrimTokens(trimmer, 5);
        const tokens = result?.tokens ?? [];
        // The leading `"\n\n"` is dropped during the `newline` sequencing.
        // The `"  "` after `"foo."` is also dropped (mostly due to the
        // internal encoder optimization).  We ended up with 4 tokens,
        // which includes the period, which was only possible to nab
        // because the leading newlines were dropped.
        expect(tokens).toEqual(
          await mockCodec.encode("    foo.")
        );
      });
    });
  });
});

describe("trimByTokens", () => {
  // We're just going to check that this does what it says on
  // the tin.  It should just make a trimmer and call `execTrimTokens`.

  const theStory = withMockStory();

  it("should perform the desired trim", async () => {
    const { assembly, rawText, halfTokens } = theStory;

    const result = await trimming.trimByTokens(assembly, halfTokens, mockParams, {
      provider: "trimBottom",
      maximumTrimType: "token"
    });
    expect(result).not.toBeUndefined();

    // Checking the budget was hit.
    const tokens = result?.tokens ?? [];
    expect(tokens.length).toBeLessThanOrEqual(halfTokens);

    // Checking that it was `trimBottom`.
    const theStart = await mockCodec.decode(tokens.slice(0, 10));
    expect(Boolean(theStart && rawText.startsWith(theStart))).toBe(true);

    const theEnd = await mockCodec.decode(tokens.slice(-10));
    expect(Boolean(theEnd && rawText.endsWith(theEnd))).toBe(false);

    // Checking the result is 50±1% similar.
    const decoded = await mockCodec.decode(tokens);
    const distance = levDist.get(rawText, decoded);
    const ratio = distance / rawText.length;

    expect(ratio).toBeGreaterThanOrEqual(0.49);
    expect(ratio).toBeLessThanOrEqual(0.51);
  });
});

describe("trimByLength", () => {
  // This is again mostly just a sanity check.

  const theStory = withMockStory();

  const basicTests = (provider: TrimDirection) => {
    it("should trim to a budget", async () => {
      const { assembly, halfLength } = theStory;

      const result = await trimming.trimByLength(assembly, halfLength, { provider });
      expect(result).not.toBeUndefined();

      const fullText = Array.from(result ?? []).join("");
      expect(fullText.length).toBeLessThanOrEqual(halfLength);
    });

    it("should have roughly half the characters of the assembly", async () => {
      const { assembly, rawText, halfLength } = theStory;

      const result = await trimming.trimByLength(assembly, halfLength, { provider });
      const fullText = Array.from(result ?? []).map(toContent).join("");
      const distance = levDist.get(rawText, fullText);
      const ratio = distance / rawText.length;

      // Should be 50±1% similar.
      expect(ratio).toBeGreaterThanOrEqual(0.49);
      expect(ratio).toBeLessThanOrEqual(0.51);
    });
  };

  describe("with `trimBottom` trimmer", () => {
    const provider = "trimBottom";

    basicTests(provider);

    it("should include the beginning of the assembly, but not the end", async () => {
      const { assembly, rawText, halfLength } = theStory;

      const result = await trimming.trimByLength(assembly, halfLength, { provider });
      const fullText = Array.from(result ?? []).map(toContent).join("");

      const theStart = fullText.slice(0, 100);
      expect(Boolean(theStart && rawText.startsWith(theStart))).toBe(true);

      const theEnd = fullText.slice(-100);
      expect(Boolean(theEnd && rawText.endsWith(theEnd))).toBe(false);
    });

    it.todo("should take the prefix/suffix into consideration");
  });

  describe("with `trimTop` trimmer", () => {
    const provider = "trimTop";

    basicTests(provider);

    it("should include the end of the assembly, but not the beginning", async () => {
      const { assembly, rawText, halfLength } = theStory;

      const result = await trimming.trimByLength(assembly, halfLength, { provider });
      const fullText = Array.from(result ?? []).map(toContent).join("");

      const theStart = fullText.slice(0, 100);
      expect(Boolean(theStart && rawText.startsWith(theStart))).toBe(false);

      const theEnd = fullText.slice(-100);
      expect(Boolean(theEnd && rawText.endsWith(theEnd))).toBe(true);
    });

    it.todo("should take the prefix/suffix into consideration");
  });

  describe("with `doNotTrim` trimmer", () => {
    // This trimmer works differently, as it ...does not trim.
    // But it should still work when provided.

    const provider = "doNotTrim";

    it("should produce no result if it cannot fit the budget", async () => {
      const { assembly, halfLength } = theStory;
      const result = await trimming.trimByLength(assembly, halfLength, { provider });
      expect(result).toBeUndefined();
    });

    it("should produce a the complete text if it fits the budget", async () => {
      const { assembly, rawText, fullLength } = theStory;
      const result = await trimming.trimByLength(assembly, fullLength, { provider });
      expect(result).not.toBeUndefined();

      const fullText = Array.from(result ?? []).map(toContent).join("");
      expect(fullText).toBe(rawText);
    });

    it.todo("should take the prefix/suffix into consideration");
  });
});