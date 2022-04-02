import { usModule } from "@utils/usModule";
import * as rxop from "@utils/rxop";
import EphemeralHelpers from "@nai/EphemeralHelpers";

import type { Observable as Obs } from "rxjs";
import type { ContextSource } from "../../ContextSource";
import type { StoryContent } from "@nai/EventModule";
import type { EphemeralEntry } from "@nai/EphemeralHelpers";

type EphemeralSource = ContextSource<EphemeralEntry, "ephemeral">;

export type EphemeralActivation = true;

export default usModule((require, exports) => {
  const helpers = require(EphemeralHelpers);

  // We're going to be sloppy with this one; there's too many
  // entangled properties to check for.
  const isEphemeral = (source: ContextSource<any>): source is EphemeralSource =>
    source.type === "ephemeral";

  const checkActivation = (storyContent: StoryContent) =>
    (sources: Obs<ContextSource>): Obs<ContextSource> => sources.pipe(
      rxop.filter(isEphemeral),
      rxop.filter(({ entry }) => helpers.checkActivation(entry, storyContent.story.step))
    );

  return Object.assign(exports, { checkActivation });
});