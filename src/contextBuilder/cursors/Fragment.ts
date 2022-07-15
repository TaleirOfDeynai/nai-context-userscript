import type { TextFragment } from "../TextSplitterService";
import type { Assembly } from "../assemblies";

/**
 * A cursor targeting a position in a specific {@link TextFragment}
 * from the {@link Assembly.IFragment} indicated as the `origin`.
 */
export interface FragmentCursor {
  readonly type: "fragment";
  readonly origin: Assembly.IFragment;
  readonly offset: number;
}

/** Creates a fragment cursor. */
const fragment = (origin: Assembly.IFragment, offset: number): FragmentCursor =>
  Object.freeze({ type: "fragment", origin, offset });

export default fragment;