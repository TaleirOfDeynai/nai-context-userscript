import * as rx from "@utils/rx";
import { usModule } from "@utils/usModule";
import ContextSource from "../../ContextSource";
import type { StoryContent } from "@nai/EventModule";

/**
 * Handles the conversion of ephemeral entries into an observable.
 */
export default usModule((require, exports) => {
  const contextSource = ContextSource(require);

  const createStream = ({ ephemeralContext }: StoryContent) =>
    rx.of(...ephemeralContext.map((entry) => contextSource.create(entry, "ephemeral")));

  return Object.assign(exports, {
    createStream
  });
});