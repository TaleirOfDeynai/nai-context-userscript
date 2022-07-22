import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { assert } from "@utils/assert";
import { chain, toImmutable, mapIter } from "@utils/iterables";
import $TextSplitterService from "../TextSplitterService";
import $CursorOps from "./cursorOps";
import $ManipOps from "./manipOps";
import $QueryOps from "./queryOps";
import $BaseAssembly from "./Base";

import type { UndefOr } from "@utils/utility-types";
import type { ContextConfig } from "@nai/Lorebook";
import type { TextFragment, TextOrFragment } from "../TextSplitterService";
import type { Cursor } from "../cursors";
import type { IFragmentAssembly } from "./_interfaces";

export interface ContinuityOptions {
  /**
   * When the source content is a collection of fragments, whether to make
   * assumptions on if the fragments are contiguous.
   * 
   * Setting this to `true` can save time when creating a lot of derived
   * assemblies by skipping the iteration to check for continuity in the
   * fragments.
   */
  assumeContinuity?: boolean;
}

export interface MakeAssemblyOptions extends ContinuityOptions {
  prefix?: ContextConfig["prefix"];
  suffix?: ContextConfig["suffix"];
}

const defaultMakeOptions: Required<MakeAssemblyOptions> = {
  prefix: "",
  suffix: "",
  assumeContinuity: false
};

