import _conforms from "lodash/conforms";
import { usModule } from "@utils/usModule";
import { isInstance } from "@utils/is";

import type { TypePredicate } from "@utils/is";
import type { ContextRecorder } from "@nai/ContextBuilder";
import type { ActivatedSource } from "./activation";
import type { SomeContextSource } from "./index";

export interface SubContextSource extends ActivatedSource {
  subContext: ContextRecorder
}

export default usModule((_require, exports) => {
  /** Checks to see if `source` has a `subContext` field. */
  const isSubContextSource = _conforms<any>({
    subContext: (v) => isInstance(v),
    activated: (v) => v === true
  }) as TypePredicate<SubContextSource, SomeContextSource>;

  return Object.assign(exports, {
    isSubContextSource
  });
});