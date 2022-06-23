import { describe, it, expect } from "@jest/globals";

import { mockCodec } from "./helpers-tokenizer";

describe("sanity checks for helpers-tokenizer", () => {
  describe("mockCodec.encode", () => {
    it("should do basic encoding", async () => {
      const sample = "[foo]";
      expect(await mockCodec.encode(sample)).toEqual([101, 301, 102]);
    });

    it("should favor the longest word, when multiple options exist", async () => {
      const sample = "foo foobar bar";
      expect(await mockCodec.encode(sample)).toEqual([301, 322, 312]);
    });

    it.failing("should throw if no token can be found", async () => {
      await mockCodec.encode("foo oops bar");
    });
  });

  describe("mockCodec.decode", () => {
    it("should decode a sequence of tokens", async () => {
      const sample = [111, 301, 1, 1, 302, 1, 102];
      expect(await mockCodec.decode(sample)).toBe("[ foo  bar ]");
    });

    it.failing("should throw if any token is unrecognized", async () => {
      await mockCodec.decode([1, 999, 302]);
    });
  });
});