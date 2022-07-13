import type { TextFragment } from "../TextSplitterService";
import type { IFragmentAssembly } from "../assemblies/Fragment";

/**
 * A cursor targeting a position in a specific {@link TextFragment}
 * from the {@link IFragmentAssembly} indicated as the `origin`.
 */
export interface FragmentCursor {
  readonly type: "fragment";
  readonly origin: IFragmentAssembly;
  readonly offset: number;
}

/** Creates a fragment cursor. */
const fragment = (origin: IFragmentAssembly, offset: number): FragmentCursor =>
  Object.freeze({ type: "fragment", origin, offset });

export default fragment;