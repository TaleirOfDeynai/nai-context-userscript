import type { TextFragment } from "../TextSplitterService";
import type { Tokens } from "../TokenizerService";
import type { AssemblyStats } from "./sequenceOps";

// For JSDoc links...
import type { Cursor } from "../cursors";

/**
 * An abstraction that standardizes how text is assembled with prefixes
 * and suffixes taken into account.  They are essentially a collection
 * of {@link TextFragment} and a {@link Cursor.Fragment} for one of its
 * fragments will work even as it is trimmed and split up.
 * 
 * Objects that fit this interface can make use of the various operators
 * to query and manipulate them.  
 */
export interface IFragmentAssembly {
  /**
   * The prefix fragment.
   * 
   * May be an empty fragment.
   */
  prefix: TextFragment;
  /**
   * The content fragments.
   * 
   * May be an empty iterable, but should not contain fragments
   * with empty content (the operators are not designed for that).
   */
  content: Iterable<TextFragment>;
  /**
   * The suffix fragment.
   * 
   * May be an empty fragment.
   */
  suffix: TextFragment;
  /**
   * The source of the assembly.  This is the original assembly
   * from which its `content` fragments came from.
   * 
   * By convention, if this property returns this assembly, the
   * assembly is considered to be the source of its own content.
   * 
   * When nullish, it is treated as its own source by default.
   */
  readonly source?: IFragmentAssembly;

  // These properties may be set for caching purposes.

  /** The full, concatenated text of the assembly. */
  readonly text?: string;
  /** The stats for this assembly. */
  readonly stats?: AssemblyStats;
  /** The stats for only the {@link content} portion of the assembly. */
  readonly contentStats?: AssemblyStats;
  /** Whether `content` is contiguous. */
  readonly isContiguous?: boolean;
}

export interface ITokenizedAssembly extends IFragmentAssembly {
  tokens: Tokens;
}