const theModule = usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const cursorOps = $CursorOps(require);
  const manipOps = $ManipOps(require);
  const queryOps = $QueryOps(require);
  const { BaseAssembly } = $BaseAssembly(require);

  /**
   * A class fitting {@link IFragmentAssembly} that provides caching facilities
   * and convenient access to the limited set of operators used for context
   * content sourcing.
   * 
   * It essentially acts as a wrapper around a plain-object assembly.
   */
  class FragmentAssembly extends BaseAssembly {
    constructor(
      wrapped: IFragmentAssembly,
      isContiguous: boolean
    ) {
      super(wrapped, isContiguous);
    }

    /** Bound version of {@link queryOps.checkRelated}. */
    isRelatedTo(other: IFragmentAssembly): boolean {
      return queryOps.checkRelated(this, other);
    }

    /** Bound version of {@link cursorOps.isFoundIn}. */
    isFoundIn(cursor: Cursor.Fragment): boolean {
      return cursorOps.isFoundIn(this, cursor);
    }

    /** Bound version of {@link cursorOps.findBest}. */
    findBest(cursor: Cursor.Fragment): Cursor.Fragment {
      return cursorOps.findBest(this, cursor);
    }

    /** Bound version of {@link manipOps.splitAt}. */
    splitAt(
      /** The cursor demarking the position of the cut. */
      cursor: Cursor.Fragment
    ): UndefOr<[FragmentAssembly, FragmentAssembly]> {
      return manipOps.splitAt(this, cursor)?.assemblies.map((a) => {
        return new FragmentAssembly(a, this.isContiguous);
      }) as [FragmentAssembly, FragmentAssembly];
    }

    /** Bound version of {@link manipOps.removeAffix}. */
    asOnlyContent(): FragmentAssembly {
      const result = manipOps.removeAffix(this);

      // If we're already only-content, `removeAffix` will return its input.
      if (result === this) return this;

      return new FragmentAssembly(result, this.isContiguous);
    }
  }

  /**
   * Checks if the given `assembly` is a {@link FragmentAssembly}.
   * 
   * Specifically, the class; it may still be an object that fits the
   * interface, but it's not a {@link FragmentAssembly}.
   */
  function isInstance(assembly: unknown): assembly is FragmentAssembly {
    return assembly instanceof FragmentAssembly;
  }

  /**
   * Converts the given assembly into a {@link FragmentAssembly}.
   * 
   * Warning: This will not defragment the contents of the assembly.
   */
  function castTo(assembly: IFragmentAssembly) {
    if (isInstance(assembly)) return assembly;
    return new FragmentAssembly(assembly, queryOps.isContiguous(assembly));
  }

  /**
   * Creates a new source assembly from a single string or {@link TextFragment}.
   */
  function fromSource(sourceText: TextOrFragment, options?: MakeAssemblyOptions) {
    const { prefix, suffix } = { ...defaultMakeOptions, ...options };

    const prefixFragment = ss.createFragment(prefix, 0);

    const sourceFragment = dew(() => {
      let content: string;
      let offset = ss.afterFragment(prefixFragment);
      if (typeof sourceText === "string") content = sourceText;
      else {
        content = sourceText.content;
        offset += sourceText.offset;
      }
      
      if (!content) return undefined;
      return ss.createFragment(content, offset);
    });

    const suffixOffset = ss.afterFragment(sourceFragment ?? prefixFragment);
    const suffixFragment = ss.createFragment(suffix, suffixOffset);

    const rawAssembly = {
      prefix: prefixFragment,
      content: toImmutable(sourceFragment ? [sourceFragment] : []),
      suffix: suffixFragment,
    };

    // Can only be contiguous.
    return new FragmentAssembly(rawAssembly, true);
  }

  /**
   * Creates a new source assembly from a collection of {@link TextFragment}.
   */
  function fromFragments(sourceFrags: Iterable<TextFragment>, options?: MakeAssemblyOptions) {
    const { prefix, suffix, assumeContinuity } = { ...defaultMakeOptions, ...options };

    const adjustedFrags = chain(sourceFrags)
      .filter((f) => Boolean(f.content))
      .thru((frags) => {
        if (!prefix) return frags;
        return mapIter(
          frags,
          (f) => ss.createFragment(f.content, prefix.length + f.offset)
        );
      })
      .thru(ss.defragment)
      .value(toImmutable);

    const maxOffset = chain(adjustedFrags)
      .map(ss.afterFragment)
      .reduce(0, Math.max);

    const rawAssembly = {
      prefix: ss.createFragment(prefix, 0),
      content: adjustedFrags,
      suffix: ss.createFragment(suffix, maxOffset),
    };

    return new FragmentAssembly(
      rawAssembly,
      assumeContinuity ? true : ss.isContiguous(adjustedFrags)
    );
  }

  /**
   * Creates a new assembly derived from the given `originAssembly`.  The given
   * `fragments` should have originated from the origin assembly's
   * {@link IFragmentAssembly.content content}.
   * 
   * If `fragments` contains the origin's `prefix` and `suffix`, they are
   * filtered out automatically.  This is because `FragmentAssembly` is itself
   * an `Iterable<TextFragment>` and sometimes you just wanna apply a simple
   * transformation on its fragments, like a filter.
   */
  function fromDerived(
    /** The fragments making up the derivative's content. */
    fragments: Iterable<TextFragment>,
    /**
     * The assembly whose fragments were used to make the given fragments.
     * This assembly does not need to be a source assembly.
     */
    originAssembly: IFragmentAssembly,
    /**
     * Whether to make assumptions on if the fragments are contiguous.
     * 
     * Setting this to `true` can save time when creating a lot of derived
     * assemblies by skipping the iteration to check for continuity in the
     * fragments.
     */
    options?: ContinuityOptions
  ) {
    // Fast path: the underlying data of `FragmentAssembly` is immutable, so if
    // we're given one, just spit it right back out.
    if (isInstance(fragments)) {
      // But make sure we're still internally consistent.
      assert(
        "Expected the assembly to be related to `originAssembly`.",
        queryOps.checkRelated(fragments, originAssembly)
      );
      return fragments;
    }

    // Make sure we actually have the source assembly.
    const source = queryOps.getSource(originAssembly);
    // Use the given instance's prefix and suffix, though.  It may now
    // differ from the source due to splitting and the like.
    const { prefix, suffix } = originAssembly;

    const localFrags = chain(fragments)
      // Make sure the prefix and suffix fragments are not included.
      .filter((v) => v !== prefix && v !== suffix)
      // And defragment them.
      .thru(ss.defragment)
      .value(toImmutable);

    const assumeContinuity = options?.assumeContinuity ?? false;

    const assembly = new FragmentAssembly(
      { prefix, content: localFrags, suffix, source },
      // We'll assume the derived assembly has the same continuity as
      // its origin assembly.
      assumeContinuity ? queryOps.isContiguous(originAssembly) : ss.isContiguous(localFrags)
    );

    // Also sanity check the content if thorough logging is enabled.
    if (usConfig.debugLogging || usConfig.inTestEnv) {
      const oldStats = queryOps.getContentStats(source);
      const newStats = assembly.contentStats;
      assert(
        "Expected minimum offset to be in range of source.",
        newStats.minOffset >= oldStats.minOffset
      );
      assert(
        "Expected maximum offset to be in range of source.",
        newStats.maxOffset <= oldStats.maxOffset
      );
    }

    return assembly;
  }

  return Object.assign(exports, {
    isInstance,
    castTo,
    fromSource,
    fromFragments,
    fromDerived
  });
});

export default theModule;

// Perform some TypeScript sorcery to get the class' instance type.
namespace Sorcery {
  type TheModule = ReturnType<typeof theModule>;
  type CastToFn = TheModule["castTo"];
  export type FragmentAssembly = ReturnType<CastToFn>;
}

export type FragmentAssembly = Sorcery.FragmentAssembly;