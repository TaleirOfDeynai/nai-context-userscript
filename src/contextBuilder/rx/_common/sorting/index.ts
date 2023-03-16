import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import { chain } from "@utils/iterables";

// All the sorting functions available for use.
import budgetPriority from "./budgetPriority";
import $SelectionIndex from "./selectionIndex";
import $ContextGroup from "./contextGroup";
import $Reservation from "./reservation";
import activationEphemeral from "./activationEphemeral";
import activationForced from "./activationForced";
import activationStory from "./activationStory";
import activationNonStory from "./activationNonStory";
import $StoryKeyOrder from "./storyKeyOrder";
import $CategoryName from "./categoryName";
import entryName from "./entryName";
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
    ...$SelectionIndex(require),
    ...$ContextGroup(require),
    ...$Reservation(require),
    activationEphemeral,
    activationForced,
    activationStory,
    activationNonStory,
    ...$StoryKeyOrder(require),
    ...$CategoryName(require),
    entryName,
    cascadeInitDegree,
    cascadeFinalDegree,
    naturalByType,
    ...$NaturalByPosition(require)
  } as const);

  const assertConfig = (name: string) => (k: string) =>
    assert(`Unknown sorter "${k}" for \`${name}\` config!`, k in sorters);

  /**
   * Creates a master insertion sorter based on the functions specified
   * in the `selection.insertionOrdering` config.
   */
  const forInsertion = (contextParams: ContextParams) => {
    const chosenSorters = chain(usConfig.selection.insertionOrdering)
      // Force the natural sorters to be the last ones.
      .filter((k) => k !== "naturalByPosition" && k !== "naturalByType")
      .appendVal<SorterKey>("naturalByType", "naturalByPosition")
      // Check to make sure there's a sorter for each key.
      .tap(assertConfig("selection.insertionOrdering"))
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

  /**
   * Creates a master weighted selection sorter based on the functions
   * specified in the `weightedRandom.selectionOrdering` config.
   */
  const forWeightedSelection = (contextParams: ContextParams) => {
    const chosenSorters = chain(usConfig.weightedRandom.selectionOrdering)
      // Check to make sure there's a sorter for each key.
      .tap(assertConfig("weightedRandom.selectionOrdering"))
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
    forInsertion,
    forWeightedSelection
  });
});

export default theModule;

export type SorterKey = keyof ReturnType<typeof theModule>["sorters"];