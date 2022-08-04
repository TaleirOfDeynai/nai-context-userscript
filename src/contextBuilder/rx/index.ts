import { usModule } from "@utils/usModule";
import $Source from "./10-source";
import $Activation from "./20-activation";
import $BiasGroups from "./30-biasGroups";
import $SubContexts from "./25-subContexts";
import $Selection from "./30-selection";
import $Assembly from "./40-assembly";
import $Export from "./50-export";

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