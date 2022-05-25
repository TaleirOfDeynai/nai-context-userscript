import userScriptConfig from "@config";
import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import { chain } from "@utils/iterables";
import { asBudgeted } from "./_shared";
import Sorters from "./_sorters";

import type { ContextParams } from "../../ParamsService";
import type { ActivatedSource } from "../activation";
import type { BudgetedSource } from "./_shared";
import type { SorterKey } from "./_sorters";

export default usModule((require, exports) => {
  /**
   * Sorts all inputs and emits them in order of their formalized insertion
   * priority.  This will also kick off a background task to calculate each
   * emitted element's base token count.
   * 
   * This will be used at the end to provide `actualReservedTokens` to the
   * user in the report, but it isn't really used for insertion or trimming.
   */
  const makeSelectorStream = (contextParams: ContextParams) => {
    /** Sorting functions we're going to use. */
    const chosenSorters = chain(userScriptConfig.selection.ordering)
      // Force the natural sorters to be the last ones.
      .filter((k) => k !== "naturalByPosition" && k !== "naturalByType")
      .concat<SorterKey>("naturalByType", "naturalByPosition")
      // Check to make sure there's a sorter for each key.
      .tap((k) => assert(`Unknown sorter "${k}" for \`selection.ordering\` config!`, k in Sorters))
      .map((k) => Sorters[k](contextParams, require))
      .toArray();

    const sortingFn = (a: BudgetedSource, b: BudgetedSource) => {
      for (let i = 0, len = chosenSorters.length; i < len; i++) {
        const result = chosenSorters[i](a, b);
        if (result !== 0) return result;
      }
      return 0;
    };

    return (sources: rx.Observable<ActivatedSource>) => sources.pipe(
      rxop.mergeMap(asBudgeted),
      rxop.toArray(),
      rxop.mergeMap((arr) => arr.sort(sortingFn))
    );
  };

  return Object.assign(exports, { createStream: makeSelectorStream });
});