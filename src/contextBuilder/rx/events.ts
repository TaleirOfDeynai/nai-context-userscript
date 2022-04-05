import { Subject } from "@utils/rx";
import type { ContextRecorder } from "@nai/ContextBuilder";

/** A {@link Subject} that signals the start of context construction. */
export const onStartContext = new Subject<ContextRecorder>();

/** A {@link Subject} that signals the end of context construction. */
export const onEndContext = new Subject<ContextRecorder>();