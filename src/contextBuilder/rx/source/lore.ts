import * as rx from "@utils/rx";
import { usModule } from "@utils/usModule";
import ContextSource from "../../ContextSource";
import type { StoryContent } from "@nai/EventModule";

/**
 * Handles the conversion of lorebook entries into an observable.
 */
export default usModule((require, exports) => {
  const contextSource = ContextSource(require);

  const createStream = ({ lorebook: { entries } }: StoryContent) =>
    rx.of(...entries.map((entry) => contextSource.create(entry, "lore")));

  return Object.assign(exports, {
    createStream
  });
});