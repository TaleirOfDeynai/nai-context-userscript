import type { TextFragment } from "../TextSplitterService";
import type { IFragmentAssembly } from "../assemblies/Fragment";

/**
 * A cursor targeting a position in the concatenation of all
 * {@link TextFragment} in the {@link IFragmentAssembly} indicated
 * as the `origin`.
 */
export interface FullTextCursor {
  readonly type: "fullText";
  readonly origin: IFragmentAssembly;
  readonly offset: number;
}

/** Creates a full-text cursor. */
const fullText = (origin: IFragmentAssembly, offset: number): FullTextCursor =>
  Object.freeze({ type: "fullText", origin, offset });

export default fullText;