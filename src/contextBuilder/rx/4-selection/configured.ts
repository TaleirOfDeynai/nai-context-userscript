/**
 * Since the selection mechanism is based on the config, this module
 * just re-exports the configured one so the category sub-context
 * can make use of it.
 */

import usConfig from "@config";
import { usModule } from "@utils/usModule";
import $VanillaSelector from "./vanilla";

export default usModule((require, exports) => {
  // TODO: when the weighted-random selector exists, add it here.
  const { createStream } = $VanillaSelector(require);

  return Object.assign(exports, { createStream });
});