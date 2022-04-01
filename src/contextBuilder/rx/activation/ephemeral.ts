import { EMPTY } from "rxjs";
import { usModule } from "@utils/usModule";

import type { Observable as Obs } from "rxjs";
import type { IContextSource } from "../../ContextSource";

export type EphemeralActivation = true;

export default usModule((require, exports) => {
  const checkActivation = (): Obs<IContextSource> => EMPTY;

  return Object.assign(exports, {
    checkActivation
  });
});