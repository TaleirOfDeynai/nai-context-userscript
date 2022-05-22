import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import $ContextSource from "../../ContextSource";
import $ContextContent from "../../ContextContent";

import type { ContextParams } from "../../ParamsService";

/**
 * Handles the conversion of ephemeral entries into an observable.
 */
export default usModule((require, exports) => {
  const { ContextContent } = $ContextContent(require);
  const contextSource = $ContextSource(require);

  const createStream = (contextParams: ContextParams) => {
    const ephemeralContent = contextParams.storyContent.ephemeralContext
      .map((f) => ContextContent.forField(f, contextParams));

    return rx.from(ephemeralContent).pipe(
      rxop.mergeAll(),
      rxop.map((c) => contextSource.create(c, "ephemeral"))
    );
  };

  return Object.assign(exports, {
    createStream
  });
});