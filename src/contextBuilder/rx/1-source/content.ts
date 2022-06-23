import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import $ContextSource from "../../ContextSource";
import $ContextContent from "../../ContextContent";

import type { ContextParams } from "contextBuilder/ParamsService";
import type { ContextContent } from "../../ContextContent";

/**
 * Handles the conversion of content blocks into an observable.
 */
export default usModule((require, exports) => {
  const { ContextContent } = $ContextContent(require);
  const contextSource = $ContextSource(require);

  const toContextSource = (content: ContextContent, index: number) => {
    // THese are expected to come in an assumed order.
    switch (index) {
      case 0: return contextSource.create(content, "story");
      case 1: return contextSource.create(content, "memory");
      case 2: return contextSource.create(content, "an");
      default: return contextSource.create(content, "unknown");
    }
  };

  const createStream = (contextParams: ContextParams) => {
    const contextChunks = dew(() => {
      const { context } = contextParams.storyContent;
      const chunks = [
        ContextContent.forStory(contextParams),
        ...context.map((f) => ContextContent.forField(f, contextParams))
      ];
      return chunks.map(async (content, i) => toContextSource(await content, i));
    });

    return rx.from(contextChunks).pipe(rxop.mergeAll());
  };

  return Object.assign(exports, {
    createStream
  });
});