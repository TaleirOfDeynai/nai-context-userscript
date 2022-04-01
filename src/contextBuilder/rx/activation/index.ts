import { usModule } from "@utils/usModule";
import ActCascade from "./cascade";
import ActEphemeral from "./ephemeral";
import ActForced from "./forced";
import ActKeyed from "./keyed";

export default usModule((require, exports) => {
  return Object.assign(exports, {
    cascade: ActCascade(require).checkActivation,
    ephemeral: ActEphemeral(require).checkActivation,
    forced: ActForced(require).checkActivation,
    keyed: ActKeyed(require).checkActivation
  });
});