import { jest, describe, it, expect } from "@jest/globals";
import { beforeEach } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { mockCodec as rawCodec } from "@spec/helpers-tokenizer";

import $TokenizerService from "../../TokenizerService";
import getTokensForSplit from "./getTokensForSplit";

const makeSpiedCodec = () => {
  const { codecFor } = $TokenizerService(fakeRequire);
  const mockCodec = codecFor(0, rawCodec);
  const spyFindOffset = jest.spyOn(mockCodec, "findOffset");
  const spyMendTokens = jest.spyOn(mockCodec, "mendTokens");
  return { spyFindOffset, spyMendTokens, mockCodec };
};

let spiedCodec: ReturnType<typeof makeSpiedCodec>;
beforeEach(() => {
  spiedCodec = makeSpiedCodec();
});

describe("getTokensForSplit", () => {
  // The mock codec needs to be able to encode splits on this text.
  // We'll just use a number sequence since splitting `"foo"` into
  // `"f"` and `"oo"` cannot be re-encoded.
  const testText = "112233112233";
  const testTokens = [211, 212, 213, 211, 212, 213];

  describe("basic functionality", () => {
    it("should return empty tokens given empty tokens and zero offset", async () => {
      const { spyFindOffset, spyMendTokens, mockCodec } = spiedCodec;
      const result = await getTokensForSplit(mockCodec, 0, []);

      expect(result).toEqual([[], []]);
      expect(spyFindOffset).not.toBeCalled();
      expect(spyMendTokens).not.toBeCalled();
    });

    it("should return empty tokens then given tokens on before result", async () => {
      const { spyFindOffset, spyMendTokens, mockCodec } = spiedCodec;
      spyFindOffset.mockResolvedValue({ type: "before" });

      const result = await getTokensForSplit(mockCodec, 0, testTokens);
      expect(result).toEqual([[], testTokens]);

      expect(spyMendTokens).not.toBeCalled();
    });

    it("should return given tokens then empty tokens on after result", async () => {
      const { spyFindOffset, spyMendTokens, mockCodec } = spiedCodec;
      spyFindOffset.mockResolvedValue({ type: "after" });
  
      const result = await getTokensForSplit(mockCodec, 12, testTokens);
      expect(result).toEqual([testTokens, []]);

      expect(spyMendTokens).not.toBeCalled();
    });

    it("should call `mendTokens` with a single-token result", async () => {
      const { spyFindOffset, spyMendTokens, mockCodec } = spiedCodec;
      spyFindOffset.mockResolvedValue({
        type: "single",
        data: {
          index: 2,
          token: 213,
          value: "33"
        },
        remainder: 1
      });

      const result = await getTokensForSplit(mockCodec, 5, testTokens);
      expect(result).toEqual([[211, 212, 203], [203, 211, 212, 213]]);

      expect(spyMendTokens).toHaveBeenCalledTimes(2);
      expect(spyMendTokens).toHaveBeenCalledWith(
        [[211, 212], "3"],
        expect.any(Number)
      );
      expect(spyMendTokens).toHaveBeenCalledWith(
        ["3", [211, 212, 213]],
        expect.any(Number)
      );
    });

    it("should do a simple split with a double-token result", async () => {
      const { spyFindOffset, spyMendTokens, mockCodec } = spiedCodec;
      spyFindOffset.mockResolvedValue({
        type: "double",
        min: {
          index: 2,
          token: 213,
          value: "33"
        },
        max: {
          index: 3,
          token: 211,
          value: "11"
        },
        remainder: 0
      });

      const result = await getTokensForSplit(mockCodec, 6, testTokens);
      expect(result).toEqual([[211, 212, 213], [211, 212, 213]]);

      expect(spyMendTokens).not.toBeCalled();
    });
  });

  describe("other checks", () => {
    it("should call `findOffset` with full arguments", async () => {
      const { spyFindOffset, mockCodec } = spiedCodec;
      await getTokensForSplit(mockCodec, 6, testTokens, testText);
  
      expect(spyFindOffset).toHaveBeenCalledWith(testTokens, 6, testText);
    });

    it("should call `findOffset` without optional `decodedText`", async () => {
      const { spyFindOffset, mockCodec } = spiedCodec;
      await getTokensForSplit(mockCodec, 6, testTokens);
  
      expect(spyFindOffset).toHaveBeenCalledWith(testTokens, 6, undefined);
    });

    it.failing("should FAIL given empty tokens and non-zero offset", async () => {
      await getTokensForSplit(spiedCodec.mockCodec, 6, []);
    });
  });
});