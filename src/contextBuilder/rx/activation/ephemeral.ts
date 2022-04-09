import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import EphemeralHelpers from "@nai/EphemeralHelpers";

import type { Observable as Obs } from "@utils/rx";
import type { StoryContent } from "@nai/EventModule";
import type { EphemeralEntry } from "@nai/EphemeralHelpers";
import type { EnabledSource } from "../source";
import type { ActivationState } from ".";

type EphemeralState = ActivationState<EnabledSource & {
  entry: EphemeralEntry
}>;

export type EphemeralActivation = true;

export default usModule((require, exports) => {
  const helpers = require(EphemeralHelpers);

  // We're going to be sloppy with this one; there's too many
  // entangled properties to check for.
  const isEphemeral = (state: ActivationState): state is EphemeralState =>
    state.source.type === "ephemeral";

  const checkActivation = (storyContent: StoryContent) => {
    const { step } = storyContent.story;
    return (states: Obs<ActivationState>): Obs<ActivationState> => states.pipe(
      rxop.filter(isEphemeral),
      rxop.filter(({ source: { entry } }) => helpers.checkActivation(entry, step)),
      rxop.tap((state) => state.activations.set("ephemeral", true))
    );
  };

  return Object.assign(exports, { checkActivation });
});