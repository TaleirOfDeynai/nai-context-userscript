import { ModuleDef } from "../require";
import type { ContextConfig } from "./Lorebook";

export interface TrimTypes {
  DoNotTrim: "doNotTrim";
  TrimBottom: "trimBottom";
  TrimTop: "trimTop";
}

export namespace Virtual {
  export declare class ContextContent {
    constructor(contextConfig: ContextConfig, text?: string);
    static serializeInfo: unknown;
    static deserialize: Function;
  
    text: string;
    contextConfig: ContextConfig;
  }
}

export interface IContextModule {
  "SI": typeof Virtual.ContextContent;
  "vU": TrimTypes
};

class ContextModule extends ModuleDef<IContextModule> {
  moduleId = 84409;
  expectedExports = 9;
  mapping = {
    "SI": ["ContextContent", "function"],
    "vU": ["TRIM_TYPES", "object"]
  } as const;
};

export default new ContextModule();