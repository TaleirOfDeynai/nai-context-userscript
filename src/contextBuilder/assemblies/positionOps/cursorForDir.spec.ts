import { describe, it, expect } from "@jest/globals";
import { beforeFrag, insideFrag, afterFrag } from "@spec/helpers-assembly";
import { contiguousFrags } from "@spec/helpers-assembly";

import cursorForDir from "./cursorForDir";

describe("cursorForDir", () => {
  const testData = contiguousFrags;

  describe("with cursor", () => {
    it("should return the cursor regardless of direction", () => {
      const cursor = testData.inFrag(insideFrag(testData.content[2]));

      expect(cursorForDir(cursor, "toBottom")).toBe(cursor);
      expect(cursorForDir(cursor, "toTop")).toBe(cursor);
    });
  });

  describe("with selection", () => {
    const selection = [
      testData.inFrag(afterFrag(testData.content[1])),
      testData.inFrag(beforeFrag(testData.content[3]))
    ] as const;
  
    it("should use the second cursor when iterating to bottom", () => {
      const result = cursorForDir(selection, "toBottom");
      expect(result).toBe(selection[1]);
    });
  
    it("should use the first cursor when iterating to top", () => {
      const result = cursorForDir(selection, "toTop");
      expect(result).toBe(selection[0]);
    });
  });
});