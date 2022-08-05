import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import { chain } from "@utils/iterables";

// All the sorting functions available for use.
import budgetPriority from "./budgetPriority";
import $Reservation from "./reservation";
import activationEphemeral from "./activationEphemeral";
import activationForced from "./activationForced";
import activationStory from "./activationStory";
import activationNonStory from "./activationNonStory";
import $StoryKeyOrder from "./storyKeyOrder";
import cascadeInitDegree from "./cascadeInitDegree";
import cascadeFinalDegree from "./cascadeFinalDegree";
import naturalByType from "./naturalByType";
import $NaturalByPosition from "./naturalByPosition";

import type { ContextParams } from "../../../ParamsService";
import type { SourceOf } from "../index";
import type { BudgetedSource } from "../selection";

export type EntrySorter =
  (contextParams: ContextParams) =>
  (a: SourceOf<BudgetedSource>, b: SourceOf<BudgetedSource>) =>
  number;

const theModule = usModule((require, exports) => {
  const sorters = Object.freeze({
    budgetPriority,
    ...$Reservation(require),
    activationEphemeral,
    activationForced,
    activationStory,
    activationNonStory,
    ...$StoryKeyOrder(require),
    cascadeInitDegree,
    cascadeFinalDegree,
    naturalByType,
    ...$NaturalByPosition(require)
  } as const);

  const forInsertion = (contextParams: ContextParams) => {
    const chosenSorters = chain(usConfig.selection.insertionOrdering)
      // Force the natural sorters to be the last ones.
      .filter((k) => k !== "naturalByPosition" && k !== "naturalByType")
      .appendVal<SorterKey>("naturalByType", "naturalByPosition")
      // Check to make sure there's a sorter for each key.
      .tap((k) => assert(`Unknown sorter "${k}" for \`selection.ordering\` config!`, k in sorters))
      .map((k) => sorters[k](contextParams))
      .toArray();
    
    return (a: SourceOf<BudgetedSource>, b: SourceOf<BudgetedSource>) => {
      for (let i = 0, len = chosenSorters.length; i < len; i++) {
        const result = chosenSorters[i](a, b);
        if (result !== 0) return result;
      }
      return 0;
    };
  };

  return Object.assign(exports, {
    sorters,
    forInsertion
  });
});

export default theModule;

export type SorterKey = keyof ReturnType<typeof theModule>["sorters"];