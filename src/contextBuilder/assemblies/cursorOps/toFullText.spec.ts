import { describe, it, expect } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockFragment, toContent } from "@spec/helpers-splitter";
import { mockCursor } from "@spec/helpers-assembly";
import { insideFrag, beforeFrag } from "@spec/helpers-assembly";
import { offsetFrags } from "@spec/helpers-assembly";

import { dew } from "@utils/dew";
import $ToFullText from "./toFullText";

const { toFullText } = $ToFullText(fakeRequire);

describe("toFullText", () => {
  const testData = offsetFrags;

  describe("sanity checks", () => {
    it.failing("should FAIL if cursor is not assembly", () => {
      const offset = insideFrag(mockFragment(testData.getText(), 0));
      const cursor = testData.inText(offset);

      toFullText(testData, cursor as any);
    });

    it.failing("should FAIL if cursor is not related to the assembly", () => {
      const offset = insideFrag(testData.content[2]);
      const cursor = mockCursor(offset, "fragment", { origin: {} });

      toFullText(testData, cursor);
    });

    it.failing("should FAIL is cursor targets a non-existent fragment", () => {
      const withGapData = {
        ...testData,
        // Removing index 2.
        content: [
          ...testData.content.slice(0, 2),
          ...testData.content.slice(3)
        ]
      };

      const offset = insideFrag(testData.content[2]);
      const cursor = withGapData.inFrag(offset);

      toFullText(withGapData, cursor);
    });
  });

  describe("basic functionality", () => {
    it("should work for the prefix", () => {
      const offset = insideFrag(testData.prefix);
      const cursor = testData.inFrag(offset);
      const result = toFullText(testData, cursor);

      expect(result).toEqual(
        testData.inText(offset - beforeFrag(testData.prefix))
      );
    });

    it("should work for any content", () => {
      const offset = insideFrag(testData.content[2]);

      const expectedOffset = dew(() => {
        const upToFrag = [testData.prefix, ...testData.content.slice(0, 2)];
        const totalLength = upToFrag.map(toContent).reduce((p, c) => p + c.length, 0);
        const innerOffset = offset - beforeFrag(testData.content[2]);
        return totalLength + innerOffset;
      });
      
      const cursor = testData.inFrag(offset);
      const result = toFullText(testData, cursor);

      expect(result).toEqual(
        testData.inText(expectedOffset)
      );
    });

    it("should work for the suffix", () => {
      const offset = insideFrag(testData.suffix);

      const expectedOffset = dew(() => {
        const upToFrag = [testData.prefix, ...testData.content];
        const totalLength = upToFrag.map(toContent).reduce((p, c) => p + c.length, 0);
        const innerOffset = offset - beforeFrag(testData.suffix);
        return totalLength + innerOffset;
      });

      const cursor = testData.inFrag(offset);
      const result = toFullText(testData, cursor);

      expect(result).toEqual(
        testData.inText(expectedOffset)
      );
    });
  });
});