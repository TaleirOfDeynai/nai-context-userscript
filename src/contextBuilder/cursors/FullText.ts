import type { TextFragment } from "../TextSplitterService";
import type { Assembly } from "../assemblies";

/**
 * A cursor targeting a position in the concatenation of all
 * {@link TextFragment} in the {@link Assembly.IFragment} indicated
 * as the `origin`.
 */
export interface FullTextCursor {
  readonly type: "fullText";
  readonly origin: Assembly.IFragment;
  readonly offset: number;
}

/** Creates a full-text cursor. */
const fullText = (origin: Assembly.IFragment, offset: number): FullTextCursor =>
  Object.freeze({ type: "fullText", origin, offset });

export default fullText;