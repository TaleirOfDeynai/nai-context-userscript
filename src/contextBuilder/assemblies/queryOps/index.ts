/**
 * Module related to perform queries against `IFragmentAssembly`.
 */

import { usModule } from "@utils/usModule";

// Direct imports...
import * as theBasics from "./theBasics";

// User-script imports...
import $IsContiguous from "./isContiguous";
import $TheStats from "./theStats";
 
export default usModule((require, exports) => {
  return Object.assign(exports, {
    ...theBasics,
    ...$IsContiguous(require),
    ...$TheStats(require)
  });
});