import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { chain, groupBy, fromPairs } from "@utils/iterables";
import $Activation from "../activation";
import { nil, scalar } from "./_helpers";

import type { ActivatedSource } from "../activation";
import type { EntryWeigher } from "./index";

/** A value used to bump the point values up. */
const ADJUSTMENT = 1.8;

export default usModule((require, exports) => {
  const { isActivated } = $Activation(require);

  const theFilter = (s: any): s is ActivatedSource => {
    if (!isActivated(s)) return false;
    if (s.activations.get("keyed")?.size) return true;
    if (s.activations.get("cascade")?.matches?.size) return true;
    return false;
  };

  const theClassifier = (s: ActivatedSource) => {
    if (s.activations.get("keyed")?.size) return "storyActivated";
    return "cascadeOnly";
  };

  /**
   * Weight function that applies a penalty when entries that activate
   * only by cascade are more common than entries that activate by
   * a story keyword.
   * 
   * Use this to decrease emphasis on the cascade score if there are
   * too many entries that are activating only by cascade.
   */
  const cascadeRatio: EntryWeigher = (_params, allSources) => {
    // Calculate the ratio.
    const theRatio = dew(() => {
      const { storyActivated = [], cascadeOnly = [] } = chain(allSources)
        .filter(theFilter)
        .thru((iter) => groupBy(iter, theClassifier))
        .value(fromPairs);

      // Do nothing if we have a useless ratio.
      if (storyActivated.length === 0) return nil;
      if (cascadeOnly.length === 0) return nil;

      // When the number of cascade-only entries is less than the number
      // of story-activated entries, we apply no penalty.
      if (storyActivated.length >= cascadeOnly.length) return nil;

      // Otherwise, the penalty scales with the ratio.
      return scalar(storyActivated.length / cascadeOnly.length);
    });

    return (source) => {
      // Can't score if the entry has no activation data.
      if (!isActivated(source)) return nil;

      // We only score it if the source has a cascade activation.
      const cascade = source.activations.get("cascade");
      if (!cascade) return nil;

      return theRatio;
    };
  };

  return Object.assign(exports, { cascadeRatio });
});