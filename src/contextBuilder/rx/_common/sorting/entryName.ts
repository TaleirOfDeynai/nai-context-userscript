import _conforms from "lodash/conforms";
import { isString } from "@utils/is";

import type { TypePredicateOf } from "@utils/is";
import type { LoreEntry } from "@nai/Lorebook";
import type { ExtendField } from "../../../ContextSource";
import type { BudgetedSource } from "../selection";
import type { EntrySorter } from "./index";

type NamedSource = ExtendField<BudgetedSource, {
  displayName: LoreEntry["displayName"]
}>;

const isNamed = _conforms<any>({
  entry: _conforms({
    fieldConfig: _conforms({
      // Need a non-empty string to qualify.
      displayName: (v) => isString(v) && Boolean(v)
    })
  })
}) as TypePredicateOf<NamedSource>;

/** Sorts sources by their `displayName`, if they have one. */
const entryName: EntrySorter = () => (a, b) => {
  var aName = isNamed(a) ? a.entry.fieldConfig.displayName : "";
  var bName = isNamed(b) ? b.entry.fieldConfig.displayName : "";
  return aName.localeCompare(bName);
};

export default entryName;