import userScriptConfig from "@config";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { isArray } from "@utils/is";
import { assert, assertExists } from "@utils/assert";
import * as IterOps from "@utils/iterables";
import { chain, toImmutable } from "@utils/iterables";
import $TextSplitterService from "./TextSplitterService";
import $TrimmingProviders from "./TrimmingProviders";

import type { UndefOr } from "@utils/utility-types";
import type { ReduceFn } from "@utils/iterables";
import type { ContextConfig } from "@nai/Lorebook";
import type { TextFragment, TextOrFragment } from "./TextSplitterService";
import type { MatchResult } from "./MatcherService";
import type { TextSequencer, TrimType } from "./TrimmingProviders";

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

export type TextSelection = readonly [AssemblyCursor, AssemblyCursor];

export type CursorPosition = "prefix" | "content" | "suffix" | "unrelated";

export type IterDirection = "toTop" | "toBottom";

namespace Position {
  /** No suitable place found; continue with next fragment. */
  interface ContinueResult {
    type: IterDirection;
    remainder: number;
  }

  /** Split the assembly at `cursor` and insert between them. */
  interface SuccessResult {
    type: "inside";
    cursor: AssemblyCursor;
  }

  /** Insert before/after the assembly. */
  interface InsertResult {
    type: "insertBefore" | "insertAfter";
  }

  export type Result = ContinueResult | SuccessResult | InsertResult;
}

export type PositionResult = Position.Result;

/** If thorough assertions should be run. */
const thoroughChecks = userScriptConfig.debugLogging || userScriptConfig.testLogging;

const defaultOptions: Required<TextAssemblyOptions> = {
  prefix: "",
  suffix: "",
  assumeContinuity: false
};

