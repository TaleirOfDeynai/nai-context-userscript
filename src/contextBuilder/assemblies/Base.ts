import { usModule } from "@utils/usModule";
import $ManipOps from "./manipOps";
import $QueryOps from "./queryOps";

import type { UndefOr } from "@utils/utility-types";
import type { TextFragment } from "../TextSplitterService";
import type { IFragmentAssembly } from "./_interfaces";
import type { ISafeAssembly } from "./manipOps";
import type { AssemblyStats } from "./sequenceOps";

const theModule = usModule((require, exports) => {
  const manipOps = $ManipOps(require);
  const queryOps = $QueryOps(require);

  /**
   * A class fitting {@link IFragmentAssembly} that provides caching
   * for certain, expensive to calculate properties.
   * 
   * It essentially acts as a wrapper around a plain-object assembly.
   */
  class BaseAssembly implements IFragmentAssembly, Iterable<TextFragment> {
    constructor(
      wrapped: IFragmentAssembly,
      isContiguous: boolean
    ) {
      // A couple of things: if we were given a `BaseAssembly`, we'll
      // just reuse its wrapped instance.  Otherwise, we need to safe it.
      this.#wrapped
        = wrapped instanceof BaseAssembly ? wrapped.#wrapped
        : manipOps.makeSafe(wrapped);

      this.#isContiguous = isContiguous;
    }

    readonly #wrapped: ISafeAssembly;

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

    /** The concatenated text of the assembly's `content`. */
    get contentText(): string {
      return this.#contentText ??= queryOps.getContentText(this, true);
    }
    #contentText: UndefOr<string> = undefined;

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
    BaseAssembly
  });
});

export default theModule;

// Perform some TypeScript sorcery to get the class' instance type.
namespace Sorcery {
  type TheModule = ReturnType<typeof theModule>;
  type BaseAssemblyCtor = TheModule["BaseAssembly"];
  export type BaseAssembly = InstanceType<BaseAssemblyCtor>;
}

export type BaseAssembly = Sorcery.BaseAssembly;