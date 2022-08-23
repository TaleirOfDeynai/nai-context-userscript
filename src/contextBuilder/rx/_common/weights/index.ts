import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { isArray } from "@utils/is";
import { assert } from "@utils/assert";
import { chain } from "@utils/iterables";
import { add } from "./_helpers";

// All the weight functions available for use.
import $CascadeCount from "./cascadeCount";
import $CascadeRatio from "./cascadeRatio";
import $SearchRange from "./searchRange";
import $StoryCount from "./storyCount";

import type { ContextParams } from "../../../ParamsService";
import type { SourceOf } from "../index";
import type { BudgetedSource } from "../selection";

export interface Weight {
  readonly type: "additive" | "scalar";
  readonly value: number;
}

export type EntryWeigher =
  (contextParams: ContextParams, allSources: readonly SourceOf<BudgetedSource>[]) =>
  (source: SourceOf<BudgetedSource>) =>
  Weight;

const theModule =  usModule((require, exports) => {
  const weighers = {
    ...$CascadeCount(require),
    ...$CascadeRatio(require),
    ...$SearchRange(require),
    ...$StoryCount(require)
  };

  const assertConfig = (name: string) => (k: string) =>
    assert(`Unknown weigher "${k}" for \`${name}\` config!`, k in weighers);

  const fromConfigValue = (keys: WeightingValue): EntryWeigher | EntryWeigher[] => {
    if (!isArray(keys)) return weighers[keys];
    return keys.map((k) => weighers[k]);
  };
  
  const toWeigher = (fns: EntryWeigher | EntryWeigher[]): EntryWeigher => {
    if (!isArray(fns)) return fns;

    // Create a composite weigher that yields an additive value.
    return (params, allSources) => {
      const chosenWeights = fns.map((fn) => fn(params, allSources));

      return (source) => {
        const score = chosenWeights
          .map((fn) => fn(source))
          .reduce((acc, weight) => {
            switch (weight.type) {
              case "additive": return acc + weight.value;
              case "scalar": return acc * weight.value;
            }
          }, 0);
        return add(score);
      };
    };
  };

  /**
   * Creates a master weighting function based on the weighting functions
   * specified in the `weightedRandom.weighting` config.
   */
  const forScoring = (
    contextParams: ContextParams,
    allSources: readonly SourceOf<BudgetedSource>[]
  ) => {
    const compositeWeigher = chain(usConfig.weightedRandom.weighting)
      // Check to make sure there's a weigher for each key.
      .tap((v) => {
        if (!isArray(v)) assertConfig("weightedRandom.weighting")(v);
        else v.forEach(assertConfig("weightedRandom.weighting"));
      })
      // Convert to weighing functions.
      .map(fromConfigValue)
      .map(toWeigher)
      // And apply our arguments.
      .value((iter) => toWeigher([...iter])(contextParams, allSources));

    // It will always be an additive weighting function.
    return (source: SourceOf<BudgetedSource>) => compositeWeigher(source).value;
  };

  return Object.assign(exports, {
    weighers,
    forScoring
  });
});

export default theModule;

export type WeigherKey = keyof ReturnType<typeof theModule>["weighers"];
export type WeightingValue = WeigherKey | WeigherKey[];
export type WeightingConfig = WeightingValue[];