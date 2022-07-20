import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockFragment, toContent } from "@spec/helpers-splitter";
import { withComments } from "@spec/mock-story";

import _zip from "lodash/zip";
import { dew } from "@utils/dew";
import { chain, interweave, flatMap, iterReverse, skipRight } from "@utils/iterables";
import $TrimmingProviders from "./TrimmingProviders";

import type { TextFragment } from "./TextSplitterService";
import type { TrimProvider, SplitterFn } from "./TrimmingProviders";
import type { Assembly } from "./assemblies";

const providers = $TrimmingProviders(fakeRequire);

// The basic providers are pretty simple and pretty much just
// call out to the text splitters.  The exception are the ones
// that remove comments, which do a bit of parsing.  We're
// largely going to be testing those here.

describe("comment removal", () => {
  // The remove comment providers only really change how `preProcess`
  // and `newline` work, so only those will be tested.  Each line
  // containing a comment should just be made not to exist, as if the
  // line were never there at all.

  /**
   * Our simple test-cases for comments.
   * 
   * In all cases, the joined string should equal `expected`.
   */
  const simpleTests = dew(() => {
    // In the end this is what we should end up with.
    const baseLines = [
      "This is a line of text.",
      "And now another line of text!"
    ] as [string, string];

    const expected = baseLines.join("\n");

    const cases = [
      {
        should: "not affect inputs without comments",
        input: baseLines,
        expected
      },
      {
        should: "remove one comment from the start",
        input: [
          "## This is a comment at the start.",
          ...baseLines
        ],
        expected
      },
      {
        should: "remove multiple comments from the start",
        input: [
          "## This is a comment at the start.",
          "## This is another comment at the start.",
          ...baseLines
        ],
        expected
      },
      {
        should: "preserve empty line at start",
        input: [
          "",
          "## This is a comment after an initial empty line.",
          ...baseLines
        ],
        expected: `\n${expected}`
      },
      {
        should: "remove one comment from the middle",
        input: [
          baseLines[0],
          "## This is a comment in the middle.",
          baseLines[1],
        ],
        expected
      },
      {
        should: "remove multiple comments from the middle",
        input: [
          baseLines[0],
          "## This is a comment in the middle.",
          "## This is another comment in the middle.",
          baseLines[1],
        ],
        expected
      },
      {
        should: "remove one comment from the end",
        input: [
          ...baseLines,
          "## This is a comment at the end."
        ],
        expected
      },
      {
        should: "remove multiple comments from the end",
        input: [
          ...baseLines,
          "## This is a comment just before the end.",
          "## This is a comment at the end."
        ],
        expected
      },
      {
        should: "preserve empty line at end",
        input: [
          ...baseLines,
          "## This is a comment before a final empty line.",
          ""
        ],
        expected: `${expected}\n`
      }
    ];

    return { baseLines, cases } as const;
  });

  // These currently only interact with the `content` property.
  const mockAssembly = (lines: readonly string[]): Assembly.Fragment => {
    const content = chain(lines)
      .pipe(interweave, "\n")
      .value((iter) => Object.freeze([mockFragment([...iter].join(""), 10)]));
    return Object.freeze({ content }) as any;
  };

  const toOutput = (
    fragments: Iterable<TextFragment>,
    providerFn: SplitterFn,
    reversed: boolean
  ): string => {
    return chain(fragments)
      .thru((iter) => flatMap(iter, providerFn))
      .map(toContent)
      .thru((iter) => reversed ? iterReverse(iter) : iter)
      .value((iter) => [...iter].join(""));
  };

  /** Performs some basic tests with the given `provider`. */
  const basicTests = (
    preProcess: TrimProvider["preProcess"],
    providerFn: SplitterFn,
    reversed: boolean
  ) => {
    for (const theCase of simpleTests.cases) {
      it(`should ${theCase.should}`, () => {
        const assembly = mockAssembly(theCase.input);
        const input = preProcess(assembly);
        expect(toOutput(input, providerFn, reversed)).toBe(theCase.expected);
      });
    }
  };

  const fragmentTest = (
    preProcess: TrimProvider["preProcess"],
    providerFn: SplitterFn,
    reversed: boolean
  ) => {
    it("should preserve fragment offsets", () => {
      const assembly = mockAssembly([withComments]);
      const input = preProcess(assembly);
      const result = [...flatMap(input, providerFn)];

      const reSplit = reversed ? /\n?(?:## )?.*/g : /(?:## )?.*\n?/g;
      const reCommentLine = reversed ? /^\n?##/ : /^##/;
      const checkFrags = chain(withComments.matchAll(reSplit))
        // Drop lines with comments.
        .filter(([text]: string[]) => !reCommentLine.test(text))
        // Break the non-comment lines into fragments of either
        // `"\n"` or other text.
        .thru(function*(iter) {
          for (const match of iter) {
            const outerOffset = match.index ?? 0;
            for (const frag of match[0].matchAll(/\n|.*/g)) {
              if (!frag[0]) continue;
              const innerOffset = frag?.index ?? 0;
              yield mockFragment(frag[0], 10 + innerOffset + outerOffset);
            }
          }
        })
        // Reverse, if needed.
        .thru((iter) => reversed ? iterReverse(iter) : iter)
        // The last fragment is a `"\n"` that should not exist in the result.
        .pipe(skipRight, 1)
        .toArray();

      expect(result).toEqual(checkFrags);
    });
  };

  describe("`trimBottom` provider", () => {
    const provider = providers.removeComments.trimBottom;
    const { preProcess, newline, reversed } = provider;

    it("should pre-process by extracting the assembly's content", () => {
      const assembly = mockAssembly(simpleTests.baseLines);
      expect(preProcess(assembly)).toBe(assembly.content);
    });

    basicTests(preProcess, newline, reversed);
    fragmentTest(preProcess, newline, reversed);
  });

  describe("`trimTop` provider", () => {
    const provider = providers.removeComments.trimTop;
    const { preProcess, newline, reversed } = provider;

    it("should pre-process by extracting the assembly's content", () => {
      const assembly = mockAssembly(simpleTests.baseLines);
      expect(preProcess(assembly)).toBe(assembly.content);
    });

    basicTests(preProcess, newline, reversed);
    fragmentTest(preProcess, newline, reversed);
  });

  describe("`doNotTrim` provider", () => {
    // This one functions a little differently, as it changes how
    // `preProcess` works, but it ultimately defers to `trimBottom`.
    const provider = providers.removeComments.doNotTrim;
    const { preProcess, newline, reversed } = provider;

    for (const theCase of simpleTests.cases) {
      it(`should ${theCase.should}`, () => {
        const assembly = mockAssembly(theCase.input);
        const output = [...preProcess(assembly)].map(toContent);
        expect(output.join("")).toBe(theCase.expected);
      });
    }

    // Using a faux `SplitterFn` here so we only test `preProcess`.
    fragmentTest(preProcess, (frag) => [frag], reversed);

    it("should have a noop `newline` method", () => {
      const fragments = mockAssembly(simpleTests.baseLines).content;
      expect(toOutput(fragments, newline, reversed)).toBe("");
    });
  });
});