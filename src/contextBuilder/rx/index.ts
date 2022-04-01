import { usModule } from "@utils/usModule";
import Source from "./source";
import Enabled from "./enabled";
import Activation from "./activation";

export default usModule((require, exports) => {
  return Object.assign(exports, {
    source: Source(require),
    separateEnabled: Enabled(require).separate,
    activation: Activation(require)
  });
});