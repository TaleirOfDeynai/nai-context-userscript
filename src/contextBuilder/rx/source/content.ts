import { of } from "rxjs";
import { usModule } from "@utils/usModule";
import ContextModule from "@nai/ContextModule";
import ContextSource from "../../ContextSource";
import type { ContextContent } from "@nai/ContextModule";
import type { StoryContent } from "@nai/EventModule";

/**
 * Handles the conversion of content blocks into an observable.
 */
export default usModule((require, exports) => {
  const { ContextContent } = require(ContextModule);
  const contextSource = ContextSource(require);

  const toContextSource = (content: ContextContent, index: number) => {
    // THese are expected to come in an assumed order.
    switch (index) {
      case 0: return contextSource.create(content, "story");
      case 1: return contextSource.create(content, "memory");
      case 2: return contextSource.create(content, "an");
      default: return contextSource.create(content, "unknown");
    }
  };

  const createStream = (storyText: string) => (storyContent: StoryContent) => {
    const contextChunks = [
      new ContextContent(storyContent.storyContextConfig, storyText),
      ...storyContent.context
    ];
    return of(...contextChunks.map(toContextSource))
  };

  return Object.assign(exports, {
    createStream
  });
});