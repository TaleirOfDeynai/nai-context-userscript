import { ModuleDef } from "../require";

export namespace Virtual {
  /**
   * Basically this function:
   * https://github.com/uuidjs/uuid/blob/main/src/v4.js
   */
  export declare function v4(): string;
}

export interface IUuid {
  "Z": typeof Virtual.v4;
}

class UUID extends ModuleDef<IUuid> {
  moduleId = 5185;
  expectedExports = 1;
  mapping = {
    "Z": ["v4", "function"]
  } as const;
};

export default new UUID();