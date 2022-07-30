import { usModule } from "@utils/usModule";
import $Source from "./1-source";
import $Activation from "./2-activation";
import $BiasGroups from "./3-biasGroups";
import $SubContexts from "./3-subContexts";
import $Selection from "./4-selection";
import $Assembly from "./5-assembly";
import $Export from "./6-export";

export default usModule((require, exports) => {
  return Object.assign(exports, {
    source: $Source(require),
    activation: $Activation(require),
    biasGroups: $BiasGroups(require),
    subContexts: $SubContexts(require),
    selection: $Selection(require),
    assembly: $Assembly(require),
    export: $Export(require)
  });
});