import { ModuleDef } from "../require";

export namespace Virtual {
  export declare enum TokenizerTypes { GPT2, PileNAI, Genji }
  export declare function getTokenizerType(key: string): TokenizerTypes;
}

export interface ITokenizerModule {
  "ID": typeof Virtual.getTokenizerType;
}

class TokenizerModule extends ModuleDef<ITokenizerModule> {
  moduleId = 68908;
  expectedExports = 3;
  mapping = {
    ID: ["getTokenizerType", "function"]
  } as const;
};

export default new TokenizerModule();