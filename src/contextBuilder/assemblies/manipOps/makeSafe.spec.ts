import { describe, it, expect } from "@jest/globals";
import { mockFragment, getEmptyFrag } from "@spec/helpers-splitter";
import { generateData, NO_AFFIX } from "@spec/helpers-assembly";
import { offsetFrags } from "@spec/helpers-assembly";

import { isArray, isPojo } from "@utils/is";
import { iterReverse } from "@utils/iterables";
import makeSafe from "./makeSafe";

import type { IFragmentAssembly } from "../Fragment";

describe("makeSafe", () => {
  describe("assertions", () => {
    it.failing("should FAIL if the prefix's offset is not 0", () => {
      const testData = {
        ...offsetFrags,
        prefix: mockFragment("PREFIX\n", 3)
      };
  
      makeSafe(testData);
    });
  
    it.failing("should FAIL if `content` contains an empty fragment", () => {
      const testData = {
        ...offsetFrags,
        content: offsetFrags.content.map((f, i) => i !== 2 ? f : getEmptyFrag(f))
      };
  
      makeSafe(testData);
    });
  });

  describe("when assembly is a plain object", () => {
    it("should return the same instance if is passes all checks", () => {
      // Pre-flight sanity checks for this test.
      expect(isPojo(offsetFrags)).toBe(true);
      expect(Object.isFrozen(offsetFrags)).toBe(true);
      expect(Object.isFrozen(offsetFrags.content)).toBe(true);
  
      // The actual test.
      expect(makeSafe(offsetFrags)).toBe(offsetFrags);
    });

    it("should return a new object if the assembly is not frozen", () => {
      const testData = { ...offsetFrags };
      expect(makeSafe(testData)).not.toBe(testData);
    });

    it("should return a new object if `content` is not a readonly array", () => {
      const testData = Object.freeze({
        ...offsetFrags,
        content: [...offsetFrags.content]
      });
      const result = makeSafe(testData);

      expect(result).not.toBe(testData);
      expect(isPojo(result)).toBe(true);
      expect(isArray(result.content)).toBe(true);
      expect(Object.isFrozen(result.content)).toBe(true);
      expect(result).toEqual({
        prefix: testData.prefix,
        content: testData.content,
        suffix: testData.suffix,
        source: undefined
      });
    });
  });

  describe("when assembly is a class", () => {
    class TestAssembly {
      constructor(wrapped: IFragmentAssembly) {
        this.#wrapped = wrapped;
      }

      readonly #wrapped: IFragmentAssembly;
      get prefix() { return this.#wrapped.prefix; }
      get content() { return this.#wrapped.content; }
      get suffix() { return this.#wrapped.suffix; }
      // Being tricksie: returns itself when undefined.
      get source() { return this.#wrapped.source ?? this; }
    }

    it("should return a new object", () => {
      const testAssembly = new TestAssembly(offsetFrags);
      const result = makeSafe(testAssembly);

      expect(result).not.toBe(testAssembly);
      expect(isPojo(result)).toBe(true);
      expect(result).toEqual({
        prefix: offsetFrags.prefix,
        content: offsetFrags.content,
        suffix: offsetFrags.suffix
      });
    });

    it("should reuse the `content` if it is a readonly array", () => {
      // Pre-flight sanity check for this test.
      expect(Object.isFrozen(offsetFrags.content)).toBe(true);

      const testAssembly = new TestAssembly(offsetFrags);
      const result = makeSafe(testAssembly);

      expect(result.content).toBe(testAssembly.content);
    });

    it("should create a readonly copy of `content` if it is not a readonly array", () => {
      const testData = {
        ...offsetFrags,
        content: [...offsetFrags.content]
      };
      const testAssembly = new TestAssembly(testData);
      const result = makeSafe(testAssembly);

      expect(result.content).not.toBe(testAssembly.content);
      expect(isArray(result.content)).toBe(true);
      expect(Object.isFrozen(result.content)).toBe(true);
    });

    it("should have no `source` property if the input assembly was a source", () => {
      const testAssembly = new TestAssembly(offsetFrags);
      const result = makeSafe(testAssembly);

      expect("source" in result).toBe(false);
    });

    it("should preserve the source if the input assembly was not a source", () => {
      const parentData = offsetFrags;
      const childData = {
        ...parentData,
        content: parentData.content.slice(2),
        source: parentData
      };
      const testAssembly = new TestAssembly(childData);
      const result = makeSafe(testAssembly);

      expect(result.source).toBe(parentData);
    });
  });
});