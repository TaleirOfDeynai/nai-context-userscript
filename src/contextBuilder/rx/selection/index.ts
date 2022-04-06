import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import Vanilla from "./vanilla";

import type { Observable as Obs } from "@utils/rx";
import type { StoryContent } from "@nai/EventModule";
import type { ContextSource } from "../../ContextSource";
import type { TokenCodec } from "../../TokenizerService";
import type { ActivationResult, ActivationPhaseResult } from "../activation";


export interface SelectionResult extends ActivationResult {
  selectionOrder: number;
  tokenCount: Promise<number>;
}

export type SelectionObservable = Obs<SelectionResult>;

export interface SelectionPhaseResult {
  readonly tokenCounts: Promise<Map<ContextSource, number>>;
  readonly inFlight: SelectionObservable;
}

export default usModule((require, exports) => {
  const selectors = {
    vanilla: Vanilla(require).createStream
  };

  /**
   * This will be used at the end to provide `actualReservedTokens` to the
   * user in the report, but it isn't really used for insertion or trimming.
   */
  function selectionPhase(
    storyContent: StoryContent,
    tokenCodec: TokenCodec,
    activationResults: ActivationPhaseResult
  ): SelectionPhaseResult {
    const { orderByKeyLocations = false } = storyContent.lorebook.settings ?? {};

    const inFlight: SelectionObservable = activationResults.inFlight.pipe(
      selectors.vanilla(orderByKeyLocations),
      rxop.map((source, selectionOrder) => {
        const { contextConfig, text } = source.entry;
        const { prefix = "", suffix = "" } = contextConfig ?? {};
        const tokenCount = tokenCodec.encode([prefix, text, suffix].join(""))
          .then((v) => v.length)

        return Object.assign(source, { selectionOrder, tokenCount });
      }),
      rxop.shareReplay()
    );

    return {
      get tokenCounts() {
        return rx.firstValueFrom(inFlight.pipe(
          rxop.toArray(),
          rxop.mergeMap(async (sources) => {
            const promises = sources.map((s) => s.tokenCount);
            const tokenCounts = await Promise.all(promises);
            return new Map(tokenCounts.map((count, i) => [sources[i], count] as const));
          })
        ));
      },
      get inFlight() {
        return inFlight;
      }
    };
  };

  return Object.assign(exports, selectors, { phaseRunner: selectionPhase });
});