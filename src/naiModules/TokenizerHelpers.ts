import { ModuleDef } from "../require";

export type TokenizerTypes = Virtual.TokenizerTypes;

export namespace Virtual {
  export declare enum TokenizerTypes { GPT2, PileNAI, Genji }
  export declare function getTokenizerType(key: string): TokenizerTypes;
}

export interface ITokenizerHelpers {
  "ID": typeof Virtual.getTokenizerType;
}

class TokenizerHelpers extends ModuleDef<ITokenizerHelpers> {
  moduleId = 99194;
  expectedExports = 3;
  mapping = {
    "ID": ["getTokenizerType", "function"]
  } as const;
};

export default new TokenizerHelpers();