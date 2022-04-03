import { usModule } from "@utils/usModule";
import Source from "./source";
import Activation from "./activation";
import BiasGroups from "./biasGroups";

export default usModule((require, exports) => {
  return Object.assign(exports, {
    source: Source(require),
    activation: Activation(require),
    biasGroups: BiasGroups(require)
  });
});