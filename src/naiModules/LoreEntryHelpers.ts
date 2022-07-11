import { ModuleDef } from "../require";
import type * as Lorebook from "./Lorebook";
import type * as MatchResults from "./MatchResults";

export interface NaiRegex {
  isRegex: boolean;
  regex: string;
  flags: string[];
  placeholders: boolean;
}

export namespace Virtual {
  export declare function tryParseRegex(key: string): NaiRegex;

  export declare function checkActivation(
    /** The lorebook entry to check. */
    entry: Lorebook.LoreEntry,
    /** The text available to search for keyword matches. */
    searchText: string,
    /**
     * Whether to do a quick test only.  When `true` and a match is found,
     * this will return a result where `index` and `length` are both `0`.
     * Only the `key` property is really of use.  Defaults to `false`.
     */
    quickCheck?: boolean,
    /** An object providing an alternative `searchRange` to use. */
    searchRangeDonor?: { searchRange: number },
    /**
     * Forces an entry that would force-activate to instead check its keys.
     * The entry must still be enabled.  Defaults to `false`.
     */
    forceKeyChecks?: boolean
  ): MatchResults.AnyResult;
}

export interface ILoreEntryHelpers {
  "nn": typeof Virtual.tryParseRegex;
  "P5": typeof Virtual.checkActivation;
}

class LoreEntryHelpers extends ModuleDef<ILoreEntryHelpers> {
  moduleId = 38734;
  expectedExports = 5;
  mapping = {
    "nn": ["tryParseRegex", "function"],
    "P5": ["checkActivation", "function"]
  } as const;
};

export default new LoreEntryHelpers();