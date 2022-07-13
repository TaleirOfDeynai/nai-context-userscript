import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockFragment, getEmptyFrag } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";
import { offsetFrags } from "@spec/helpers-assembly";

import { dew } from "@utils/dew";
import { chain, first, last } from "@utils/iterables";
import $FromFullText from "./fromFullText";

import type { GenerateOpts, AssemblyData } from "@spec/helpers-assembly";
import type { TextFragment } from "../../TextSplitterService";

const { fromFullText } = $FromFullText(fakeRequire);

describe("fromFullText", () => {
  describe("sanity checks", () => {
    const testData = offsetFrags;

    it.failing("should FAIL if cursor is not full-text", () => {
      const offset = insideFrag(mockFragment(testData.getText(), 0));
      const cursor = testData.inFrag(offset);

      fromFullText(testData, cursor as any);
    });

    it.failing("should FAIL if cursor is not for the assembly", () => {
      const cursor = mockCursor(20, "fullText", { origin: {} });

      fromFullText(testData, cursor);
    });

    it.failing("should FAIL is cursor is out of bounds of the text", () => {
      const offset = afterFrag(mockFragment(testData.getText(), 0));
      const cursor = testData.inText(offset + 3);

      fromFullText(testData, cursor);
    });
  });

  // This method has a lot of disambiguation cases that it handles,
  // where the full-text cursor falls between two fragments and
  // rules need to be applied to figure out which is the best fragment
  // to base the fragment cursor on.

  // Many of these cases are redundantly checked by the procedural cases
  // below, so chances are if you have an error here, you will also have
  // dozens of failures in the other tests.  If you are not making a
  // change that affects the behavior of this function, fix these tests
  // first before addressing the procedural ones.
  describe("offset disambiguation", () => {
    describe("when cursor is between two content fragments", () => {
      describe("when one is wordy and the other not", () => {
        // Already covered, but these are explicit checks.
        it.todo("should favor the wordy fragment if it comes before");
        it.todo("should favor the wordy fragment if it comes after");
      });

      describe("when both are wordy", () => {
        const sourceData = generateData(0, {
          ...NO_AFFIX,
          content: ["foo", "DROP ME", "bar"]
        });

        const testData = {
          ...sourceData,
          // Drop the middle fragment so there's a gap.  We'll use this
          // to determine which fragment's offset was used.
          content: [sourceData.content[0], sourceData.content[2]]
        };

        it("should favor the first fragment", () => {
          const cursor = testData.inText(3);
          const result = fromFullText(testData, cursor);

          expect(result).toEqual(testData.inFrag(afterFrag(sourceData.content[0])));
        });
      });

      describe("when neither is wordy", () => {
        const sourceData = generateData(0, {
          ...NO_AFFIX,
          content: ["  ", "DROP ME", "  "]
        });

        const testData = {
          ...sourceData,
          // Drop the middle fragment so there's a gap.  We'll use this
          // to determine which fragment's offset was used.
          content: [sourceData.content[0], sourceData.content[2]]
        };

        it("should favor the first fragment", () => {
          const cursor = testData.inText(2);
          const result = fromFullText(testData, cursor);

          expect(result).toEqual(testData.inFrag(afterFrag(sourceData.content[0])));
        });
      });
    });

    describe("when cursor in boundaries of prefix or suffix", () => {
      const testData = offsetFrags;

      const prefixLength = testData.prefix.content.length;
      const contentLength = chain(testData.content)
        .map((f) => f.content.length)
        .reduce(0 as number, (a, c) => a + c);

      it("should map to start of the prefix fragment", () => {
        const offset = beforeFrag(testData.prefix) - testData.prefix.offset;
        const cursor = testData.inText(offset);
        const result = fromFullText(testData, cursor);

        expect(result).toEqual(testData.inFrag(beforeFrag(testData.prefix)));
      });

      it("should map to inside of the prefix fragment", () => {
        const offset = insideFrag(testData.prefix) - testData.prefix.offset;
        const cursor = testData.inText(offset);
        const result = fromFullText(testData, cursor);

        expect(result).toEqual(testData.inFrag(insideFrag(testData.prefix)));
      });

      it("should map to inside of the suffix fragment", () => {
        const relOffset = insideFrag(testData.suffix) - testData.suffix.offset;
        const offset = prefixLength + contentLength + relOffset;
        const cursor = testData.inText(offset);
        const result = fromFullText(testData, cursor);

        expect(result).toEqual(testData.inFrag(insideFrag(testData.suffix)));
      });

      it("should map to end of the suffix fragment", () => {
        const relOffset = afterFrag(testData.suffix) - testData.suffix.offset;
        const offset = prefixLength + contentLength + relOffset;
        const cursor = testData.inText(offset);
        const result = fromFullText(testData, cursor);

        expect(result).toEqual(testData.inFrag(afterFrag(testData.suffix)));
      });

      // Already covered, but these are explicit checks.
      it.todo("should favor content when ambiguous with prefix");
      it.todo("should favor content when ambiguous with suffix");
    });

    describe("when content is empty", () => {
      const sourceData = offsetFrags;

      // Can only happen only when we have no content fragments.
      describe("when ambiguous between prefix and suffix fragments", () => {
        describe("when prefix is non-empty", () => {
          const testData = {
            ...sourceData,
            content: [],
            source: sourceData
          };

          it("should map to end of prefix fragment", () => {
            const cursor = testData.inText(testData.prefix.content.length);
            const result = fromFullText(testData, cursor);

            expect(result).toEqual(testData.inFrag(afterFrag(testData.prefix)));
          });
        });

        describe("when prefix is empty and suffix is non-empty", () => {
          const testData = {
            ...sourceData,
            prefix: getEmptyFrag(sourceData.prefix),
            content: [],
            source: sourceData
          };

          it("should map to start of suffix fragment", () => {
            const cursor = testData.inText(0);
            const result = fromFullText(testData, cursor);

            expect(result).toEqual(testData.inFrag(beforeFrag(testData.suffix)));
          });
        });
      });

      // These deal with the fail-safe behavior.
      describe("when prefix and suffix are also empty", () => {
        it("should map to end of source's prefix if possible", () => {
          // Naturally, we need a `source` for it to work.
          const testData = {
            ...sourceData,
            prefix: getEmptyFrag(sourceData.prefix),
            content: [],
            suffix: getEmptyFrag(sourceData.suffix),
            source: sourceData
          };

          const cursor = testData.inText(0);
          const result = fromFullText(testData, cursor);

          expect(result).toEqual(testData.inFrag(afterFrag(sourceData.prefix)));
        });

        it("should map to offset 0 as a fail-safe", () => {
          // No `source` this time.
          const testData = {
            ...sourceData,
            prefix: getEmptyFrag(sourceData.prefix),
            content: [],
            suffix: getEmptyFrag(sourceData.suffix)
          };

          const cursor = testData.inText(0);
          const result = fromFullText(testData, cursor);

          expect(result).toEqual(testData.inFrag(0));
        });
      });
    });
  });

  describe("procedural tests", () => {
    type ContentModifier = (content: readonly TextFragment[]) => readonly TextFragment[];

    interface SpecParams {
      name: string,
      cursorOffset: number,
      expectedOffset: number
    }

    interface DescribeParams {
      name: string,
      testData: AssemblyData,
      theSpecs: readonly SpecParams[]
    }

    const specRunner = (testData: AssemblyData) => (specParams: SpecParams) => {
      const cursorOffset = specParams.cursorOffset as number;
      const expectedOffset = specParams.expectedOffset as number;

      const cursor = testData.inText(cursorOffset);
      const result = fromFullText(testData, cursor);

      expect(result).toEqual(testData.inFrag(expectedOffset));
    };

    const describeRunner = (describeParams: DescribeParams) => {
      const { testData, theSpecs } = describeParams;
      it.each(theSpecs)("$name", specRunner(testData));
    };

    // We want to test a wide variety of odd assembly scenarios.
    // The assembly will have 5 fragments, 3 sentence fragments
    // separated by whitespace fragments.
    const baseAssemblyMods = {
      affixing: new Map<string, Readonly<GenerateOpts>>([
        ["un-affixed", NO_AFFIX],
        ["affixed", {}]
      ]),
      offsets: new Map([
        ["content not offset", 0],
        ["content offset", 3]
      ]),
      continuity: new Map<string, ContentModifier>([
        ["contiguous", (c) => c],
        // Inserts a gap of 10 characters at the 3rd fragment on.
        ["non-contiguous", (c) => [
          ...c.slice(0, 2),
          ...c.slice(2).map((f) => mockFragment(f.content, f.offset + 10))
        ]]
      ]),
      ordering: new Map<string, ContentModifier>([
        ["in order", (c) => c],
        // By this, I mean swapping sentences, not array indices.
        ["first and second swapped", (c) => [c[2], c[1], c[0], c[3], c[4]]],
        ["second and third swapped", (c) => [c[0], c[1], c[4], c[3], c[2]]]
      ])
    } as const;

    function* produceForDescribe(
      produceForSpecs: (testData: AssemblyData) => Iterable<SpecParams>,
      assemblyMods = baseAssemblyMods
    ): Iterable<DescribeParams> {
      for (const [affixStr, affixArg] of assemblyMods.affixing) {
        for (const [offStr, offsetArg] of assemblyMods.offsets) {
          const assemblyData = generateData(offsetArg, affixArg);

          for (const [contStr, contFn] of assemblyMods.continuity) {
            for (const [orderStr, orderFn] of assemblyMods.ordering) {
              const initContent = assemblyData.content;
              const withContinuity = contFn(initContent);
              const withOrdering = orderFn(withContinuity);

              const testData = {
                ...assemblyData,
                content: withOrdering,
                isContiguous: withOrdering === initContent
              };

              // If a name part is empty, we'll omit it.
              const nameParts = [affixStr, offStr, contStr, orderStr].filter(Boolean).join(", ");

              yield {
                name: `when ${nameParts}`,
                testData,
                theSpecs: [...produceForSpecs(testData)]
              } as const;
            }
          }
        }
      }
    }

    // These are procedural tests checking for correct mappings for
    // cursors that are within the boundaries of the content block.
    // These tests are cheating a bit, in that the `generateAssembly`
    // function produces assemblies with non-wordy fragments separating
    // wordy fragments in the `content` array.  This allows us to have
    // a one-to-one mapping between the full-text and assembly domains.
    describe("with cursor in content block", () => {
      const theDescribes = dew(() => {
        // And we want to make sure that we map cursors to different parts
        // of different content fragments correctly.
        const cursorMods = {
          indices: new Map([
            ["first sentence", 0],
            ["middle sentence", 2],
            ["last sentence", 4]
          ]),
          positions: new Map([
            ["start of", beforeFrag],
            ["inside of", insideFrag],
            ["end of", afterFrag]
          ])
        } as const;

        function* forContent(testData: AssemblyData) {
          for (const [idxStr, fragIndex] of cursorMods.indices) {
            for (const [posStr, posFn] of cursorMods.positions) {
              const { prefix, content, suffix } = testData;

              const targetFrag = content[fragIndex];
              const expectedOffset = posFn(targetFrag);
              const cursorOffset = dew(() => {
                let curOffset = 0;
                for (const curFrag of [prefix, ...content, suffix]) {
                  if (curFrag === targetFrag) break;
                  curOffset += curFrag.content.length;
                }
                return curOffset + (expectedOffset - targetFrag.offset);
              });

              yield {
                name: `should map to ${posStr} ${idxStr}`,
                cursorOffset,
                expectedOffset
              } as const;
            }
          }
        }

        return [...produceForDescribe(forContent)];
      });

      describe.each(theDescribes)("$name", describeRunner);
    });

    // These are procedural tests for cursors that are in the boundaries
    // of the prefix block.  We have one special case in that when
    // the cursor is at the end of the prefix, it will be mapped to the
    // start of the first content fragment instead.
    describe("with cursor in prefix block", () => {
      const theDescribes = dew(() => {
        type PositionModifier = (assembly: AssemblyData) => number;

        // Different parts of the prefix have different mappings.
        const cursorMods = {
          positions: new Map<string, PositionModifier | [PositionModifier, PositionModifier]>([
            ["to start of prefix", (a) => beforeFrag(a.prefix)],
            ["to inside of prefix", (a) => insideFrag(a.prefix)],
            ["from end of prefix to start of content", [
              (a) => afterFrag(a.prefix),
              (a) => beforeFrag(first(a.content))
            ]]
          ])
        } as const;

        function* forPrefix(testData: AssemblyData) {
          for (const [posStr, posMod] of cursorMods.positions) {
            const { prefix } = testData;
            const [originFn, expectedFn] = Array.isArray(posMod) ? posMod : [posMod, posMod];

            const expectedOffset = expectedFn(testData);
            const cursorOffset = originFn(testData) - prefix.offset;

            yield {
              name: `should map ${posStr}`,
              cursorOffset,
              expectedOffset
            } as const;
          }
        }

        // We always want the affixing.
        return [...produceForDescribe(forPrefix, {
          ...baseAssemblyMods,
          affixing: new Map([["", {}]])
        })];
      });

      describe.each(theDescribes)("$name", describeRunner);
    });

    // These are procedural tests for cursors that are in the boundaries
    // of the suffix block.  We have one special case in that when
    // the cursor is at the start of the suffix, it will be mapped to the
    // end of the last content fragment instead.
    describe("with cursor in suffix block", () => {
      const theDescribes = dew(() => {
        type PositionModifier = (assembly: AssemblyData) => number;

        // Different parts of the suffix have different mappings.
        const cursorMods = {
          positions: new Map<string, PositionModifier | [PositionModifier, PositionModifier]>([
            ["from start of suffix to end of content", [
              (a) => beforeFrag(a.suffix),
              (a) => afterFrag(last(a.content))
            ]],
            ["to inside of suffix", (a) => insideFrag(a.suffix)],
            ["to end of suffix", (a) => afterFrag(a.suffix)]
          ])
        } as const;

        function* forSuffix(testData: AssemblyData) {
          for (const [posStr, posMod] of cursorMods.positions) {
            const { prefix, suffix, content } = testData;
            const [originFn, expectedFn] = Array.isArray(posMod) ? posMod : [posMod, posMod];

            const suffixRelative = originFn(testData) - suffix.offset;
            const expectedOffset = expectedFn(testData);
            const contentLength = chain(content)
              .map((f) => f.content.length)
              .reduce(0 as number, (a, c) => a + c);
            const cursorOffset = prefix.content.length + contentLength + suffixRelative;

            yield {
              name: `should map ${posStr}`,
              cursorOffset,
              expectedOffset
            } as const;
          }
        }

        // We always want the affixing.
        return [...produceForDescribe(forSuffix, {
          ...baseAssemblyMods,
          affixing: new Map([["", {}]])
        })];
      });

      describe.each(theDescribes)("$name", describeRunner);
    });
  });
});