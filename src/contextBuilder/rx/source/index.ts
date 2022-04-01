import { usModule } from "@utils/usModule";
import SourceContent from "./content";
import SourceEphemeral from "./ephemeral";
import SourceLore from "./lore";

export default usModule((require, exports) => {
  return Object.assign(exports, {
    content: SourceContent(require).createStream,
    ephemeral: SourceEphemeral(require).createStream,
    lore: SourceLore(require).createStream
  });
});