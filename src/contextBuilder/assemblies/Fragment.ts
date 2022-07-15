import { usModule } from "@utils/usModule";
import $ManipOps from "./manipOps";
import $QueryOps from "./queryOps";

import type { UndefOr } from "@utils/utility-types";
import type { TextFragment } from "../TextSplitterService";
import type { AssemblyStats } from "./sequenceOps";
import type { ISafeAssembly } from "./manipOps";

// For JSDoc links...
import type { Cursor } from "../cursors";

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
   * The source of the assembly.
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

const theModule = usModule((require, exports) => {
  const manipOps = $ManipOps(require);
  const queryOps = $QueryOps(require);

  /**
   * An abstraction that standardizes how text is assembled with prefixes
   * and suffixes taken into account.
   * 
   * It aids searching by ensuring that a {@link Cursor.Any} for some source
   * text will retain consistent offsets as it travels through various parts
   * of the program.
   * 
   * These are also used for trimming and filtering, as the `content` can
   * be any number of fragments, even if non-contiguous or out-of-order.
   * 
   * Finally, they can be split at specific offsets using a
   * {@link Cursor.Fragment}, which is handy for assembly.
   */
  class FragmentAssembly implements IFragmentAssembly, Iterable<TextFragment> {
    constructor(
      wrapped: IFragmentAssembly,
      isContiguous: boolean
    ) {
      // A couple of things: if we were given a `FragmentAssembly`, we'll
      // just reuse its wrapped instance.  Otherwise, we need to safe it.
      this.#wrapped
        = wrapped instanceof FragmentAssembly ? wrapped.#wrapped
        : manipOps.makeSafe(wrapped);

      this.#isContiguous = isContiguous;
    }

    #wrapped: ISafeAssembly;

    /** The prefix fragment. */
    get prefix() { return this.#wrapped.prefix; }

    /** The content fragments. */
    get content() { return this.#wrapped.content; }

    /** The suffix fragment. */
    get suffix() { return this.#wrapped.suffix; }

    /** The full, concatenated text of the assembly. */
    get text(): string {
      return this.#text ??= queryOps.getText(this, true);
    }
    #text: UndefOr<string> = undefined;

    /** The stats for this assembly. */
    get stats(): AssemblyStats {
      return this.#assemblyStats ??= queryOps.getStats(this, true);
    }
    #assemblyStats: UndefOr<AssemblyStats> = undefined;

    /** The stats for only the {@link content} portion of the assembly. */
    get contentStats(): AssemblyStats {
      return this.#contentStats ??= queryOps.getContentStats(this, true);
    }
    #contentStats: UndefOr<AssemblyStats> = undefined;

    /**
     * The source of this assembly.  If `isSource` is `true`, this
     * will return itself, so this will always get a source assembly.
     */
    get source(): IFragmentAssembly {
      const source = queryOps.getSource(this.#wrapped);
      return source === this.#wrapped ? this : source;
    }

    /** Whether this assembly was generated directly from a source text. */
    get isSource(): boolean {
      return this.source === this;
    }

    /** Whether either `prefix` and `suffix` are non-empty. */
    get isAffixed() {
      return queryOps.isAffixed(this.#wrapped);
    }

    /** Whether `content` is contiguous. */
    get isContiguous() {
      return this.#isContiguous;
    }
    readonly #isContiguous: boolean;

    /** Whether this assembly is entirely empty or not. */
    get isEmpty() {
      return !this.isAffixed && !this.content.length;
    }

    /**
     * Iterator that yields all fragments that are not empty.  This can
     * include both the {@link prefix} and the {@link suffix}.
     */
    [Symbol.iterator](): Iterator<TextFragment> {
      return queryOps.iterateOn(this.#wrapped);
    }
  }

  return Object.assign(exports, {
    FragmentAssembly
  });
});

export default theModule;
export type FragmentAssembly = InstanceType<ReturnType<typeof theModule>["FragmentAssembly"]>;