import { usModule } from "@utils/usModule";
import $Activation from "../activation";
import { nil, add } from "./_helpers";

import type { EntryWeigher } from "./index";

/** A value used to bump the point values up. */
const ADJUSTMENT = 1.8;

export default usModule((require, exports) => {
  const { isActivated } = $Activation(require);

  /**
   * Weight function that adds points for each match in another entry.
   * The points provided are reduced the higher the degree of the match.
   */
  const cascadeCount: EntryWeigher = () => (source) => {
    // Can't score if the entry has no activation data.
    if (!isActivated(source)) return nil;

    // We only score it if the source has a cascade activation.
    const cascade = source.activations.get("cascade");
    if (!cascade) return nil;

    let totalScore = 0;
    for (const result of cascade.matches.values()) {
      const baseScalar = 1 / (1 + result.matchDegree);
      totalScore += baseScalar * ADJUSTMENT * result.size;
    }

    return add(totalScore);
  };

  return Object.assign(exports, { cascadeCount });
});