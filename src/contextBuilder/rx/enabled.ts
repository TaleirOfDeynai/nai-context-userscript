
import { partition, share } from "rxjs";
import { usModule } from "@utils/usModule";
import { isBoolean, isObject } from "@utils/is";

import type { ContextField } from "@nai/ContextBuilder";
import type { ContextSource } from "../ContextSource";
import type { Observable as Obs } from "rxjs";

export default usModule((_require, exports) => {
  const isEnabled = <T extends ContextSource<any>>(source: T): boolean => {
    const { entry } = source;
    // If it isn't an object, it's default disabled.
    if (!isObject(entry)) return false;
    // If it lacks the `enabled` property, it's default enabled.
    if (!("enabled" in entry)) return true;
    // Unless it isn't well-formed.
    if (!isBoolean(entry.enabled)) return false;
    return entry.enabled;
  };

  const separate = <T extends ContextSource>(sources: Obs<T>) => {
    const [enabled, disabled] = partition(sources, isEnabled);
    return {
      enabledSources: enabled.pipe(share()),
      disabledSources: disabled.pipe(share())
    };
  };

  return Object.assign(exports, { separate });
});