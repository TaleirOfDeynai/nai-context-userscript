import { usModule } from "../utils/usModule";
import { isFunction, isObject } from "../utils/is";
import TokenizerCodec from "../naiModules/TokenizerCodec";
import type { TokenCodec as AsyncTokenCodec } from "../naiModules/TokenizerCodec";
import type { TokenizerTypes } from "../naiModules/TokenizerHelpers";

export interface SyncTokenCodec {
  encode(text: string): number[];
  decode(tokens: number[]): string;
}

export type TokenCodec = AsyncTokenCodec | SyncTokenCodec;

export default usModule((require, exports) => {
  const tokenizerCodec = require(TokenizerCodec);

  const isCodec = (value: any): value is TokenCodec => {
    if (!isObject(value)) return false;
    if (!("encode" in value)) return false;
    if (!("decode" in value)) return false;
    if (!isFunction(value.encode)) return false;
    if (!isFunction(value.decode)) return false;
    return true;
  }

  function codecFor(tokenizerType: TokenizerTypes, givenCodec?: TokenCodec): AsyncTokenCodec {
    if (isCodec(givenCodec)) return {
      encode: (text) => Promise.resolve(givenCodec.encode(text)),
      decode: (tokens) => Promise.resolve(givenCodec.decode(tokens))
    };

    return {
      encode: (text) => tokenizerCodec.GlobalEncoder.encode(text, tokenizerType),
      decode: (tokens) => tokenizerCodec.GlobalEncoder.decode(tokens, tokenizerType)
    };
  }

  return Object.assign(exports, {
    isCodec,
    codecFor
  });
});