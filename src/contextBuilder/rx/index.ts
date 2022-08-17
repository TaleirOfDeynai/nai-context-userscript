/**
 * This module provides the individual phases of the context building
 * process.  These will be arranged into a pipeline which eventually
 * leads to a fully assembled context.
 * 
 * Each phase is numbered to indicate the general order of the data
 * flowing through the process.  Some data from a lower-numbered phase
 * may be needed by a higher-numbered phase.
 * 
 * If two phases have the same number, that is an explicit indication
 * that they can safely execute as concurrent phases.  Since the
 * global tokenizer is a background worker, there is opportunity for
 * true concurrency here.
 */

import { usModule } from "@utils/usModule";
import $Source from "./10-source";
import $Activation from "./20-activation";
import $SubContexts from "./25-subContexts";
import $BiasGroups from "./30-biasGroups";
import $Selection from "./30-selection";
import $ContextGroups from "./35-contextGroups";
import $Assembly from "./40-assembly";
import $Export from "./50-export";

export default usModule((require, exports) => {
  return Object.assign(exports, {
    source: $Source(require),
    activation: $Activation(require),
    biasGroups: $BiasGroups(require),
    subContexts: $SubContexts(require),
    selection: $Selection(require),
    contextGroups: $ContextGroups(require),
    assembly: $Assembly(require),
    export: $Export(require)
  });
});