import { usModule } from "@utils/usModule";
import Source from "./source";
import Activation from "./activation";

export default usModule((require, exports) => {
  return Object.assign(exports, {
    source: Source(require),
    activation: Activation(require)
  });
});