import _conforms from "lodash/conforms";
import _matches from "lodash/matches";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import ContextBuilder from "@nai/ContextBuilder";

import type { Observable } from "@utils/rx";
import type { AnyValueOf } from "@utils/utility-types";
import type { ReportReasons } from "@nai/ContextBuilder";
import type { ContextSource, SourceType } from "../../ContextSource";
import type { ActivationState } from ".";

export type ForcedActivation = AnyValueOf<ReportReasons>;

/**
 * Checks each {@link ContextSource} for forced activation conditions.
 */
export default usModule((require, exports) => {
  const { REASONS } = require(ContextBuilder);

  const forcedTypes = new Set<SourceType>(["story", "memory", "an", "unknown"]);

  const isForceActivated = _conforms({
    entry: _conforms({
      fieldConfig: _matches({
        // Obviously, must be true.
        forceActivation: true
      })
    })
  });

  const checkSource = (source: ContextSource<any>) => {
    if (forcedTypes.has(source.type)) return REASONS.Default;
    if (isForceActivated(source)) return REASONS.ActivationForced;
    return undefined;
  };

  const checkActivation = (states: Observable<ActivationState>) => states.pipe(
    rxop.collect((state) => {
      const reason = checkSource(state.source);
      if (!reason) return undefined;

      state.activations.set("forced", reason);
      return state;
    })
  );

  return Object.assign(exports, { checkActivation });
});