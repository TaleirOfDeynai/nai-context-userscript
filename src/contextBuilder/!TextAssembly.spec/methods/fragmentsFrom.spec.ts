import { describe, it, expect } from "@jest/globals";
import { mockFragment, toFragmentSeq, toContent } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { afterFrag, insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { generateData, initAssembly, NO_AFFIX } from "../_common";
import { contiguousFrags } from "../_common";

import { first } from "@utils/iterables";

describe("TextAssembly", () => {
  describe("query methods", () => {
    describe("fragmentsFrom", () => {
      const assemblyData = generateData(0, {
        // We're going to use the same old text, just merged as a single
        // fragment.
        content: [[
          "This is the first fragment.",
          "\n",
          "This is the second fragment.",
          "  ",
          "This is the third fragment."
        ].join("")]
      });
      const mergedAssembly = initAssembly(assemblyData);

      describe("basic functionality", () => {
        // For these first tests, I'm only going to check the content.
        // The offsets are more or less already handled by the tests
        // for the trimming providers.

        it("should split into fragments of the desired granularity (newline)", () => {
          const cursor = mockCursor(0, "assembly", mergedAssembly);
          const result = [...mergedAssembly.fragmentsFrom(cursor, "newline", "toBottom")];

          expect(result.map(toContent)).toEqual([
            "PREFIX", "\n",
            "This is the first fragment.",
            "\n",
            "This is the second fragment.  This is the third fragment.",
            "\n", "SUFFIX"
          ]);
        });

        it("should split into fragments of the desired granularity (sentence)", () => {
          const cursor = mockCursor(0, "assembly", mergedAssembly);
          const result = [...mergedAssembly.fragmentsFrom(cursor, "sentence", "toBottom")];

          expect(result.map(toContent)).toEqual([
            "PREFIX", "\n",
            "This is the first fragment.",
            "\n",
            "This is the second fragment.",
            "  ",
            "This is the third fragment.",
            "\n", "SUFFIX"
          ]);
        });

        it("should split into fragments of the desired granularity (token)", () => {
          const cursor = mockCursor(0, "assembly", mergedAssembly);
          const result = [...mergedAssembly.fragmentsFrom(cursor, "token", "toBottom")];

          // Only checking through into the second sentence here.
          const expected = [
            "PREFIX", "\n",
            "This", " ", "is", " ", "the", " ", "first", " ", "fragment", ".",
            "\n",
            "This", " ", "is", " ", "the", " ", "second", " ", "fragment", "."
          ];

          expect(result.map(toContent).slice(0, expected.length)).toEqual(expected);
        });

        // The above tests all checked the "from top to bottom" case.

        it("should iterate from bottom to top (IE: in reverse)", () => {
          const offset = afterFrag(mergedAssembly.suffix);
          const cursor = mockCursor(offset, "assembly", mergedAssembly);
          const result = [...mergedAssembly.fragmentsFrom(cursor, "sentence", "toTop")];

          // Lazily copy and pasted the above and added the `reverse` call.
          expect(result.map(toContent)).toEqual([
            "PREFIX", "\n",
            "This is the first fragment.",
            "\n",
            "This is the second fragment.",
            "  ",
            "This is the third fragment.",
            "\n", "SUFFIX"
          ].reverse());
        });
      });

      describe("when cursor is inside a fragment", () => {
        const expectedSplit = toFragmentSeq([
          "PREFIX", "\n",
          "This is the first fragment.", "\n",
          "This is the second fragment.", "  ",
          "This is the third fragment.", "\n",
          "SUFFIX"
        ], 0);

        // We're going to be starting at the "second fragment".
        const startOffset = insideFrag(expectedSplit[4]);

        it("should start at the fragment containing the cursor (to bottom)", () => {
          const cursor = mockCursor(startOffset, "assembly", mergedAssembly);
          const result = [...mergedAssembly.fragmentsFrom(cursor, "sentence", "toBottom")];

          expect(result).toEqual(expectedSplit.slice(4));
        });

        it("should start at the fragment containing the cursor (to top)", () => {
          const cursor = mockCursor(startOffset, "assembly", mergedAssembly);
          const result = [...mergedAssembly.fragmentsFrom(cursor, "sentence", "toTop")];

          expect(result).toEqual(expectedSplit.slice(0, 5).reverse());
        });
      });

      describe("when cursor at fragment boundary", () => {
        // We can use one of the standard assemblies for this one.
        // It's even already broken into sentence fragments.  How convenient!
        const splitAssembly = initAssembly(contiguousFrags);

        // The best case would be that the same fragment instances are reused,
        // but that's not straight-forward to make happen.  Still, the
        // fragments should be identical, by their contents.

        it("should start at earliest fragment (to bottom)", () => {
          const offset = afterFrag(splitAssembly.content[2]);
          const cursor = mockCursor(offset, "assembly", splitAssembly);
          const result = [...splitAssembly.fragmentsFrom(cursor, "sentence", "toBottom")];

          expect(first(result)).toEqual(splitAssembly.content[2]);
        });

        it("should start at latest fragment (to top)", () => {
          const offset = beforeFrag(splitAssembly.content[2]);
          const cursor = mockCursor(offset, "assembly", splitAssembly);
          const result = [...splitAssembly.fragmentsFrom(cursor, "sentence", "toTop")];

          // Still `first`, because this iterates in reverse.
          expect(first(result)).toEqual(splitAssembly.content[2]);
        });
      });

      describe("when using a selection", () => {
        const expectedSplit = toFragmentSeq([
          "PREFIX", "\n",
          "This is the first fragment.", "\n",
          "This is the second fragment.", "  ",
          "This is the third fragment.", "\n",
          "SUFFIX"
        ], 0);

        const selection = [
          mockCursor(insideFrag(expectedSplit[4]), "assembly", mergedAssembly),
          mockCursor(insideFrag(expectedSplit[6]), "assembly", mergedAssembly),
        ] as const;

        it("should use the second cursor when iterating to bottom", () => {
          const result = mergedAssembly.fragmentsFrom(selection, "sentence", "toBottom");
          expect(first(result)).toEqual(expectedSplit[6]);
        });

        it("should use the first cursor when iterating to top", () => {
          const result = mergedAssembly.fragmentsFrom(selection, "sentence", "toTop");
          expect(first(result)).toEqual(expectedSplit[4]);
        });
      });

      // This is a limitation of this function to be aware of.  I don't
      // believe this capability will be needed, as we're not going to be
      // splitting fragments all that haphazardly.  And if we do, it
      // might be that we should have a method to defragment an assembly
      // and yield a new assembly, rather than complicate this method
      // with implicit defragmenting.
      it.failing("should FAIL to defragment when it could be done", () => {
        const assemblyData = generateData(0, {
          ...NO_AFFIX,
          content: [
            "This is the start ",
            "of something beautiful!"
          ]
        });

        const testAssembly = initAssembly(assemblyData);
        const cursor = mockCursor(0, "assembly", testAssembly);
        const result = [...testAssembly.fragmentsFrom(cursor, "sentence", "toBottom")];

        expect(result).toEqual([
          mockFragment("This is the start of something beautiful!", 0)
        ]);
      });
    });
  });
});