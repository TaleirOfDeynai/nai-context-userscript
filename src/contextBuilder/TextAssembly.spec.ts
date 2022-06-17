import { jest, describe, it, expect } from "@jest/globals";
import { mockStory } from "@spec/mock-story";
import { mockFragment, toFragmentSeq, toContent } from "@spec/helpers-splitter";
import { mockCursor, afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";

import { dew } from "@utils/dew";
import { chain, first, last } from "@utils/iterables";
import $TextAssembly from "./TextAssembly";
import AppConstants from "@nai/AppConstants";

import type { UndefOr } from "@utils/utility-types";
import type { TextAssembly, TextCursor } from "./TextAssembly";
import type { TextFragment } from "./TextSplitterService";
import type { MatchResult } from "./MatcherService";

const fakeRequire: any = (module: any) => {
  switch (module) {
    // Imported by `TextSplitterService`.
    case AppConstants: return {
      contextSize: 2000
    };
    default: return {};
  }
};

const assembly = $TextAssembly(fakeRequire);

describe("isCursorInside", () => {
  const { isCursorInside } = assembly;

  const fragment = mockFragment("0123456789", 10);

  it("should know when a cursor is inside a fragment", () => {
    const result = isCursorInside(mockCursor(13), fragment);
    expect(result).toBe(true);
  });

  it("should accept the start position as inside", () => {
    const result = isCursorInside(mockCursor(10), fragment);
    expect(result).toBe(true);
  });

  it("should accept the end position as inside", () => {
    const result = isCursorInside(mockCursor(20), fragment);
    expect(result).toBe(true);
  });

  it("should not accept any other position as inside", () => {
    const before = isCursorInside(mockCursor(9), fragment);
    expect(before).toBe(false);

    const after = isCursorInside(mockCursor(21), fragment);
    expect(after).toBe(false);
  });
});

describe("asAssemblyCursor", () => {
  const { asAssemblyCursor } = assembly;

  // This relies heavily on `TextAssembly.fromFullText`.
  // We're only going to test that it attempts the conversion when
  // it is necessary, so we're not double-testing.

  it("should return the cursor as-is when already an assembly cursor", () => {
    const cursor = mockCursor(10, "assembly");
    expect(asAssemblyCursor(cursor)).toBe(cursor);
  });

  it("should attempt to convert the cursor if it is a full-text cursor", () => {
    // We only need this function to test.
    const mockOrigin = { fromFullText: jest.fn() };
    const cursor = mockCursor(30, "fullText", mockOrigin);

    asAssemblyCursor(cursor);
    expect(mockOrigin.fromFullText).toHaveBeenCalledWith(cursor);
  });
});

describe("toSelection", () => {
  const { toSelection } = assembly;

  // This makes calls out to `asAssemblyCursor` to handle the conversion
  // when the `type` argument is `"fullText"`.  We'll just use a spoof'd
  // implementation of `TextAssembly.fromFullText` to fake a conversion
  // in a detectable way.

  const mockOrigin = {
    fromFullText: jest.fn((cursor: TextCursor) => {
      return mockCursor(cursor.offset + 10, "assembly", cursor.origin);
    })
  };

  afterEach(() => mockOrigin.fromFullText.mockClear());

  const mockMatch: MatchResult = Object.freeze({
    match: "foo",
    groups: Object.freeze([]),
    namedGroups: Object.freeze({}),
    index: 30,
    length: 3
  });

  it("should convert from an assembly match", () => {
    const result = toSelection(mockMatch, mockOrigin as any, "assembly");
    expect(result).toEqual([
      mockCursor(30, "assembly", mockOrigin),
      mockCursor(33, "assembly", mockOrigin)
    ]);

    expect(mockOrigin.fromFullText).not.toHaveBeenCalled();
  });

  it("should convert from a full-text match", () => {
    const result = toSelection(mockMatch, mockOrigin as any, "fullText");
    expect(result).toEqual([
      mockCursor(40, "assembly", mockOrigin),
      mockCursor(43, "assembly", mockOrigin)
    ]);

    expect(mockOrigin.fromFullText).toHaveBeenCalledTimes(2);
  });

  it("should return an identical cursor instance for a zero-length match", () => {
    const zeroMatch: MatchResult = Object.freeze({
      match: "",
      groups: Object.freeze([]),
      namedGroups: Object.freeze({}),
      index: 30,
      length: 0
    });

    const result = toSelection(zeroMatch, mockOrigin as any, "assembly");
    expect(result[0]).toEqual(mockCursor(30, "assembly", mockOrigin));
    expect(result[0]).toBe(result[1]);
  });
});

describe("getStats", () => {
  const { getStats } = assembly;

  // This is just a simple convenience function for a few common
  // operations used to inspect a collection of fragments.
  // We'll test all the individual stats in aggregate.

  it("should determine the expected stats (in order)", () => {
    const fragments = [
      mockFragment("foo", 10),
      mockFragment("bar", 13)
    ];

    const result = getStats(fragments);
    expect(result).toEqual({
      minOffset: 10,
      maxOffset: 16,
      impliedLength: 6,
      concatLength: 6
    });
  });

  it("should determine the expected stats (with gaps)", () => {
    const fragments = [
      mockFragment("foo", 10),
      mockFragment("bar", 20)
    ];

    const result = getStats(fragments);
    expect(result).toEqual({
      minOffset: 10,
      maxOffset: 23,
      impliedLength: 13,
      concatLength: 6
    });
  });

  it("should determine the expected stats (out of order & with gaps)", () => {
    const fragments = [
      mockFragment("bar", 20),
      mockFragment("foo", 10)
    ];

    const result = getStats(fragments);
    expect(result).toEqual({
      minOffset: 10,
      maxOffset: 23,
      impliedLength: 13,
      concatLength: 6
    });
  });
});

describe("TextAssembly", () => {
  const { TextAssembly } = assembly;

  // The text assembly is the primary abstraction used during the final
  // assembly of the context, and so is pretty loaded.

  // For the moment, I'm only going to test the portions I need to know
  // are working to continue with the context assembler with reasonable
  // confidence.

  const generateAssembly = (
    contentOffset: number,
    doPrefix: boolean = true,
    doSuffix: boolean = true
  ) => {
    const prefix = mockFragment(doPrefix ? "PREFIX\n" : "", 0);
    
    const content = toFragmentSeq([
      "This is the first fragment.",
      "\n",
      "This is the second fragment.",
      "  ",
      "This is the third fragment."
    ], prefix.content.length + contentOffset);

    const maxOffset = content
      .map(afterFrag)
      .reduce((acc, o) => Math.max(acc, o), 0);

    const suffix = mockFragment(doSuffix ? "\nSUFFIX" : "", maxOffset + contentOffset);

    return { prefix, content, suffix, maxOffset };
  };

  /**
   * These fragments have no gap between the first fragment and the prefix.
   */
  const contiguousFrags = generateAssembly(0);

  /**
   * These fragments have a 3 character gap between the content and the
   * prefix and suffix.  These will likely see the most use in tests,
   * having a slight bit of awkwardness to them.
   */
  const offsetFrags = generateAssembly(3);

  describe("construction", () => {
    it.failing("should FAIL if given a `source` that is not a source assembly", () => {
      new TextAssembly(
        mockFragment("", 0),
        [mockFragment("", 0)],
        mockFragment("", 0),
        true,
        { isSource: false } as TextAssembly
      );
    });

    it.failing("should throw if given a `prefix` that is not at offset `0`", () => {
      new TextAssembly(
        mockFragment("", 10),
        [mockFragment("", 10)],
        mockFragment("", 10),
        true,
        null
      );
    });
  });

  describe("static methods", () => {
    // Being a private variable, there's no simple way to check that
    // the `assumeContinuity` option is doing what it should.
    // I'm going to leave those as todo, in case I care later.

    describe("fromSource", () => {
      it("should handle raw text", () => {
        const result = TextAssembly.fromSource(mockStory);

        expect(result.content).toEqual([mockFragment(mockStory, 0)]);
        expect(Object.isFrozen(result.content)).toBe(true);
        expect(result.prefix).toEqual(mockFragment("", 0));
        expect(result.suffix).toEqual(mockFragment("", mockStory.length));
      });

      it("should handle a provided fragment", () => {
        const storyFrag = mockFragment(mockStory, 10);
        const result = TextAssembly.fromSource(storyFrag);

        expect(result.content).toEqual([storyFrag]);
        expect(Object.isFrozen(result.content)).toBe(true);
        expect(result.prefix).toEqual(mockFragment("", 0));
        expect(result.suffix).toEqual(mockFragment("", mockStory.length + 10));
      });

      it("should create appropriate prefix and suffix fragments", () => {
        const result = TextAssembly.fromSource(mockStory, {
          prefix: "PREFIX\n",
          suffix: "\nSUFFIX"
        });

        expect(result.content).toEqual([mockFragment(mockStory, 7)]);
        expect(result.prefix).toEqual(mockFragment("PREFIX\n", 0));
        expect(result.suffix).toEqual(mockFragment("\nSUFFIX", mockStory.length + 7));
      });
    });

    describe("fromFragments", () => {
      it("should create from immutable array of fragments", () => {
        const { content, maxOffset } = offsetFrags;

        const result = TextAssembly.fromFragments(content);

        // Referential equality since `content` should be an immutable array.
        expect(result.content).toBe(content);

        expect(result.prefix).toEqual(mockFragment("", 0));
        expect(result.suffix).toEqual(mockFragment("", maxOffset));
      });

      it("should create from mutable array of fragments", () => {
        const { content, maxOffset } = offsetFrags;

        const copyFrags = [...content];
        const result = TextAssembly.fromFragments(copyFrags);

        // It should make a safe, immutable copy of the fragments.
        expect(result).not.toBe(copyFrags);
        expect(result.content).toBeInstanceOf(Array);
        expect(Object.isFrozen(result.content)).toBe(true);
        expect(result.content).toEqual(copyFrags);

        expect(result.prefix).toEqual(mockFragment("", 0));
        expect(result.suffix).toEqual(mockFragment("", maxOffset));
      });

      it("should create from any other iterable of fragments", () => {
        const { content, maxOffset } = contiguousFrags;

        const genFrags = function*() { yield* content; };
        const genIterator = genFrags();
        const result = TextAssembly.fromFragments(genIterator);

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

        const result = TextAssembly.fromFragments(content, {
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

      it.todo("should assume continuity when told to");
    });

    describe("fromDerived", () => {
      const originAssembly = new TextAssembly(
        offsetFrags.prefix, offsetFrags.content, offsetFrags.suffix,
        true, null
      );

      const childAssembly = new TextAssembly(
        offsetFrags.prefix, offsetFrags.content.slice(0, 3), offsetFrags.suffix,
        true, originAssembly
      );

      describe("when `fragments` is an assembly fast-path", () => {
        // A `TextAssembly` is an `Iterable<TextFragment>`, so that case is
        // handled specially to do the minimum work.

        it("should return text assemblies as-is", () => {
          const result = TextAssembly.fromDerived(childAssembly, originAssembly);

          expect(result).toBe(childAssembly);
        });

        it.failing("should FAIL if given an assembly that is not related to the origin assembly", () => {
          // An internal sanity check.  If we're expecting the given assembly
          // to be related (since it should be derived from the given origin),
          // then it better be!
          
          const foreignAssembly = new TextAssembly(
            offsetFrags.prefix, [], offsetFrags.suffix,
            true, null
          );
          
          const unrelatedAssembly = new TextAssembly(
            offsetFrags.prefix, offsetFrags.content.slice(0, 3), offsetFrags.suffix,
            true, foreignAssembly
          );

          // This just uses referential equality as `TextAssembly` instances
          // are expected to be immutable data structures.
          TextAssembly.fromDerived(unrelatedAssembly, originAssembly);
        });
      });

      it("should remove the prefix/suffix fragment of the origin assembly from content", () => {
        // Specifically for the case you convert another `TextAssembly` into
        // an iterable and do a transform on it without removing the prefix
        // or suffix fragments.  It can identify and remove them.

        const reducedFrags = offsetFrags.content.slice(0, 3);
        const derivedFrags = [originAssembly.prefix, ...reducedFrags, originAssembly.suffix];
        const result = TextAssembly.fromDerived(derivedFrags, originAssembly);

        expect(result.content).toEqual(reducedFrags);
        expect(result.content).not.toBe(derivedFrags);
      });

      it("should set the source of the provided origin", () => {
        const derivedFrags = offsetFrags.content.slice(0, 1);
        const result = TextAssembly.fromDerived(derivedFrags, childAssembly);

        expect(result.source).toBe(originAssembly);
      });

      // Specifically the `origin`, not `origin.source`.
      it("should use the same prefix/suffix as the origin", () => {
        const newPrefix = mockFragment("PRE\n", 0);
        const newSuffix = mockFragment("\nSUF", offsetFrags.maxOffset);

        const childAssembly = new TextAssembly(
          newPrefix, offsetFrags.content.slice(0, 3), newSuffix,
          true, originAssembly
        );

        const derivedFrags = offsetFrags.content.slice(0, 1);
        const result = TextAssembly.fromDerived(derivedFrags, childAssembly);

        expect(result.prefix).toBe(newPrefix);
        expect(result.prefix).not.toBe(originAssembly.prefix);
        expect(result.suffix).toBe(newSuffix);
        expect(result.suffix).not.toBe(originAssembly.suffix);
      });

      it.todo("should assume continuity when told to");
    });

    describe("checkRelated", () => {
      // This just uses referential equality on the `source` property.

      const fooOrigin = {};
      const fooAssembly1 = { source: fooOrigin } as TextAssembly;
      const fooAssembly2 = { source: fooOrigin } as TextAssembly;

      const barOrigin = {};
      const barAssembly = { source: barOrigin } as TextAssembly;

      it("should indicate when two assemblies are related", () => {
        const result = TextAssembly.checkRelated(fooAssembly1, fooAssembly2);

        expect(result).toBe(true);
      });

      it("should indicate when two assemblies are not related", () => {
        const result = TextAssembly.checkRelated(fooAssembly1, barAssembly);

        expect(result).toBe(false);
      });
    });
  });

  describe("properties", () => {
    const sourceAssembly = new TextAssembly(
      offsetFrags.prefix,
      offsetFrags.content,
      offsetFrags.suffix,
      true, null
    );

    const childAssembly = new TextAssembly(
      offsetFrags.prefix,
      offsetFrags.content.slice(0, 3),
      offsetFrags.suffix,
      true, sourceAssembly
    );

    describe("fullText", () => {
      it("should produce the full, concatenated text (no affixing)", () => {
        const { content, maxOffset } = offsetFrags;

        const testAssembly = new TextAssembly(
          mockFragment("", 0),
          content,
          mockFragment("", maxOffset),
          true, null
        );

        expect(testAssembly.fullText).toBe(content.map(toContent).join(""));
      });

      it("should produce the full, concatenated text (with affixing)", () => {
        const { prefix, content, suffix } = offsetFrags;

        const allFrags = [prefix, ...content, suffix];

        expect(sourceAssembly.fullText).toBe(allFrags.map(toContent).join(""));
      });
    });

    describe("isSource", () => {
      it("should be able to determine it is a source", () => {
        expect(sourceAssembly.isSource).toBe(true);
      });

      it("should be able to determine it is not a source", () => {
        expect(childAssembly.isSource).toBe(false);
      });
    });

    describe("source property", () => {
      it("should return `this` if it is a source assembly", () => {
        expect(sourceAssembly.source).toBe(sourceAssembly);
      });

      it("should return the correct source if it is not a source assembly", () => {
        expect(childAssembly.source).toBe(sourceAssembly);
      });
    });
  });

  describe("iterator", () => {
    it.todo("should iterate through all fragments (no affixing)");
    it.todo("should iterate through all fragments (with affixing)");

    it.todo("should skip all empty fragments");
  });

  describe("cursor/selection methods", () => {
    describe("fromFullText", () => {
      describe("sanity checks", () => {
        const testAssembly = new TextAssembly(
          offsetFrags.prefix,
          offsetFrags.content,
          offsetFrags.suffix,
          true, null
        );

        it.failing("should FAIL if cursor is not full-text", () => {
          const offset = insideFrag(mockFragment(testAssembly.fullText, 0));
          const cursor = mockCursor(offset, "assembly", testAssembly);
          
          // @ts-ignore - We're checking this assertion fails at runtime.
          testAssembly.fromFullText(cursor);
        });
  
        it.failing("should FAIL if cursor is not for the assembly", () => {
          const cursor = mockCursor(20, "fullText", { origin: {} });

          testAssembly.fromFullText(cursor);
        });

        it.failing("should FAIL is cursor is out of bounds of `fullText`", () => {
          const offset = afterFrag(mockFragment(testAssembly.fullText, 0));
          const cursor = mockCursor(offset + 3, "fullText", testAssembly);

          testAssembly.fromFullText(cursor);
        });
      });

      // This method has a lot of disambiguation cases that it handles,
      // where the full-text cursor falls between two fragments and
      // rules need to be applied to figure out which is the best fragment
      // to base the assembly cursor on.

      // Many of these cases are redundantly checked by the procedural cases
      // below, so chances are if you have an error here, you will also have
      // a dozens of failures in the other tests.  If you are not making a
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
            it.todo("should favor the first fragment");
          });

          describe("when neither is wordy", () => {
            it.todo("should favor the first fragment");
          });
        });

        describe("when cursor in boundaries of prefix or suffix", () => {
          it.todo("should map to start of the prefix fragment");
          it.todo("should map to inside of the prefix fragment");
          it.todo("should map to inside of the suffix fragment");
          it.todo("should map to end of the suffix fragment");

          // Already covered, but these are explicit checks.
          it.todo("should favor content when ambiguous with prefix");
          it.todo("should favor content when ambiguous with suffix");
        });

        describe("when content is empty", () => {
          // Can only happen only when we have no content fragments.
          describe("when ambiguous between prefix and suffix fragments", () => {
            describe("when prefix is non-empty", () => {
              it.todo("should map to end of prefix fragment");
            });

            describe("when prefix is empty and suffix is non-empty", () => {
              it.todo("should map to start of suffix fragment");
            });
          });

          // These deal with the fail-safe behavior.
          describe("when prefix and suffix are also empty", () => {
            it.todo("should map to end of source's prefix if possible");
            it.todo("should map to offset 0 as a fail-safe");
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
          testAssembly: TextAssembly,
          theSpecs: readonly SpecParams[]
        }

        const specRunner = (testAssembly: TextAssembly) => (specParams: SpecParams) => {
          const cursorOffset = specParams.cursorOffset as number;
          const expectedOffset = specParams.expectedOffset as number;

          const cursor = mockCursor(cursorOffset, "fullText", testAssembly);
          const result = testAssembly.fromFullText(cursor);

          expect(result).toEqual(mockCursor(expectedOffset, "assembly", testAssembly));
        };

        const describeRunner = (describeParams: DescribeParams) => {
          const { testAssembly, theSpecs } = describeParams;
          it.each(theSpecs)("$name", specRunner(testAssembly));
        };

        // We want to test a wide variety of odd assembly scenarios.
        // The assembly will have 5 fragments, 3 sentence fragments
        // separated by whitespace fragments.
        const baseAssemblyMods = {
          affixing: new Map([
            ["un-affixed", [false, false] as const],
            ["affixed", [true, true] as const]
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
          produceForSpecs: (testAssembly: TextAssembly) => Iterable<SpecParams>,
          assemblyMods = baseAssemblyMods
        ): Iterable<DescribeParams> {
          for (const [affixStr, affixArgs] of assemblyMods.affixing) {
            for (const [offStr, offsetArg] of assemblyMods.offsets) {
              const assemblyData = generateAssembly(offsetArg, ...affixArgs);

              for (const [contStr, contFn] of assemblyMods.continuity) {
                for (const [orderStr, orderFn] of assemblyMods.ordering) {
                  const initContent = assemblyData.content;
                  const withContinuity = contFn(initContent);
                  const withOrdering = orderFn(withContinuity);

                  const testAssembly = new TextAssembly(
                    assemblyData.prefix,
                    withOrdering,
                    assemblyData.suffix,
                    withOrdering === initContent,
                    null
                  );

                  // If a name part is empty, we'll omit it.
                  const nameParts = [affixStr, offStr, contStr, orderStr].filter(Boolean).join(", ");

                  yield {
                    name: `when ${nameParts}`,
                    testAssembly,
                    theSpecs: [...produceForSpecs(testAssembly)]
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

            function* forContent(testAssembly: TextAssembly) {
              for (const [idxStr, fragIndex] of cursorMods.indices) {
                for (const [posStr, posFn] of cursorMods.positions) {
                  const { prefix, content, suffix } = testAssembly;

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
            type PositionModifier = (assembly: TextAssembly) => number;

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

            function* forPrefix(testAssembly: TextAssembly) {
              for (const [posStr, posMod] of cursorMods.positions) {
                const { prefix } = testAssembly;
                const [originFn, expectedFn] = Array.isArray(posMod) ? posMod : [posMod, posMod];

                const expectedOffset = expectedFn(testAssembly);
                const cursorOffset = originFn(testAssembly) - prefix.offset;

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
              affixing: new Map([["", [true, true] as const]])
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
            type PositionModifier = (assembly: TextAssembly) => number;

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

            function* forSuffix(testAssembly: TextAssembly) {
              for (const [posStr, posMod] of cursorMods.positions) {
                const { prefix, suffix, content } = testAssembly;
                const [originFn, expectedFn] = Array.isArray(posMod) ? posMod : [posMod, posMod];

                const suffixRelative = originFn(testAssembly) - suffix.offset;
                const expectedOffset = expectedFn(testAssembly);
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
              affixing: new Map([["", [true, true] as const]])
            })];
          });

          describe.each(theDescribes)("$name", describeRunner);
        });
      });
    });

    describe("isFoundIn", () => {
      it.todo("should FAIL if cursor is for full-text");
      it.todo("should FAIL if cursor is for unrelated assembly");

      it.todo("should identify cursor in prefix");
      it.todo("should identify cursor in suffix");
      it.todo("should identify cursor in any content");
      it.todo("should not identify a cursor in missing content");
    });

    describe("findBest", () => {
      // This always repositions to the nearest existing fragment
      // in the `content` array, regardless of any pattern in its
      // ordering.  The assembly won't search for patterns in the
      // ordering of `content` and so won't consider where missing
      // content would be located if they were present.

      const runCommonTests = (
        testAssembly: TextAssembly,
        minContent: TextFragment,
        maxContent: TextFragment
      ) => {
        it("should return the same cursor instance when found", () => {
          const offset = insideFrag(minContent);
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toBe(cursor);
        });

        it("should be able to position to prefix if closest", () => {
          const afterPrefix = afterFrag(testAssembly.prefix);

          const offset = afterPrefix + 1;
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toEqual(mockCursor(afterPrefix, "assembly", testAssembly));
        });

        it("should be able to position to suffix if closest", () => {
          const beforeSuffix = beforeFrag(testAssembly.suffix);

          const offset = beforeSuffix - 1;
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toEqual(mockCursor(beforeSuffix, "assembly", testAssembly));
        });

        it("should reposition to nearest content when possible (near prefix)", () => {
          const expectedOffset = beforeFrag(minContent);

          const offset = afterFrag(testAssembly.prefix) + 2;
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toEqual(mockCursor(expectedOffset, "assembly", testAssembly));
        });

        it("should reposition to nearest content when possible (near suffix)", () => {
          const expectedOffset = afterFrag(maxContent);

          const offset = beforeFrag(testAssembly.suffix) - 2;
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toEqual(mockCursor(expectedOffset, "assembly", testAssembly));
        });
      };

      describe("when fully contiguous", () => {
        const testAssembly = new TextAssembly(
          offsetFrags.prefix,
          offsetFrags.content,
          offsetFrags.suffix,
          true, null
        );

        runCommonTests(
          testAssembly,
          offsetFrags.content[0],
          offsetFrags.content[4]
        );
      });

      describe("when in order but with gap", () => {
        const testAssembly = new TextAssembly(
          offsetFrags.prefix,
          [
            offsetFrags.content[0],
            offsetFrags.content[1],
            offsetFrags.content[4]
          ],
          offsetFrags.suffix,
          // This is non-contiguous.
          false, null
        );

        runCommonTests(
          testAssembly,
          offsetFrags.content[0],
          offsetFrags.content[4]
        );

        it("should reposition to nearest content when possible (in content gap)", () => {
          const expectedOffset = afterFrag(offsetFrags.content[1]);

          const offset = insideFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toEqual(mockCursor(expectedOffset, "assembly", testAssembly));
        });
      });

      describe("when out of order and with gap", () => {
        const testAssembly = new TextAssembly(
          offsetFrags.prefix,
          [
            offsetFrags.content[4],
            offsetFrags.content[3],
            offsetFrags.content[0]
          ],
          offsetFrags.suffix,
          // This is non-contiguous.
          false, null
        );

        runCommonTests(
          testAssembly,
          offsetFrags.content[0],
          offsetFrags.content[4]
        );

        it("should reposition to nearest content when possible (in content gap)", () => {
          const expectedOffset = beforeFrag(offsetFrags.content[3]);

          const offset = insideFrag(offsetFrags.content[2]);
          const cursor = mockCursor(offset, "assembly", testAssembly);
          const result = testAssembly.findBest(cursor);

          expect(result).toEqual(mockCursor(expectedOffset, "assembly", testAssembly));
        });
      });
    });

    describe("positionOf", () => {
      const testAssembly = new TextAssembly(
        contiguousFrags.prefix,
        contiguousFrags.content,
        contiguousFrags.suffix,
        true, null
      );

      it.failing("should FAIL if cursor is for full-text", () => {
        // @ts-ignore - This is intentional for the test.
        testAssembly.positionOf(mockCursor(10, "fullText", testAssembly));
      });

      it("should identify unrelated cursors", () => {
        // Relations are determined through referential equality.
        const cursor = mockCursor(10, "assembly", { source: {} });
        const result = testAssembly.positionOf(cursor);

        expect(result).toBe("unrelated");
      });

      it("should identify cursors inside prefix", () => {
        const offset = insideFrag(testAssembly.prefix);
        const cursor = mockCursor(offset, "assembly", testAssembly);
        const result = testAssembly.positionOf(cursor);

        expect(result).toBe("prefix");
      });

      it("should identify cursors inside suffix", () => {
        const offset = insideFrag(testAssembly.suffix);
        const cursor = mockCursor(offset, "assembly", testAssembly);
        const result = testAssembly.positionOf(cursor);

        expect(result).toBe("suffix");
      });

      it("should identify cursors inside any content", () => {
        const firstOffset = insideFrag(first(testAssembly.content));
        const firstCursor = mockCursor(firstOffset, "assembly", testAssembly);
        const firstResult = testAssembly.positionOf(firstCursor);

        expect(firstResult).toBe("content");

        const lastOffset = insideFrag(last(testAssembly.content));
        const lastCursor = mockCursor(lastOffset, "assembly", testAssembly);
        const lastResult = testAssembly.positionOf(lastCursor);

        expect(lastResult).toBe("content");
      });

      it("should favor content when ambiguous with prefix", () => {
        const offset = afterFrag(testAssembly.prefix);
        const cursor = mockCursor(offset, "assembly", testAssembly);
        const result = testAssembly.positionOf(cursor);

        expect(result).toBe("content");
      });

      it("should favor content when ambiguous with suffix", () => {
        const offset = beforeFrag(testAssembly.suffix);
        const cursor = mockCursor(offset, "assembly", testAssembly);
        const result = testAssembly.positionOf(cursor);

        expect(result).toBe("content");
      });

      it("should favor prefix when content is empty and ambiguous with suffix", () => {
        const prefixFrag = mockFragment("PREFIX\n", 0);
        const suffixFrag = mockFragment("\nSUFFIX", prefixFrag.content.length);
        const testAssembly = new TextAssembly(
          prefixFrag, [], suffixFrag,
          true, null
        );

        // Just to assert that the ambiguity is present for the test.
        const offset = afterFrag(prefixFrag);
        expect(offset).toBe(suffixFrag.offset);

        const cursor = mockCursor(offset, "assembly", testAssembly);
        const result = testAssembly.positionOf(cursor);

        expect(result).toBe("prefix");
      });
    });
  });

  describe("query methods", () => {
    describe("fragmentsFrom", () => {

    });

    describe("locateInsertion", () => {

    });

    describe("isRelatedTo", () => {

    });
  });

  describe("manipulation methods", () => {
    describe("splitAt", () => {

    });

    describe("asOnlyContent", () => {

    });
  });
});