import { ModuleDef } from "../require";
import type * as Lorebook from "./Lorebook";
import type * as MatchResults from "./MatchResults";

export namespace Virtual {
  export declare function checkActivation(
    cascadingEntry: Lorebook.LoreEntry,
    textToInsert: string,
    // Exist, but not used by this part of the code.
    n?, r?, i?
  ): MatchResults.AnyResult;
}

export interface ICascadeHelpers {
  "P5": typeof Virtual.checkActivation;
}

class CascadeHelpers extends ModuleDef<ICascadeHelpers> {
  moduleId = 12555;
  expectedExports = 5;
  mapping = {
    "P5": ["checkActivation", "function"]
  } as const;
};

export default new CascadeHelpers();