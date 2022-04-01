import * as rx from "rxjs";
import { eachValueFrom } from "rxjs-for-await";
import { usModule } from "@utils/usModule";
import { isBoolean, isObject } from "@utils/is";
import ContextBuilder from "@nai/ContextBuilder";

import type { Observable } from "rxjs";
import type { AnyValueOf } from "@utils/utility-types";
import type { ReportReasons, ContextField } from "@nai/ContextBuilder";
import type { IContextSource, SourceType } from "../../ContextSource";
import type { LoreEntry } from "@nai/Lorebook";

type MaybeForce = Partial<Pick<LoreEntry, "forceActivation">>;
type InputSource = IContextSource<ContextField & MaybeForce>;

export type ForcedActivation = AnyValueOf<ReportReasons>;

/**
 * Checks each {@link IContextSource} for forced activation conditions.
 */
export default usModule((require, exports) => {
  const { REASONS } = require(ContextBuilder);

  const forcedTypes = new Set<SourceType>(["story", "memory", "an", "unknown"]);

  const isForceActivated = (entry: any): boolean => {
    if (!isObject(entry)) return false;
    if (!("forceActivation" in entry)) return false;
    if (!isBoolean(entry.forceActivation)) return false;
    return entry.forceActivation;
  };

  const checkSource = (source: InputSource) => {
    if (forcedTypes.has(source.type)) return REASONS.Default;
    if (isForceActivated(source.entry)) return REASONS.ActivationForced;
    return undefined;
  };

  async function* impl_checkActivation(sources: Observable<InputSource>) {
    for await (const source of eachValueFrom(sources)) {
      const reason = checkSource(source);
      if (!reason) continue;

      source.activations.set("forced", reason);
      yield source;
    }
  };

  const checkActivation = (sources: Observable<InputSource>) =>
    rx.from(impl_checkActivation(sources));

  return Object.assign(exports, { checkActivation });
});