import { ModuleDef } from "../require";
import type { ContextConfig } from "./Lorebook";

export interface TrimTypes {
  DoNotTrim: "doNotTrim";
  TrimBottom: "trimBottom";
  TrimTop: "trimTop";
}

/** A generic interface for anything that can be provide content to the context. */
export interface IContextField {
  text: string;
  contextConfig: ContextConfig;
}

export namespace Virtual {
  export declare class ContextField implements IContextField {
    constructor(contextConfig: ContextConfig, text?: string);
    static serializeInfo: unknown;
    static deserialize: Function;
  
    text: string;
    contextConfig: ContextConfig;
  }
}

export type ContextField = Virtual.ContextField;

export interface IContextModule {
  "SI": typeof Virtual.ContextField;
  "vU": TrimTypes
};

class ContextModule extends ModuleDef<IContextModule> {
  moduleId = 58805;
  expectedExports = 9;
  mapping = {
    "SI": ["ContextField", "function"],
    "vU": ["TRIM_TYPES", "object"]
  } as const;
};

export default new ContextModule();