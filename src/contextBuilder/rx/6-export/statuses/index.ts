
import { usModule } from "@utils/usModule";
import $ForDisabled from "./forDisabled";
import $ForInactive from "./forInactive";
import $ForUnselected from "./forUnselected";
import $ForUnbudgeted from "./forUnbudgeted";
import $ForInserted from "./forInserted";

export default usModule((require, exports) => {
  return Object.assign(exports, {
    ...$ForDisabled(require),
    ...$ForInactive(require),
    ...$ForUnselected(require),
    ...$ForUnbudgeted(require),
    ...$ForInserted(require)
  });
});