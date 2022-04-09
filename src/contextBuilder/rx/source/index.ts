import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { createLogger } from "@utils/logging";
import SourceContent from "./content";
import SourceEphemeral from "./ephemeral";
import SourceLore from "./lore";
import EnabledSeparator from "./enabled";

import type { StoryContent } from "@nai/EventModule";
import type { EnabledSource, DisabledSource } from "./enabled";

// Re-export these for convenience.
export { EnabledSource, DisabledSource };

export interface SourcePhaseResult {
  enabledSources: rx.Observable<EnabledSource>,
  disabledSources: rx.Observable<DisabledSource>
}

const logger = createLogger("Source Phase");

export default usModule((require, exports) => {
  const source = {
    content: SourceContent(require).createStream,
    ephemeral: SourceEphemeral(require).createStream,
    lore: SourceLore(require).createStream,
    separateEnabled: EnabledSeparator(require).separate
  };

  function sourcePhase(
    storyContent: StoryContent,
    deferredStoryText: rx.Observable<string>
  ): SourcePhaseResult {
    // Gather our content sources.
    const allSources = rx.merge(
      // Stalling on getting the story text as much as possible.
      deferredStoryText.pipe(
        rxop.map(source.content),
        rxop.mergeMap((contentSourcer) => contentSourcer(storyContent))
      ),
      // Meanwhile, we can still process these.
      source.lore(storyContent),
      source.ephemeral(storyContent)
    ).pipe(logger.measureStream("All Sources"));

    // Figure out which are enabled or disabled and return the partitioned streams.
    return source.separateEnabled(storyContent, allSources);
  }

  return Object.assign(exports, source, { phaseRunner: sourcePhase });
});