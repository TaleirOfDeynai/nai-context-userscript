import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { createLogger } from "@utils/logging";
import $SourceContent from "./content";
import $SourceEphemeral from "./ephemeral";
import $SourceLore from "./lore";
import $EnabledSeparator from "./enabled";

import type { IContextField } from "@nai/ContextModule";
import type { ContextParams } from "../../ParamsService";
import type { ContextSource } from "../../ContextSource";
import type { EnabledSource, DisabledSource } from "./enabled";

// Re-export these for convenience.
export { EnabledSource, DisabledSource };

export type StorySource = ContextSource<IContextField, "story">;

export interface SourcePhaseResult {
  storySource: rx.Observable<StorySource>,
  enabledSources: rx.Observable<EnabledSource>,
  disabledSources: rx.Observable<DisabledSource>
}

const logger = createLogger("Source Phase");

export default usModule((require, exports) => {
  const source = {
    content: $SourceContent(require).createStream,
    ephemeral: $SourceEphemeral(require).createStream,
    lore: $SourceLore(require).createStream,
    separateEnabled: $EnabledSeparator(require).separate
  } as const;

  const filterStory = (s: ContextSource): s is StorySource => s.type === "story";

  function sourcePhase(contextParams: ContextParams): SourcePhaseResult {
    // We'll want to pull the story out of NAI's default content.
    const defaultContent = source.content(contextParams).pipe(rxop.shareReplay());

    // Gather our content sources.
    const allSources = rx.merge(
      defaultContent,
      source.lore(contextParams),
      source.ephemeral(contextParams)
    ).pipe(logger.measureStream("All Sources"));

    return {
      storySource: defaultContent.pipe(
        rxop.filter(filterStory),
        rxop.single(),
        rxop.shareReplay()
      ),
      // Figure out which are enabled or disabled and return the partitioned streams.
      ...source.separateEnabled(contextParams.storyContent, allSources)
    };
  }

  return Object.assign(exports, source, { phaseRunner: sourcePhase });
});