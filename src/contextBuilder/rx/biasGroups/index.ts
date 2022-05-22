import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { createLogger } from "@utils/logging";
import $BiasLore from "./lore";
import $BiasCategory from "./category";

import type { StoryContent } from "@nai/EventModule";
import type { ActivationPhaseResult } from "../activation";
import type { TriggeredBiasGroup } from "../_shared";

export interface BiasGroupPhaseResult {
  /** Resolves to a complete array of {@link TriggeredBiasGroup} instances. */
  readonly biasGroups: Promise<TriggeredBiasGroup[]>;
  /** An {@link rx.Observable Observable} of {@link TriggeredBiasGroup} instances. */
  readonly inFlight: rx.Observable<TriggeredBiasGroup>;
}

const logger = createLogger("Bias Groups Phase");

export default usModule((require, exports) => {
  const biasGroups = {
    lore: $BiasLore(require).createStream,
    category: $BiasCategory(require).createStream
  };

  function biasGroupPhase(
    storyContent: StoryContent,
    activationResults: ActivationPhaseResult
  ): BiasGroupPhaseResult {
    const inFlight = rx.merge(
      biasGroups.lore(activationResults.inFlight),
      biasGroups.category(storyContent, activationResults.inFlight)
    ).pipe(logger.measureStream("In-flight Bias Groups"), rxop.shareReplay());

    return {
      get biasGroups(): Promise<TriggeredBiasGroup[]> {
        return rx.firstValueFrom(inFlight.pipe(rxop.toArray()));
      },
      get inFlight() {
        return inFlight;
      }
    };
  }

  return Object.assign(exports, biasGroups, { phaseRunner: biasGroupPhase });
});