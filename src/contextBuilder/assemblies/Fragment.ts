import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { assert } from "@utils/assert";
import { toImmutable } from "@utils/iterables";
import $TextSplitterService from "../TextSplitterService";
import $SequenceOps from "./sequenceOps";
import $QueryOps from "./queryOps";

import type { UndefOr } from "@utils/utility-types";
import type { TextFragment } from "../TextSplitterService";
import type { AssemblyStats } from "./sequenceOps";

export interface IFragmentAssembly extends Iterable<TextFragment> {
  prefix: TextFragment;
  content: Iterable<TextFragment>;
  suffix: TextFragment;

  readonly text: string;
  readonly stats: AssemblyStats;
  readonly contentStats: AssemblyStats;
  readonly source: IFragmentAssembly;
}

const theModule = usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const sequenceOps = $SequenceOps(require);
  const queryOps = $QueryOps(require);

  class FragmentAssembly implements IFragmentAssembly {
    constructor(
      prefix: TextFragment,
      content: Iterable<TextFragment>,
      suffix: TextFragment,
      isContiguous: boolean,
      source: FragmentAssembly | null
    ) {
      assert(
        "Expected `source` to be a source assembly.",
        !source || source.isSource
      );

      // We make assumptions that the prefix fragment is always at position 0.
      // The static factories will always do this, but just in case...
      assert(
        "Expected prefix's offset to be 0.",
        prefix.offset === 0
      );

      this.#prefix = prefix;
      this.#content = toImmutable(content);
      this.#suffix = suffix;

      this.#source = source;
      this.#isAffixed = Boolean(prefix.content || suffix.content);
      this.#isContiguous = isContiguous;

      if (usConfig.debugLogging || usConfig.inTestEnv) {
        // Because I'm tired of coding around this possibility.
        // Note: this does allow `content` to be empty, but if it contains
        // fragments, they must all be non-empty.
        assert(
          "Expected content to contain only non-empty fragments.",
          this.#content.every((f) => Boolean(f.content))
        );
      }
    }

    /** The prefix fragment. */
    get prefix() { return this.#prefix; }
    readonly #prefix: TextFragment;

    /** The content fragments. */
    get content() { return this.#content; }
    readonly #content: readonly TextFragment[];

    /** The suffix fragment. */
    get suffix() { return this.#suffix; }
    readonly #suffix: TextFragment;

    /** The full, concatenated text of the assembly. */
    get text(): string {
      return this.#text ??= [
        this.#prefix,
        ...this.#content,
        this.#suffix
      ].map(ss.asContent).join("");
    }
    #text: UndefOr<string> = undefined;

    /** The stats for this assembly. */
    get stats(): AssemblyStats {
      return this.#assemblyStats ??= dew(() => {
        // If we're un-affixed, we can reuse the content stats.
        if (!this.#isAffixed) return this.contentStats;
        return sequenceOps.getStats(Array.from(this));
      });
    }
    #assemblyStats: UndefOr<AssemblyStats> = undefined;

    /**
     * The stats for only the {@link FragmentAssembly.content content} portion of
     * the assembly.
     */
    get contentStats(): AssemblyStats {
      return this.#contentStats ??= sequenceOps.getStats(
        this.#content,
        ss.afterFragment(this.source.prefix)
      );
    }
    #contentStats: UndefOr<AssemblyStats> = undefined;

    /**
     * The source of this assembly.  If `isSource` is `true`, this
     * will return itself, so this will always get a source fragment.
     */
    get source(): IFragmentAssembly {
      return this.#source ?? this;
    }
    readonly #source: IFragmentAssembly | null;

    /** Whether this assembly was generated directly from a source text. */
    get isSource(): boolean {
      return !this.#source;
    }

    /** Whether either `prefix` and `suffix` are non-empty. */
    get isAffixed() {
      return this.#isAffixed;
    }
    readonly #isAffixed: boolean;

    /** Whether `content` is contiguous. */
    get isContiguous() {
      return this.#isContiguous;
    }
    readonly #isContiguous: boolean;

    /** Whether this assembly is entirely empty or not. */
    get isEmpty() {
      return !this.#isAffixed && !this.#content.length;
    }

    /**
     * Iterator that yields all fragments that are not empty.  This can
     * include both the {@link FragmentAssembly.prefix prefix} and the
     * {@link FragmentAssembly.suffix suffix}.
     */
    [Symbol.iterator](): Iterator<TextFragment> {
      return queryOps.iterateOn(this);
    }
  }

  return Object.assign(exports, {
    FragmentAssembly
  });
});

export default theModule;
export type FragmentAssembly = InstanceType<ReturnType<typeof theModule>["FragmentAssembly"]>;