const theModule = usModule((require, exports) => {
  const splitterService = $TextSplitterService(require);
  const { createFragment, isContiguous, hasWords } = splitterService;
  const { beforeFragment, afterFragment } = splitterService;
  const { getSequencersFrom } = $TrimmingProviders(require);

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
    if (offset < beforeFragment(fragment)) return false;
    if (offset > afterFragment(fragment)) return false;
    return true;
  };

  /** Ensures the given cursor is an {@link AssemblyCursor}. */
  const asAssemblyCursor = (cursor: TextCursor): AssemblyCursor => {
    if (cursor.type === "assembly") return cursor;
    return cursor.origin.fromFullText(cursor);
  };

  /**
   * Converts a {@link MatchResult} to a {@link TextSelection}.
   * 
   * If the match is zero-length, the two cursors will both be
   * identical instances.
   */
  const toSelection = (
    match: MatchResult,
    origin: TextAssembly,
    type: TextCursor["type"]
  ): TextSelection => {
    const { index, length } = match;
    const left = asAssemblyCursor(makeCursor(origin, index, type));
    if (length === 0) return Object.freeze([left, left] as const);

    const right = asAssemblyCursor(makeCursor(origin, index + length, type));
    return Object.freeze([left, right] as const);
  };

  /**
   * Produces some useful stats given a collection of fragments.
   * 
   * This takes an array to force conversion to an iterable type that
   * can definitely be iterated multiple times.
   */
  const getStats = (
    /** The fragments to analyze. */
    fragments: readonly TextFragment[],
    /** When `fragments` is empty, the default offset to use. */
    emptyOffset = 0
  ): AssemblyStats => {
    // The empty offset is only used when `fragments` is empty.
    const initOffset = fragments.length ? 0 : emptyOffset;

    const maxOffset = chain(fragments)
      .map(afterFragment)
      .reduce(initOffset, Math.max);
    const minOffset = chain(fragments)
      .map(beforeFragment)
      .reduce(maxOffset, Math.min);
    
    return {
      minOffset, maxOffset,
      impliedLength: maxOffset - minOffset,
      concatLength: fragments.reduce((p, v) => p + v.content.length, 0)
    };
  };

  type OffsetResult = [offset: number, distance: number];

  /**
   * Just a helper for {@link TextAssembly.findBest}.
   * 
   * This can probably emit multiple identical tuples, but we're okay with that.
   */
  function *_iterBounds(
    frags: Iterable<TextFragment>,
    needle: number
  ): Iterable<OffsetResult> {
    for (const frag of frags) {
      const left = beforeFragment(frag);
      yield [left, Math.abs(needle - left)];

      // If this fragment is empty, we can only get one offset from it.
      if (!frag.content) continue;

      const right = afterFragment(frag);
      yield [right, Math.abs(needle - right)];
    }
  }

  /** A reducer function for {@link TextAssembly.findBest}. */
  const _offsetReducer: ReduceFn<OffsetResult, OffsetResult, undefined> = (p, c) => {
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
      this.#isAffixed = Boolean(prefix.content || suffix.content);
      this.#isContiguous = isContiguous;

      if (thoroughChecks) {
        // Because I'm tired of coding around this possibility.
        // Note: this does allow `content` to be empty, but if it contains
        // fragments, they must all be non-empty.
        assert(
          "Expected content to contain only non-empty fragments.",
          this.#content.every((f) => Boolean(f.content))
        );
      }
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

      const suffixOffset = afterFragment(sourceFragment);

      return new TextAssembly(
        createFragment(prefix, 0),
        toImmutable([sourceFragment]),
        createFragment(suffix, suffixOffset),
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
        .map(afterFragment)
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
      // Use the given instance's prefix and suffix, though.  It may now
      // differ from the source due to splitting and the like.
      const { prefix, suffix } = originAssembly;

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

      // Also sanity check the content if thorough logging is enabled.
      if (thoroughChecks) {
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
      ].map(splitterService.asContent).join("");
    }
    #fullText: UndefOr<string> = undefined;

    /** The stats for this assembly. */
    get stats(): AssemblyStats {
      return this.#assemblyStats ??= dew(() => {
        // If we're un-affixed, we can reuse the content stats.
        if (!this.#isAffixed) return this.contentStats;
        return getStats(Array.from(this));
      });
    }
    #assemblyStats: UndefOr<AssemblyStats> = undefined;

    /**
     * The stats for only the {@link TextAssembly.content content} portion of
     * the assembly.
     */
    get contentStats(): AssemblyStats {
      return this.#contentStats ??= getStats(
        this.#content,
        afterFragment(this.source.prefix)
      );
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
      for (const value of content) yield value;
      if (suffix.content) yield suffix;
    }

    /**
     * Given a cursor that is addressing this instance's `fullText`,
     * re-maps that cursor into one addressing the `prefix`, `content`,
     * or `suffix` of the assembly instead.
     * 
     * When the cursor falls between two fragments, creating an ambiguity
     * in which offset to use, it will use the first rule below that matches
     * the cursor's situation:
     * - Between prefix and suffix fragments:
     *   - When prefix is non-empty, use the end of the prefix fragment.
     *   - When suffix is non-empty, use the start of the suffix fragment.
     *   - When derived, use the end of the **source's** prefix fragment.
     *   - Otherwise, use offset 0 as a fail-safe.
     * - Between prefix and any content fragment, use the content fragment.
     * - Between suffix and any content fragment, use the content fragment.
     * - Between a wordy fragment and a non-wordy fragment, use the wordy fragment.
     * - Otherwise, whichever fragment comes first in natural order.
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
      const prefixLength = prefix.content.length;

      const initOffset = dew(() => {
        // If we have an initial fragment, getting an initial offset
        // is very straight-forward.
        const firstFrag = IterOps.first(content);
        if (firstFrag) return beforeFragment(firstFrag);

        // However, if this assembly has no content, we will still want
        // to produce a stable answer of some sort.  Using the offset
        // after the prefix is a good idea, but since the `prefix` can
        // change due to `splitAt`, we should use the source assembly's
        // prefix instead, since all derived assemblies should have the
        // same value here.
        return afterFragment(this.source.prefix);
      });

      // Fast-path: We can just map straight to `content`.
      if (!this.#isAffixed && this.#isContiguous)
        return makeCursor(this, cursor.offset + initOffset);
      
      // When the cursor is within the prefix.
      if (cursor.offset < prefixLength)
        return makeCursor(this, cursor.offset);

      const suffixThreshold = prefixLength + this.contentStats.concatLength;

      // When the cursor is within the suffix.
      if (cursor.offset > suffixThreshold)
        return makeCursor(this, (cursor.offset - suffixThreshold) + suffix.offset);

      // Exceptional circumstances; this function is setup to favor the
      // content, but if content is empty and the cursor is between the
      // prefix and suffix (the only possibility left, assuming this cursor
      // actually is for this instance's `fullText`), we must favor one
      // of those instead.
      if (content.length === 0) {
        if (prefixLength) return makeCursor(this, prefixLength);
        if (suffix.content) return makeCursor(this, suffix.offset);
      }
      else {
        // Remove the prefix from the full-text cursor so we're inside
        // the content block.
        let cursorOffset = cursor.offset - prefixLength;

        // Fast-path: For contiguous content, we can map the cursor directly
        // to the content, now that the prefix was accounted for.
        if (this.#isContiguous) return makeCursor(this, cursorOffset + initOffset);
        
        // Otherwise, we have to iterate to account for the gaps in content.
        // When there is ambiguity between a fragment with words and a
        // fragment without words, we will favor the one with words.
        let lastFrag: UndefOr<TextFragment> = undefined;
        for (const curFrag of content) {
          const fragLength = curFrag.content.length;

          // Here, we're dealing with an ambiguity; the last fragment was
          // non-wordy, so we pulled one more fragment in hopes it was wordy.
          if (lastFrag && cursorOffset === 0) {
            // If the current fragment is also non-wordy, break the loop
            // to use the end of the last fragment.
            if (!hasWords(curFrag.content)) break;
            // Otherwise, use the start of this fragment.
            return makeCursor(this, beforeFragment(curFrag));
          }

          // Remove this fragment from the full-text offset.  This will go
          // negative if the offset is inside this fragment.
          cursorOffset -= fragLength;

          checks: {
            // If it's non-zero and positive, we're not in this fragment.
            if (cursorOffset > 0) break checks;
            // We're at the very end of this fragment, but because this
            // fragment has no wordy content, we want to check the next
            // fragment to see if it is a better candidate to favor.
            if (cursorOffset === 0 && !hasWords(curFrag.content)) break checks;
            // Otherwise, this is our fragment.  Because we preemptively
            // subtracted `cursorOffset` to make the checks of the loop
            // simpler, we have to add it back to the length to get the
            // correct offset.
            return makeCursor(this, curFrag.offset + fragLength + cursorOffset);
          }

          // Update the last fragment.
          lastFrag = curFrag;
        }

        // It is possible we still have no last fragment; remember that
        // we were skipping empty fragments.  But if we have one, assume
        // we are meant to use the end of that fragment, since we were
        // likely attempting the non-wordy disambiguation and ran out
        // of fragments.
        if (lastFrag) return makeCursor(this, afterFragment(lastFrag));
      }

      // If we get here, this is the "completely empty assembly" fail-safe;
      // just use the initial offset we determined.
      return makeCursor(this, initOffset);
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
    findBest(
      /** The cursor to potentially adjust. */
      cursor: AssemblyCursor,
      /**
       * Whether to favor content fragments.  This does not guarantee that
       * the returned cursor will be inside the content, but it will do
       * its best.
       */
      preferContent: boolean = false
    ): AssemblyCursor {
      // This also does the various assertions, so no need to repeat those.
      if (this.isFoundIn(cursor)) {
        if (!preferContent) return cursor;
        // If we're preferring content, make sure it is for content.
        if (this.positionOf(cursor) === "content") return cursor;
      }

      // Seems to be missing.  Let's see about finding the next best offset.
      // That will be one end of some existing fragment with the minimum
      // distance from the cursor's offset and the fragment's end.

      // We can prefer searching within only the content.
      const fragments = preferContent ? this.content : this;
      const offsetsIterator = _iterBounds(fragments, cursor.offset);

      if (this.#isContiguous) {
        // Fast-path: for contiguous assemblies, we can stop as soon as the
        // distance stops getting smaller.
        let lastResult: UndefOr<OffsetResult> = undefined;
        for (const curResult of offsetsIterator) {
          const next = _offsetReducer(lastResult, curResult);
          // We hit the minimum if we get the `lastResult` back.
          if (next === lastResult) return makeCursor(this, next[0]);
          lastResult = next;
        }
        // If we get here, we ran through them all and never got the last
        // result back from `_offsetReducer`.  But, if we have `lastResult`,
        // we will assume the very last fragment was the nearest.
        if (lastResult) return makeCursor(this, lastResult[0]);
      }
      else {
        // For non-contiguous assemblies, we'll have to run through every
        // fragment to find the minimum difference.
        const result = chain(offsetsIterator).reduce(undefined, _offsetReducer);
        if (result) return makeCursor(this, result[0]);
      }

      // If we get here, `fragments` was probably empty, which can happen
      // and is perfectly valid.  We can fall back to anchoring to the
      // boundaries of each significant block instead, defined completely by
      // the prefix and suffix.  This is one of the reasons why we're habitually
      // generating these, even if they're empty.
      const { prefix, suffix } = this.source;
      const [newOffset] = assertExists(
        "Expected to have boundaries from prefix and suffix.",
        chain(_iterBounds([prefix, suffix], cursor.offset))
          .reduce(undefined, _offsetReducer)
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
      const usedCursor = dew(() => {
        // The input cursor must be for the content.
        if (this.positionOf(cursor) !== "content") return undefined;
        if (!loose) return this.isFoundIn(cursor) ? cursor : undefined;
        const bestCursor = this.findBest(cursor, true);
        // Make sure the cursor did not get moved out of the content.
        // This can happen when the content is empty; the only remaining
        // place it could be moved was to a prefix/suffix fragment.
        return this.positionOf(bestCursor) === "content" ? bestCursor : undefined;
      });

      if (!usedCursor) return undefined;

      const beforeCut: TextFragment[] = [];
      const afterCut: TextFragment[] = [];
      let curBucket = beforeCut;
      for (const frag of this.content) {
        // Do we need to swap buckets?
        checkForSwap: {
          if (curBucket === afterCut) break checkForSwap;
          if (!isCursorInside(usedCursor, frag)) break checkForSwap;

          const cursorOffset = usedCursor.offset;

          // This is the fragment of the cut.  Let's figure out how to split
          // the fragment.  We only need to bother if the point is inside the
          // fragment, that is, not at one of its ends.  We're going to the
          // trouble because text fragments are immutable and it'd be nice to
          // preserve referential equality where possible.
          switch (cursorOffset) {
            case beforeFragment(frag):
              afterCut.push(frag);
              break;
            case afterFragment(frag):
              beforeCut.push(frag);
              break;
            default: {
              const [before, after] = splitterService.splitFragmentAt(frag, cursorOffset);
              beforeCut.push(before);
              afterCut.push(after);
              break;
            }
          }
          // Finally, swap the buckets so we place the remaining fragments in
          // the correct derivative assembly.
          curBucket = afterCut;
          continue;
        }

        // If we left the `checkForSwap` block, just add it to the current bucket.
        curBucket.push(frag);
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
     * A helper function for {@link fragmentsFrom} to get the fragments
     * starting from the fragment identified by a `cursor` toward either
     * the top or bottom of the text.
     */
    #fragsStartingFrom(
      /** The cursor that will identify the starting fragment. */
      cursor: AssemblyCursor,
      /** Which direction to iterate. */
      direction: IterDirection
    ): Iterable<TextFragment> {
      const toBottom = direction === "toBottom";
      const skipFn = toBottom ? IterOps.skipUntil : IterOps.skipRightUntil;
      const theFrags = skipFn(this, (f) => isCursorInside(cursor, f));
      return toBottom ? theFrags : IterOps.iterReverse(theFrags);
    }

    /**
     * A helper function for {@link fragmentsFrom} to split up the
     * input fragments and yield the result starting from the fragment
     * identified by a `cursor`.
     */
    #sequenceFragments(
      /** The cursor that will identify the starting fragment. */
      cursor: AssemblyCursor,
      /** The input fragments to process. */
      inFrags: Iterable<TextFragment>,
      /** The sequencers left to run. */
      sequencers: TextSequencer[]
    ): Iterable<TextFragment> {
      // Skip fragments while we have not found the cursor that
      // indicates the start of iteration.  This needs to be done
      // regardless of if we're doing further splitting.
      const theFrags = IterOps.skipUntil(inFrags, (f) => isCursorInside(cursor, f));
      if (!sequencers.length) return theFrags;

      const [sequencer, ...restSeq] = sequencers;
      // Split them up.
      const splitFrags = IterOps.flatMap(theFrags, sequencer.splitUp);
      // Recurse to split them up further until we're out of sequencers.
      return this.#sequenceFragments(cursor, splitFrags, restSeq);
    }

    /**
     * A function built to help locate positions for insertion relative to
     * some given `position`.
     * 
     * Fragments will be split using the trim-type specified in `splitType`
     * and yielded according to `direction`, starting from first fragment
     * to contain the cursor obtained from `position`.  This includes the
     * cursor lying on the boundary of a fragment.
     * 
     * All non-empty fragments, including prefix and suffix, are included.
     * 
     * This method has some limitations in how if views the assembly.
     * If, say, a single sentence was split across two fragments somehow,
     * asking it to split it by sentence will not merge those two
     * fragments-of-a-single-sentence into one fragment.
     * 
     * It takes the fragments, as they are now, and runs each through
     * the desired splitter.  If they're already split finer than the
     * desired splitting granularity, they will remain split that way.
     */
    fragmentsFrom(
      /**
       * A cursor or selection marking the position of the iteration.
       * 
       * If a {@link TextSelection}:
       * - When `direction` is `"toTop"`, the first cursor is used.
       * - When `direction` is `"toBottom"`, the second cursor is used.
       */
      position: AssemblyCursor | TextSelection,
      /** The splitting type to use to generate the fragments. */
      splitType: TrimType,
      /** Which direction to iterate. */
      direction: IterDirection
    ): Iterable<TextFragment> {
      if (isArray(position)) {
        const realPos = direction === "toTop" ? position[0] : position[1];
        return this.fragmentsFrom(realPos, splitType, direction);
      }

      // In case the cursor points to no existing fragment, this will move
      // it to the next nearest fragment.
      const cursor = this.findBest(position as AssemblyCursor);

      const initFrags = this.#fragsStartingFrom(cursor, direction);
      const provider = direction === "toTop" ? "trimTop" : "trimBottom";
      const sequencers = getSequencersFrom(provider, splitType);

      return this.#sequenceFragments(cursor, initFrags, sequencers);
    }

    /**
     * Locates a position relative to the given `position`.
     * 
     * This is intended to be used during the insertion phase to find
     * a key-relative position to split an assembly at to insert another
     * entry in the middle of it.
     * 
     * It will not provide cursors inside of the prefix or suffix, as
     * I did not want to deal with the added complexity of splitting
     * on those fragments.
     * 
     * If you get a result where `remainder === 0`, that is an indication
     * to place the entry immediately before or after this assembly.
     */
    locateInsertion(
      /**
       * A cursor or selection marking the position of the iteration.
       * 
       * If a {@link TextSelection}:
       * - When `direction` is `"toTop"`, the first cursor is used.
       * - When `direction` is `"toBottom"`, the second cursor is used.
       */
      position: AssemblyCursor | TextSelection,
      /** The type of insertion being done. */
      insertionType: TrimType,
      /** Which direction to look for an insertion position. */
      direction: IterDirection,
      /** How many elements to shift the position by; must be positive. */
      offset: number
    ): PositionResult {
      assert("Expected `offset` to be a positive number.", offset >= 0);

      const [remainder, frag] = dew(() => {
        // Tracks how many elements we still need to pass.
        let remainder = offset;

        // There's really only three positions we care about for this process.
        // - The position before a fragment containing words.
        // - The position after a fragment containing words.
        // - The zero-length position between two `\n` characters.
        // The `toCursor` function will get the right before/after position,
        // so we just need to make sure we have the right fragments in here.
        const fragments = chain(this.fragmentsFrom(position, insertionType, direction))
          // Group consecutive `\n` characters together.
          .thru((iter) => IterOps.buffer(iter, (f) => f.content !== "\n", true))
          .thru((iter) => {
            // Prepare the function to get the multi-newline offset, which
            // differs based on iteration direction.
            const toOffset = direction === "toTop" ? afterFragment : beforeFragment;

            return IterOps.flatMap(iter, (frags) => {
              // If we don't have multiple fragments in the buffer, nothing
              // special needs to be done.
              if (frags.length === 1) return frags;
              // Let's give that zero-length position form.  Basically, we're
              // putting an empty fragment between each `\n` and then removing
              // the `\n` fragments, but cleverly.
              return IterOps.mapIter(
                IterOps.skip(frags, 1),
                (f) => createFragment("", toOffset(f))
              );
            });
          })
          // And now preserve the empty fragments and those with words.
          .filter((f) => f.content.length === 0 || hasWords(f))
          .value();

        for (const frag of fragments) {
          if (remainder <= 0) return [remainder, frag] as const;
          remainder -= 1;
        }

        // If we get here, we couldn't find a good fragment within the assembly.
        return [remainder, undefined] as const;
      });

      if (frag) {
        // The side of the fragment we want to position the cursor also
        // differs based on iteration direction.
        const toOffset = direction === "toTop" ? beforeFragment : afterFragment;
        const cursor = makeCursor(this, toOffset(frag));

        // We're not going to split on the prefix or suffix, just to avoid
        // the complexity of it, so we need to check where we are.
        switch (this.positionOf(cursor)) {
          // This is the best case; everything is just fine, but this
          // fragment will need to be split.
          case "content": return { type: "inside", cursor };
          // This tells it to insert before this fragment.
          case "prefix": return { type: "insertBefore" };
          // And this after this fragment.
          case "suffix": return { type: "insertAfter" };
        }
      }

      // In any other case, we tell it to carry on, whatever amount is left.
      return { type: direction, remainder };
    }

    /**
     * Generates a version of this assembly that has no prefix or suffix.
     * 
     * It still has the same source, so cursors for that source will still
     * work as expected.
     */
    asOnlyContent(): TextAssembly {
      // No need if we don't have a prefix or suffix.
      if (!this.#isAffixed) return this;

      // Replace the suffix and prefix with zero-length fragments.
      const { prefix, suffix } = this;
      return new TextAssembly(
        !prefix.content ? prefix : createFragment("", 0, prefix),
        this.#content,
        !suffix.content ? suffix : createFragment("", 0, suffix),
        this.#isContiguous, this.source
      );
    }

    /**
     * Determines what block the given `cursor` belongs to.  It makes the
     * following checks in this order:
     * - If the cursor has a source that differs from this assembly, it will
     *   return `"unrelated"` to indicate the cursor is unsuitable for this
     *   assembly.
     * - If the cursor is outside of the prefix and suffix, it returns `"content"`.
     * - If the cursor is adjacent to any content fragment, it returns `"content"`.
     * - If the cursor is inside the prefix, it returns `"prefix"`.
     * - If the cursor is inside the suffix, it returns `"suffix"`.
     * - Otherwise, it returns `"content"`, assuming the content fragment
     *   it belongs to is simply missing.
     * 
     * It does not check to see if a fragment exists in this assembly that
     * corresponds to the cursor's position.  Use {@link isFoundIn} to make that
     * determination.
     */
    positionOf(cursor: AssemblyCursor): CursorPosition {
      assert(
        "Expected an assembly cursor.",
        cursor.type === "assembly"
      );

      // Can't be in this assembly if it is unrelated.
      if (!this.isRelatedTo(cursor.origin)) return "unrelated";

      // We'll use the source's prefix/suffix to keep this consistent between
      // derived assemblies and their source.
      if (isCursorInside(cursor, this.source.prefix)) {
        if (!this.content.length) return "prefix";
        if (cursor.offset !== this.contentStats.minOffset) return "prefix";
      }
      else if (isCursorInside(cursor, this.source.suffix)) {
        if (!this.content.length) return "suffix";
        if (cursor.offset !== this.contentStats.maxOffset) return "suffix";
      }

      // Acts as the fallback value as well.
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
    makeCursor,
    asAssemblyCursor,
    toSelection,
    getStats,
    TextAssembly
  });
});

export default theModule;
export type TextAssembly = InstanceType<ReturnType<typeof theModule>["TextAssembly"]>;