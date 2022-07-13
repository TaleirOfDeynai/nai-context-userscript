import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { assert } from "@utils/assert";
import { chain, toImmutable, mapIter } from "@utils/iterables";
import $SequenceOps from "./assemblies/sequenceOps";
import $QueryOps from "./assemblies/queryOps";
import $CursorOps from "./assemblies/cursorOps";
import $TextSplitterService from "./TextSplitterService";
import $FragmentAssembly from "./FragmentAssembly";

import type { UndefOr } from "@utils/utility-types";
import type { ContextConfig } from "@nai/Lorebook";
import type { IFragmentAssembly } from "./assemblies/Fragment";
import type { TextFragment, TextOrFragment } from "./TextSplitterService";
import type { Cursor } from "./cursors";

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
  const { FragmentAssembly } = $FragmentAssembly(require);
  const seqOps = $SequenceOps(require);
  const queryOps = $QueryOps(require);
  const cursorOps = $CursorOps(require);

  /**
   * An abstraction that standardizes how text is assembled with prefixes
   * and suffixes taken into account.
   * 
   * It aids searching by ensuring that a {@link TextCursor} for some source
   * text will retain consistent offsets as it travels through various parts
   * of the program.
   * 
   * These are also used for trimming and filtering, as the `content` can
   * be any number of fragments, even if non-contiguous or out-of-order.
   * 
   * Finally, they can be split at specific offsets using a {@link TextCursor},
   * which is handy for assembly.
   */
  class ContentAssembly extends FragmentAssembly {
    constructor(
      prefix: TextFragment,
      content: Iterable<TextFragment>,
      suffix: TextFragment,
      isContiguous: boolean,
      source: IFragmentAssembly | null
    ) {
      super(prefix, content, suffix, isContiguous, source);
    }

    /**
     * Creates a new source assembly from a single string or {@link TextFragment}.
     */
    static fromSource(sourceText: TextOrFragment, options?: MakeAssemblyOptions) {
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

      return new ContentAssembly(
        prefixFragment,
        toImmutable(sourceFragment ? [sourceFragment] : []),
        suffixFragment,
        true, // Can only be contiguous.
        null
      );
    }

    /**
     * Creates a new source assembly from a collection of {@link TextFragment}.
     */
    static fromFragments(sourceFrags: Iterable<TextFragment>, options?: MakeAssemblyOptions) {
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
        .value(toImmutable);

      const maxOffset = chain(adjustedFrags)
        .map(ss.afterFragment)
        .reduce(0, Math.max);

      return new ContentAssembly(
        ss.createFragment(prefix, 0),
        adjustedFrags,
        ss.createFragment(suffix, maxOffset),
        assumeContinuity ? true : ss.isContiguous(adjustedFrags),
        null
      );
    }

    /**
     * Creates a new assembly derived from the given `originAssembly`.  The given
     * `fragments` should have originated from the origin assembly's
     * {@link FragmentAssembly.content content}.
     * 
     * If `fragments` contains the origin's `prefix` and `suffix`, they are
     * filtered out automatically.  This is because `FragmentAssembly` is itself an
     * `Iterable<TextFragment>` and sometimes you just wanna apply a simple
     * transformation on its fragments, like a filter.
     */
    static fromDerived(
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
      if (fragments instanceof ContentAssembly) {
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
        // Just make sure the prefix and suffix fragments are not included.
        .filter((v) => v !== prefix && v !== suffix)
        .value(toImmutable);

      const assumeContinuity = options?.assumeContinuity ?? false;

      const assembly = new ContentAssembly(
        prefix, localFrags, suffix,
        // We'll assume the derived assembly has the same continuity as
        // its origin assembly.
        assumeContinuity ? queryOps.isContiguous(originAssembly) : ss.isContiguous(localFrags),
        source
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

    /**
     * Given a cursor placed within this assembly's content, splits this
     * assembly into two assemblies.  The result is a tuple where the
     * first element is the text before the cut and the second element
     * is the text after the cut.
     * 
     * The `suffix` of the first assembly and the `prefix` of the second
     * assembly will be empty, and so may differ from their shared source.
     * 
     * If a cut cannot be made, `undefined` is returned.
     */
    splitAt(
      /** The cursor demarking the position of the cut. */
      cursor: Cursor.Fragment,
      /**
       * If `true` and no fragment exists in the assembly for the position,
       * the next best position will be used instead as a fallback.
       */
      loose: boolean = false
    ): UndefOr<[ContentAssembly, ContentAssembly]> {
      const usedCursor = dew(() => {
        // The input cursor must be for the content.
        if (cursorOps.positionOf(this, cursor) !== "content") return undefined;
        if (!loose) return cursorOps.isFoundIn(this, cursor) ? cursor : undefined;
        const bestCursor = cursorOps.findBest(this, cursor, true);
        // Make sure the cursor did not get moved out of the content.
        // This can happen when the content is empty; the only remaining
        // place it could be moved was to a prefix/suffix fragment.
        return cursorOps.positionOf(this, bestCursor) === "content" ? bestCursor : undefined;
      });

      if (!usedCursor) return undefined;

      const [beforeCut, afterCut] = seqOps.splitAt(this.content, usedCursor);

      // If we're splitting this assembly, it doesn't make sense to preserve
      // the suffix on the assembly before the cut or the prefix after the cut.
      // Replace them with empty fragments, as needed.
      const { prefix, suffix } = this;
      const afterPrefix = !prefix.content ? prefix : ss.createFragment("", 0, prefix);
      const beforeSuffix = !suffix.content ? suffix : ss.createFragment("", 0, suffix);

      // Because we're changing the prefix and suffix, we're going to invoke
      // the constructor directly instead of using `fromDerived`.
      return [
        new ContentAssembly(
          prefix, toImmutable(beforeCut), beforeSuffix,
          this.isContiguous, this.source
        ),
        new ContentAssembly(
          afterPrefix, toImmutable(afterCut), suffix,
          this.isContiguous, this.source
        )
      ];
    }

    /**
     * Generates a version of this assembly that has no prefix or suffix.
     * 
     * It still has the same source, so cursors for that source will still
     * work as expected.
     */
    asOnlyContent(): ContentAssembly {
      // No need if we don't have a prefix or suffix.
      if (!queryOps.isAffixed(this)) return this;

      // Replace the suffix and prefix with zero-length fragments.
      const { prefix, suffix } = this;
      return new ContentAssembly(
        !prefix.content ? prefix : ss.createFragment("", 0, prefix),
        this.content,
        !suffix.content ? suffix : ss.createFragment("", 0, suffix),
        this.isContiguous, this.source
      );
    }
  }

  return Object.assign(exports, {
    ContentAssembly
  });
});

export default theModule;
export type ContentAssembly = InstanceType<ReturnType<typeof theModule>["ContentAssembly"]>;