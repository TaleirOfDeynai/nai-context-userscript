import { ModuleDef } from "../require";
import type { TokenizerTypes } from "./TokenizerHelpers";

/** An object that converts between a string and an array of tokens. */
export interface TokenCodec {
  encode(text: string): Promise<number[]>;
  decode(tokens: number[]): Promise<string>;
}

export namespace Virtual {
  interface EncodePayload {
    task: "encode";
    data: string;
    encoderType: TokenizerTypes;
  }

  interface DecodePayload {
    task: "decode";
    data: number[];
    encoderType: TokenizerTypes;
  }

  /**
   * This class appears to be instantiated whenever {@link GlobalEncoder.encode}
   * or {@link GlobalEncoder.decode} are called.  It uses an internal background
   * worker to keep the UI from freezing during execution.
   * 
   * That seems...  wasteful?  But maybe there's something about how the worker
   * is designed that makes it not able to be reused.  I dunno why you'd design
   * it with internal state that requires resetting it every time you use it,
   * though.  I'd have at least kept one of these around through a single
   * context building task, though.
   */
  export declare class GlobalEncoder {
    encode(text: string, encoderType: TokenizerTypes): Promise<number[]>;
    decode(tokens: number[], encoderType: TokenizerTypes): Promise<string>;
    postMessage(payload: EncodePayload): Promise<number[]>;
    postMessage(payload: DecodePayload): Promise<string>;
  }
}

export interface ITokenizerCodec {
  "PT": typeof Virtual.GlobalEncoder;
}

class TokenizerCodec extends ModuleDef<ITokenizerCodec> {
  moduleId = 10195;
  expectedExports = 3;
  mapping = {
    "PT": ["GlobalEncoder", "function"]
  } as const;
};

export default new TokenizerCodec();