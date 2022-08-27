/**
 * A selector using weighted-random selection.  Uses various information
 * to score and select entries, where those with a higher score are more
 * likely to be selected.
 * - Groups entries into selection pools.  This is affected by the
 *   `selectionOrdering` config, but the intended gist is that only
 *   entries that share the same `budgetPriority` will be grouped.
 * - The force activated and ephemeral activated entries are always
 *   selected first and before any random selections.
 * - Only keyed and cascading entries are randomly selected.
 * - Sorts all entries into the final insertion order.  In order for
 *   the selection to work correctly, ensure the `selectionIndex` sorter
 *   is added to the `selection.insertionOrdering` config.
 * 
 * Configuration that affects this module:
 * - Enabled by `weightedRandom.enabled`.
 * - Randomness is affected by `weightedRandom.seedWithStory`.
 * - Grouping criteria affected by `weightedRandom.selectionOrdering`.
 * - Output ordering affected by `selection.insertionOrdering`.
 */

import usConfig from "@config";
import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { chain } from "@utils/iterables";
import * as IterOps from "@utils/iterables";
import { createLogger } from "@utils/logging";
import { createSeededRng } from "@utils/rng";
import Roulette from "@utils/Roulette";
import $QueryOps from "../../assemblies/queryOps";
import $Common from "../_common";

import type { ContextParams } from "../../ParamsService";
import type { ActivatedSource } from "../_common/activation";
import type { StorySource } from "../10-source";

const createRng = (seed: string): () => number => {
  if (!usConfig.weightedRandom.seedWithStory)
    return Math.random.bind(Math);
  return createSeededRng(seed);
};

export default usModule((require, exports) => {
  const queryOps = $QueryOps(require);
  const { sorting, selection, weights } = $Common(require);

  /**
  * Sorts all inputs and emits them in order of their formalized insertion
  * priority.  This will also calculate each emitted element's budget stats.
  */
  const createStream = (
    contextParams: ContextParams,
    storySource: rx.Observable<StorySource>
  ) => {
    const logger = createLogger(`Weighted Selection: ${contextParams.contextName}`);

    const selectionSort = sorting.forWeightedSelection(contextParams);
    const insertionSort = sorting.forInsertion(contextParams);

    const determineEligible = (source: ActivatedSource) => {
      const { activations } = source;
      if (activations.has("forced")) return "ineligible";
      if (activations.has("ephemeral")) return "ineligible";
      return "eligible";
    };
    
    function* doWeighting(
      selectionGroup: ActivatedSource[],
      weightingFn: (source: ActivatedSource) => number,
      rngFn: () => number
    ): Iterable<ActivatedSource> {
      const { ineligible = [], eligible = [] } = chain(selectionGroup)
        .thru((sources) => IterOps.groupBy(sources, determineEligible))
        .value(IterOps.fromPairs);
      
      // Ineligible entries are always selected.
      for (const source of ineligible) {
        logger.info(`Selected "${source.identifier}" implicitly.`);
        yield source;
      }

      // Fast-path: if there are no eligible entries, we're done.
      if (eligible.length === 0) return; 

      const roulette = new Roulette<ActivatedSource>(rngFn);
      for (const source of eligible) {
        const score = weightingFn(source);
        if (score <= 0) continue;
        roulette.push(score, source);
      }

      let selectionIndex = 0;
      for (const [source, weight] of roulette.pickToExhaustion()) {
        logger.info(`Selected "${source.identifier}" with score ${weight.toFixed(2)}.`);
        yield Object.assign(source, { selectionIndex });
        selectionIndex += 1;
      }
    }

    return (sources: rx.Observable<ActivatedSource>) => {
      const weightingFn = sources.pipe(
        rxop.toArray(),
        rxop.map((allSources) => weights.forScoring(contextParams, allSources))
      );

      const rngFn = storySource.pipe(
        rxop.map((s) => queryOps.getText(s.entry.searchedText)),
        rxop.map(createRng)
      );

      const selectionGroups = sources.pipe(
        rxop.toArray(),
        rxop.map((arr) => arr.sort(selectionSort)),
        rxop.mergeMap((arr) => IterOps.batch(arr, selectionSort)),
        rxop.tap((group) => logger.info("Selection Group", group))
      );

      return selectionGroups.pipe(
        rxop.withLatestFrom(weightingFn, rngFn),
        rxop.mergeMap((args) => doWeighting(...args)),
        rxop.mergeMap(selection.asBudgeted),
        rxop.toArray(),
        rxop.mergeMap((arr) => arr.sort(insertionSort))
      );
    }
  };

  return Object.assign(exports, { createStream });
});