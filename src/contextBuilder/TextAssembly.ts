import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { isArray } from "@utils/is";
import { assert, assertExists } from "@utils/assert";
import { chain, ElementOf, first, ReduceFn, toImmutable } from "@utils/iterables";
import config from "../config";
import TextSplitterService, { TextOrFragment } from "./TextSplitterService";

import type { UndefOr } from "@utils/utility-types";
import type { ContextConfig } from "@nai/Lorebook";
import type { TextFragment } from "./TextSplitterService";

export interface TextAssemblyOptions {
  prefix?: ContextConfig["prefix"];
  suffix?: ContextConfig["suffix"];
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

export interface AssemblyStats {
  /** The minimum possible offset of all fragments. */
  minOffset: number;
  /** The maximum possible offset of all fragments. */
  maxOffset: number;
  /** The length implied by `maxOffset - minOffset`. */
  impliedLength: number;
  /** The actual count of characters in all the provided fragments. */
  concatLength: number;
}

export interface AssemblyCursor {
  readonly type: "assembly";
  readonly origin: TextAssembly;
  readonly offset: number;
}

export interface FullTextCursor {
  readonly type: "fullText";
  readonly origin: TextAssembly;
  readonly offset: number;
}

export type TextCursor = AssemblyCursor | FullTextCursor;

export type TextSelection
  = [AssemblyCursor, AssemblyCursor]
  | [FullTextCursor, FullTextCursor];

export type CursorPosition = "prefix" | "content" | "suffix" | "unrelated";

const defaultOptions: Required<TextAssemblyOptions> = {
  prefix: "",
  suffix: "",
  assumeContinuity: false
};

const theModule = usModule((require, exports) => {
  const { createFragment, asContent, splitFragmentAt } = TextSplitterService(require);

  /** Creates a full-text cursor. */
  function makeCursor(origin: TextAssembly, offset: number, type: "fullText"): FullTextCursor;
  /** Creates a cursor referencing a fragment in an assembly. */
  function makeCursor(origin: TextAssembly, offset: number, type?: "assembly"): AssemblyCursor;
  /** Creates a cursor of the given type. */
  function makeCursor(origin: TextAssembly, offset: number, type: TextCursor["type"]): TextCursor;
  function makeCursor(origin: TextAssembly, offset: number, type: TextCursor["type"] = "assembly") {
    return Object.freeze({ type, origin, offset });
  }

  /**
   * Checks if a given cursor's offset appears to be inside a given
   * fragment.
   * 
   * As fragments do not have information on their origin assembly,
   * it does not check to make sure the cursor is actually for the
   * fragment.  Use {@link TextAssembly.positionOf} to interrogate
   * the assembly the fragment came from for that.
   */
  const isCursorInside = (cursor: TextCursor, fragment: TextFragment) => {
    const { offset } = cursor;
    if (offset < fragment.offset) return false;
    if (offset > fragment.offset + fragment.content.length) return false;
    return true;
  };

  /**
   * Checks if the given collection of fragments is contiguous; this means
   * the collection has no gaps and all fragments are not out-of-order.
   * 
   * Returns `false` if `fragments` was empty.
   */
  const isContiguous = (fragments: Iterable<TextFragment>): boolean => {
    let lastFrag: UndefOr<TextFragment> = undefined;
    for (const curFrag of fragments) {
      if (lastFrag) {
        const expectedOffset = lastFrag.offset + lastFrag.content.length;
        if (curFrag.offset !== expectedOffset) return false;
      }
      lastFrag = curFrag;
    }
    // Return `false` if `fragments` was empty.
    return Boolean(lastFrag);
  };

  /** Produces some useful stats given a collection of fragments. */
  const getStats = (fragments: Iterable<TextFragment>): AssemblyStats => {
    // We'll be iterating multiple times, so make sure we have an
    // iterable that can be iterated multiple times.
    const localFrags = isArray(fragments) ? fragments : [...fragments];

    const maxOffset = chain(localFrags)
      .map(({ content, offset }) => content.length + offset)
      .reduce(0, Math.max);
    const minOffset = chain(localFrags)
      .map(({ offset }) => offset)
      .reduce(maxOffset, Math.min);
    
    return {
      minOffset, maxOffset,
      impliedLength: maxOffset - minOffset,
      concatLength: localFrags.reduce((p, v) => p + v.content.length, 0)
    };
  };

  type OffsetResult = [offset: number, distance: number];

  /**
   * Just a helper for {@link TextAssembly.findBest}.
   * 
   * This can probably emit multiple identical tuples, but we're okay with that.
   */
  function *iterBounds(
    frags: Iterable<TextFragment>,
    needle: number
  ): Iterable<OffsetResult> {
    for (const frag of frags) {
      const left = frag.offset;
      yield [left, Math.abs(needle - left)];

      // If this fragment is empty, we can only get one offset from it.
      if (!frag.content) continue;

      const right = frag.offset + frag.content.length;
      yield [right, Math.abs(needle - right)];
    }
  }

  /** A reducer function for {@link TextAssembly.findBest}. */
  const offsetReducer: ReduceFn<OffsetResult, OffsetResult, undefined> = (p, c) => {
    if (!p) return c;
    if (c[1] <= p[1]) return c;
    return p;
  };

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
  class TextAssembly implements Iterable<TextFragment> {
    constructor(
      prefix: TextFragment,
      content: Iterable<TextFragment>,
      suffix: TextFragment,
      isContiguous: boolean,
      source: TextAssembly | null
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
      this.#isAffixed = Boolean(prefix.content.length + suffix.content.length);
      this.#isContiguous = isContiguous;
    }

    /**
     * Creates a new source assembly from a single string or {@link TextFragment}.
     */
    static fromSource(sourceText: TextOrFragment, options?: TextAssemblyOptions) {
      const { prefix, suffix } = { ...defaultOptions, ...options };
      const sourceFragment = dew(() => {
        if (typeof sourceText === "string")
          return createFragment(sourceText, prefix.length);
        
        const { content, offset } = sourceText;
        return createFragment(content, offset + prefix.length);
      });

      return new TextAssembly(
        createFragment(prefix, 0),
        toImmutable([sourceFragment]),
        createFragment(suffix, prefix.length + sourceFragment.content.length),
        true, // Can only be contiguous.
        null
      );
    }

    /**
     * Creates a new source assembly from a collection of {@link TextFragment}.
     */
    static fromFragments(sourceFrags: Iterable<TextFragment>, options?: TextAssemblyOptions) {
      const { prefix, suffix, assumeContinuity } = { ...defaultOptions, ...options };

      const adjustedFrags
        = !prefix ? toImmutable(sourceFrags)
        : chain(sourceFrags)
            .map(({ content, offset }) => createFragment(content, prefix.length + offset))
            .value(toImmutable);

      const maxOffset = chain(adjustedFrags)
        .map(({ content, offset }) => content.length + offset)
        .reduce(0, Math.max);

      return new TextAssembly(
        createFragment(prefix, 0),
        adjustedFrags,
        createFragment(suffix, maxOffset),
        assumeContinuity ? true : isContiguous(adjustedFrags),
        null
      );
    }

    /**
     * Creates a new assembly derived from the given `originAssembly`.  The given
     * `fragments` should have originated from the origin assembly's
     * {@link TextAssembly.content content}.
     * 
     * If `fragments` contains the origin's `prefix` and `suffix`, they are
     * filtered out automatically.  This is because `TextAssembly` is itself an
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
      originAssembly: TextAssembly,
      /**
       * Whether to make assumptions on if the fragments are contiguous.
       * 
       * Setting this to `true` can save time when creating a lot of derived
       * assemblies by skipping the iteration to check for continuity in the
       * fragments.
       */
      assumeContinuity: boolean = false
    ) {
      // Fast path: the underlying data of `TextAssembly` is immutable, so if
      // we're given one, just spit it right back out.
      if (fragments instanceof TextAssembly) {
        // But make sure we're still internally consistent.
        assert(
          "Expected the assembly to be related to `originAssembly`.",
          TextAssembly.checkRelated(fragments, originAssembly)
        );
        return fragments;
      }

      // Make sure we actually have the source assembly.
      const { source } = originAssembly;
      const { prefix, suffix } = source;

      const localFrags = chain(fragments)
        // Just make sure the prefix and suffix fragments are not included.
        .filter((v) => v !== prefix && v !== suffix)
        .value(toImmutable);

      const assembly = new TextAssembly(
        prefix, localFrags, suffix,
        // We'll assume the derived assembly has the same continuity as
        // its origin assembly.
        assumeContinuity ? originAssembly.#isContiguous : isContiguous(localFrags),
        source
      );

      // Also sanity check the content if debug logging is enabled.
      if (config.debugLogging) {
        const oldStats = source.contentStats;
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

    /** Checks if two assemblies have the same source, and thus, comparable content. */
    static checkRelated(a: TextAssembly, b: TextAssembly): boolean {
      return a.source === b.source;
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
    get fullText(): string {
      return this.#fullText ??= [
        this.#prefix,
        ...this.#content,
        this.#suffix
      ].map(asContent).join("");
    }
    #fullText: UndefOr<string> = undefined;

    /** The stats for this assembly. */
    get stats(): AssemblyStats {
      return this.#assemblyStats ??= getStats(this);
    }
    #assemblyStats: UndefOr<AssemblyStats> = undefined;

    /**
     * The stats for only the {@link TextAssembly.content content} portion of
     * the assembly.
     */
    get contentStats(): AssemblyStats {
      return this.#contentStats ??= getStats(this.#content);
    }
    #contentStats: UndefOr<AssemblyStats> = undefined;

    /**
     * The source of this text assembly.  If `isSource` is `true`, this
     * will return itself, so this will always get a source fragment.
     */
    get source(): TextAssembly {
      return this.#source ?? this;
    }
    readonly #source: TextAssembly | null;

    /** Whether this assembly was generated directly from a source text. */
    get isSource(): boolean {
      return !this.#source;
    }

    /** Whether either `prefix` and `suffix` are non-empty. */
    readonly #isAffixed: boolean;
    /** Whether `content` is contiguous. */
    readonly #isContiguous: boolean;

    /**
     * Iterator that yields all fragments that are not empty.  This can
     * include both the {@link TextAssembly.prefix prefix} and the
     * {@link TextAssembly.suffix suffix}.
     */
    *[Symbol.iterator](): Iterator<TextFragment> {
      const { prefix, content, suffix } = this;
      if (prefix.content) yield prefix;
      for (const value of content) if (value.content) yield value;
      if (suffix.content) yield suffix;
    }

    /**
     * Given a cursor that is addressing this instance's `fullText`,
     * re-maps that cursor into one addressing the `prefix`, `content`,
     * or `suffix` of the assembly instead.
     * 
     * When the cursor falls on the boundary between two blocks, it will
     * prefer the first non-empty block found, searching in this order:
     * - content
     * - prefix
     * - suffix
     */
    fromFullText(cursor: FullTextCursor): AssemblyCursor {
      assert(
        "Expected a full-text cursor.",
        cursor.type === "fullText"
      );
      assert(
        "Expected cursor to be for this assembly.",
        cursor.origin === this
      );
      assert(
        "Expected cursor offset to be in bounds of `fullText`.",
        cursor.offset >= 0 && cursor.offset <= this.fullText.length
      );
      
      const { prefix, content, suffix } = this;
      const { content: prefixContent } = prefix;
      const initOffset = first(content)?.offset ?? prefixContent.length;

      // Fast-path: We can just map straight to `content`.
      if (!this.#isAffixed && this.#isContiguous)
        return makeCursor(this, cursor.offset + initOffset);
      
      // When the cursor is within the prefix.
      if (cursor.offset < prefixContent.length)
        return makeCursor(this, cursor.offset);

      const suffixThreshold = prefixContent.length + this.contentStats.concatLength;

      // When the cursor is within the suffix.
      if (cursor.offset > suffixThreshold)
        return makeCursor(this, (cursor.offset - suffixThreshold) + suffix.offset);

      // Exceptional circumstances; this function is setup to favor the
      // content, but if content is empty and the cursor is between the
      // prefix and suffix (the only possibility left, assuming this cursor
      // actually is for this instance's `fullText`), we must favor one
      // of those instead.
      if (content.length === 0) {
        if (prefixContent) return makeCursor(this, prefixContent.length);
        if (suffix.content) return makeCursor(this, suffix.offset);
      }

      // Bring the cursor to the start of the content fragments.
      let cursorOffset = (cursor.offset - prefixContent.length) + initOffset;

      // Fast-path: For contiguous content, we can map the cursor directly
      // to the content, now that the prefix was accounted for.
      if (this.#isContiguous) return makeCursor(this, cursorOffset);
      
      // Otherwise, we have to iterate to account for the gaps in content.
      let lastFrag: UndefOr<TextFragment> = undefined;
      for (const curFrag of content) {
        if (lastFrag) {
          const expectedOffset = lastFrag.offset + lastFrag.content.length;
          // Shift the cursor based on how far off we are from the expected.
          cursorOffset += curFrag.offset - expectedOffset;
        }

        const rightLimits = curFrag.offset + curFrag.content.length;
        if (cursorOffset >= curFrag.offset && cursorOffset < rightLimits)
          return makeCursor(this, cursorOffset);

        lastFrag = curFrag;
      }

      // This is being used as a bit of a fail-safe; just place the cursor
      // at the end of the last content fragment (or 0 if we somehow don't
      // have a last fragment).
      return makeCursor(this, (lastFrag?.offset ?? 0) + (lastFrag?.content.length ?? 0));
    }

    /**
     * Checks to ensure that the cursor references a valid text fragment;
     * that is, the fragment of this cursor is not missing.
     * 
     * When `cursor` originated from another {@link TextAssembly} that was
     * created from the same source text, this can be used to validate that
     * the fragment the cursor is trying to target is still in this instance's
     * `content` array.
     */
    isFoundIn(cursor: AssemblyCursor): boolean {
      assert(
        "Expected an assembly cursor.",
        cursor.type === "assembly"
      );
      assert(
        "Expected cursor to be related to this assembly.",
        this.isRelatedTo(cursor.origin)
      );

      for (const frag of this)
        if (isCursorInside(cursor, frag))
          return true;

      return false;
    }

    /**
     * Checks to ensure that the cursor references a valid text fragment;
     * that is, the fragment of this cursor is not missing.
     * 
     * If the fragment is missing, it will reposition the cursor to the
     * nearest existing fragment.
     * 
     * If the assembly is empty (all fragments have length-zero content),
     * it will reposition it to the nearest prefix or suffix offset.
     * 
     * When `cursor` originated from a related {@link TextAssembly}, this
     * can be used to adapt the cursor to a reasonable position that does
     * exist.
     */
    findBest(cursor: AssemblyCursor): AssemblyCursor {
      // This also does the various assertions, so no need to repeat those.
      if (this.isFoundIn(cursor)) return cursor;

      // Seems to be missing.  Let's see about finding the next best offset.
      // That will be one end of some existing fragment with the minimum
      // distance from the cursor's offset and the fragment's end.

      const offsetsIterator = iterBounds(this, cursor.offset);

      if (this.#isContiguous) {
        // Fast-path: for contiguous assemblies, we can stop as soon as the
        // distance stops getting smaller.
        let lastResult: UndefOr<OffsetResult> = undefined;
        for (const curResult of offsetsIterator) {
          const next = offsetReducer(lastResult, curResult);
          // We hit the minimum if we get the `lastResult` back.
          if (next === lastResult) return makeCursor(this, next[0]);
          lastResult = next;
        }
      }
      else {
        // For non-contiguous assemblies, we'll have to run through every
        // fragment to find the minimum difference.
        const result = chain(offsetsIterator).reduce(undefined, offsetReducer);
        if (result) return makeCursor(this, result[0]);
      }

      // If we get here, this assembly was probably empty, which can happen
      // and is perfectly valid.  We can fall back to anchoring to the
      // boundaries of each significant block instead, defined completely by
      // the prefix and suffix.  This is one of the reasons why we're habitually
      // generating these, even if they're empty.
      const { prefix, suffix } = this.source;
      const [newOffset] = assertExists(
        "Expected to have boundaries from prefix and suffix.",
        chain(iterBounds([prefix, suffix], cursor.offset))
          .reduce(undefined, offsetReducer)
      );
      return makeCursor(this, newOffset);
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
      cursor: AssemblyCursor,
      /**
       * If `true` and no fragment exists in the assembly for the position,
       * the next best position will be used instead as a fallback.
       */
      loose: boolean = false
    ): UndefOr<[TextAssembly, TextAssembly]> {
      if (this.positionOf(cursor) !== "content") return undefined;

      if (!this.isFoundIn(cursor)) {
        if (!loose) return undefined;
        cursor = this.findBest(cursor);
      }

      const beforeCut: TextFragment[] = [];
      const afterCut: TextFragment[] = [];
      let curBucket = beforeCut;
      for (const frag of this.content) {
        if (!isCursorInside(cursor, frag)) {
          curBucket.push(frag);
          continue;
        }

        // We should only cut once; this assembly is malformed if this fails.
        assert("Expected to not have made a cut yet.", curBucket === beforeCut);

        // This is the fragment of the cut.  Let's figure out how to split
        // the fragment.  We only need to bother if the point is inside the
        // fragment, that is, not at one of its ends.  We're going to the
        // trouble because text fragments are immutable and it'd be nice to
        // preserve referential equality where possible.
        switch (cursor.offset) {
          case frag.offset:
            afterCut.push(frag);
            break;
          case frag.offset + frag.content.length:
            beforeCut.push(frag);
            break;
          default: {
            const [before, after] = splitFragmentAt(frag, cursor.offset);
            beforeCut.push(before);
            afterCut.push(after);
            break;
          }
        }
        // Finally, swap the buckets so we place the remaining fragments in
        // the correct derivative assembly.
        curBucket = afterCut;
      }

      // If we're splitting this assembly, it doesn't make sense to preserve
      // the suffix on the assembly before the cut or the prefix after the cut.
      // Replace them with empty fragments, as needed.
      const { prefix, suffix } = this;
      const afterPrefix = !prefix.content ? prefix : createFragment("", 0, prefix);
      const beforeSuffix = !suffix.content ? suffix : createFragment("", 0, suffix);

      // Because we're changing the prefix and suffix, we're going to invoke
      // the constructor directly instead of using `fromDerived`.
      return [
        new TextAssembly(
          prefix, toImmutable(beforeCut), beforeSuffix,
          this.#isContiguous, this.source
        ),
        new TextAssembly(
          afterPrefix, toImmutable(afterCut), suffix,
          this.#isContiguous, this.source
        )
      ];
    }

    /**
     * Determines what block the given `cursor` belongs to.  If the cursor
     * has a source that differs from this assembly, it will return `"unrelated"`
     * to indicate the cursor is unsuitable for this assembly.
     * 
     * It does not check to see if a fragment exists in this assembly that
     * corresponds to the cursor's position.  Use {@link TextAssembly.isFoundIn}
     * to make that determination.
     */
    positionOf(cursor: AssemblyCursor): CursorPosition {
      assert(
        "Expected an assembly cursor.",
        cursor.type === "assembly"
      );

      // Can't be in this assembly if it is unrelated.
      if (!this.isRelatedTo(cursor.origin)) return "unrelated";

      // If it isn't in the prefix or the suffix, it is in the content.
      // Use the source; splitting will create empty prefix/suffix.
      const { prefix, suffix } = this.source;
      if (isCursorInside(cursor, prefix)) return "prefix";
      if (isCursorInside(cursor, suffix)) return "suffix";
      return "content";
    }

    /**
     * Determines if this assembly and `otherAssembly` share a source.
     * 
     * If they are related, {@link TextCursor text cursors} for one assembly
     * should have meaning to the other.
     */
    isRelatedTo(otherAssembly: TextAssembly) {
      return TextAssembly.checkRelated(this, otherAssembly);
    }
  }

  return Object.assign(exports, {
    isCursorInside,
    isContiguous,
    getStats,
    makeCursor,
    TextAssembly
  });
});

export default theModule;
export type TextAssembly = InstanceType<ReturnType<typeof theModule>["TextAssembly"]>;