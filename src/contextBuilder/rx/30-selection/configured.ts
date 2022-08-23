/**
 * Since the selection mechanism is based on the config, this module
 * just re-exports the configured one so the category sub-context
 * can make use of it.
 */

import usConfig from "@config";
import { usModule } from "@utils/usModule";
import $Vanilla from "./vanilla";
import $WeightedRandom from "./weightedRandom";

export default usModule((require, exports) => {
  if (usConfig.weightedRandom.enabled) {
    const { createStream } = $WeightedRandom(require);
    return Object.assign(exports, { createStream });
  }
  else {
    const { createStream } = $Vanilla(require);
    return Object.assign(exports, { createStream });
  }
});