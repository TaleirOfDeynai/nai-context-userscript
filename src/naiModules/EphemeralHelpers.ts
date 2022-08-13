import { ModuleDef } from "../require";
import type { ContextConfig } from "./Lorebook";

export interface EphemeralEntry {
  contextConfig: ContextConfig;
  delay: number;
  duration: number;
  repeat: boolean;
  reverse: boolean;
  startingStep: number;
  text: string;
}

export namespace Virtual {
  export declare function checkActivation(
    ephemeralEntry: EphemeralEntry,
    step: number
  ): boolean;
}

export interface IEphemeralHelpers {
  "In": typeof Virtual.checkActivation;
}

class EphemeralHelpers extends ModuleDef<IEphemeralHelpers> {
  moduleId = 67325;
  expectedExports = 4;
  mapping = {
    "In": ["checkActivation", "function"]
  } as const;
};

export default new EphemeralHelpers();