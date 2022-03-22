import { Subject } from "rxjs";
import type { ContextRecorder } from "../../naiModules/ContextBuilder";

/** A {@link Subject} that signals the start of context construction. */
export const onStartContext = new Subject<ContextRecorder>();

/** A {@link Subject} that signals the end of context construction. */
export const onEndContext = new Subject<ContextRecorder>();