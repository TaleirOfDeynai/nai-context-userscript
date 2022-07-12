import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { isNumber } from "@utils/is";
import { assert } from "@utils/assert";
import * as IterOps from "@utils/iterables";
import { chain, toImmutable } from "@utils/iterables";
import $Cursors from "./assemblies/Cursors";
import $TextSplitterService from "./TextSplitterService";
import $SequenceOps from "./assemblies/sequenceOps";
import $QueryOps from "./assemblies/queryOps";
import $PositionOps from "./assemblies/positionOps";

import type { UndefOr } from "@utils/utility-types";
import type { TextFragment } from "./TextSplitterService";
import type { TrimType } from "./TrimmingProviders";
import type { Cursor, Selection } from "./assemblies/Cursors";
import type { IFragmentAssembly } from "./assemblies/Fragment";
import type { AssemblyStats } from "./assemblies/sequenceOps";
import type { CursorPosition } from "./assemblies/queryOps";
import type * as PosOps from "./assemblies/positionOps";

const theModule = usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const cursors = $Cursors(require);
  const seqOps = $SequenceOps(require);
  const queryOps = $QueryOps(require);
  const posOps = $PositionOps(require);

  /**
   * An abstraction that standardizes how text is assembled with prefixes
   * and suffixes taken into account.
   * 
   * It aids searching by ensuring that an {@link Cursor.Any} for some source
   * text will retain consistent offsets as it travels through various parts
   * of the program.
   * 
   * These are also used for trimming and filtering, as the `content` can
   * be any number of fragments, even if non-contiguous or out-of-order.
   * 
   * Finally, they can be split at specific offsets using an
   * {@link Cursor.Any}, which is handy for assembly.
   */
  abstract class FragmentAssembly implements IFragmentAssembly, Iterable<TextFragment> {
    constructor(
      prefix: TextFragment,
      content: Iterable<TextFragment>,
      suffix: TextFragment,
      isContiguous: boolean,
      source: IFragmentAssembly | null
    ) {
      assert(
        "Expected `source` to be a source assembly.",
        !source || queryOps.isSource(source)
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
      return this.#text ??= queryOps.getText(this, true);
    }
    #text: UndefOr<string> = undefined;

    /** The stats for this assembly. */
    get stats(): AssemblyStats {
      return this.#assemblyStats ??= dew(() => {
        // If we're un-affixed, we can reuse the content stats.
        if (!queryOps.isAffixed(this)) return this.contentStats;
        return seqOps.getStats(Array.from(this));
      });
    }
    #assemblyStats: UndefOr<AssemblyStats> = undefined;

    /**
     * The stats for only the {@link content} portion of
     * the assembly.
     */
    get contentStats(): AssemblyStats {
      return this.#contentStats ??= seqOps.getStats(
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

    /** Whether `content` is contiguous. */
    get isContiguous() {
      return this.#isContiguous;
    }
    readonly #isContiguous: boolean;

    /** Whether this assembly is entirely empty or not. */
    get isEmpty() {
      return !queryOps.isAffixed(this) && !this.#content.length;
    }

    /**
     * Iterator that yields all fragments that are not empty.  This can
     * include both the {@link prefix} and the {@link suffix}.
     */
    [Symbol.iterator](): Iterator<TextFragment> {
      return queryOps.iterateOn(this);
    }

    /**
     * Given a cursor that is addressing this instance's `text`,
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
    fromFullText(cursor: Cursor.FullText): Cursor.Fragment {
      return queryOps.fromFullText(this, cursor);
    }

    /**
     * Converts an fragment cursor into a full-text cursor.
     * 
     * The cursor must be addressing a fragment that exists within this assembly.
     */
    toFullText(cursor: Cursor.Fragment): Cursor.FullText {
      return queryOps.toFullText(this, cursor);
    }

    /**
     * Checks to ensure that the cursor references a valid text fragment;
     * that is, the fragment of this cursor is not missing.
     * 
     * When `cursor` originated from another {@link FragmentAssembly} that was
     * created from the same source text, this can be used to validate that
     * the fragment the cursor is trying to target is still in this instance's
     * `content` array.
     */
    isFoundIn(cursor: Cursor.Fragment): boolean {
      return queryOps.isFoundIn(this, cursor);
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
     * When `cursor` originated from a related {@link FragmentAssembly}, this
     * can be used to adapt the cursor to a reasonable position that does
     * exist.
     */
    findBest(
      cursor: Cursor.Fragment,
      preferContent?: boolean
    ): Cursor.Fragment {
      return queryOps.findBest(this, cursor, preferContent);
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
       * If a {@link Selection}:
       * - When `direction` is `"toTop"`, the first cursor is used.
       * - When `direction` is `"toBottom"`, the second cursor is used.
       */
      position: Cursor.Fragment | Selection,
      /** The splitting type to use to generate the fragments. */
      splitType: TrimType,
      /** Which direction to iterate. */
      direction: PosOps.IterDirection
    ): Iterable<TextFragment> {
      if (this.isEmpty) return [];

      // In case the cursor points to no existing fragment, this will move
      // it to the next nearest fragment.
      const cursor = queryOps.findBest(this, posOps.cursorForDir(position, direction));
      return posOps.splitUpFrom(this, cursor, splitType, direction);
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
      /** The type of insertion being done. */
      insertionType: TrimType,
      /** An object describing how to locate the insertion. */
      positionData: Readonly<PosOps.InsertionPosition>
    ): PosOps.PositionResult {
      const { position, direction, offset } = positionData;

      assert("Expected `offset` to be a positive number.", offset >= 0);

      // Fast-path: If this assembly is empty, tell it to carry on.
      if (this.isEmpty) return { type: direction, remainder: offset };

      const initCursor = queryOps.findBest(this, posOps.cursorForDir(position, direction));

      // Fast-path: If we're given an offset of 0, we don't need to move
      // the cursor at all (though, `findBest` could have moved it).
      if (offset === 0) return { type: "inside", cursor: initCursor };

      const result = dew(() => {
        // Tracks how many elements we still need to pass.
        let remainder = offset;

        const cursors = chain(this)
          .thru((iter) => posOps.splitUpFrom(iter, initCursor, insertionType, direction))
          // Convert into positions...
          .thru((iter) => posOps.positionsFrom(this, iter, direction))
          // ...but if we find the initial cursor, skip it...
          .thru((iter) => IterOps.skipUntil(iter, (c) => c.offset !== initCursor.offset))
          // ...because we're adding it into the first position here.
          .thru((cursors) => IterOps.concat(initCursor, cursors))
          .value();

        for (const cursor of cursors) {
          if (remainder <= 0) return cursor;
          remainder -= 1;
        }

        // If we get here, we couldn't find a good fragment within the assembly.
        return remainder;
      });

      // If we got a remainder, we tell it to carry on.
      if (isNumber(result)) return { type: direction, remainder: result };

      // We're not going to split on the prefix or suffix, just to avoid
      // the complexity of it, so we need to check where we are.
      switch (queryOps.positionOf(this, result)) {
        // This is the best case; everything is just fine, but this
        // fragment will need to be split.
        case "content": return { type: "inside", cursor: result };
        // This tells it to insert before this fragment.
        case "prefix": return {
          type: "insertBefore",
          shunted: result.offset - ss.beforeFragment(this.prefix)
        };
        // And this after this fragment.
        case "suffix": return {
          type: "insertAfter",
          shunted: ss.afterFragment(this.suffix) - result.offset
        };
        default: throw new Error("Unexpected position.");
      }
    }

    /**
     * Gets a cursor for entering this assembly during iteration.
     */
    entryPosition(
      /** Which direction to iterate. */
      direction: PosOps.IterDirection,
      /**
       * The type of insertion to be done.
       * 
       * This may be omitted to produce a cursor:
       * - at the beginning of the assembly if `direction` is `"toBottom"`.
       * - at the end of the assembly if `direction` is `"toTop"`.
       * 
       * When provided, it will provide a position valid for the
       * insertion type:
       * - the earliest possible position if `direction` is `"toBottom"`.
       * - the latest possible position if `direction` is `"toTop"`.
       * 
       * If there is no valid position, it will return the same value as
       * though it were omitted; this will be the case if the assembly is
       * empty.  It should be the prefix or suffix, doing their job as
       * positional anchors.
       */
      insertionType?: TrimType
    ): Cursor.Fragment {
      if (insertionType) {
        const initCursor = this.entryPosition(direction);
        return chain(this)
          .thru((iter) => posOps.splitUpFrom(iter, initCursor, insertionType, direction))
          .thru((iter) => posOps.positionsFrom(this, iter, direction))
          .value((c) => IterOps.first(c) ?? initCursor);
      }
      else if (direction === "toTop") {
        const suffix = this.suffix.content ? this.suffix : undefined;
        const frag = suffix ?? IterOps.last(this.content) ?? this.prefix;
        return cursors.fragment(this, ss.afterFragment(frag));
      }
      else {
        const prefix = this.prefix.content ? this.prefix : undefined;
        const frag = prefix ?? IterOps.first(this.content) ?? this.suffix;
        return cursors.fragment(this, ss.beforeFragment(frag));
      }
    }

    /**
     * When we have a cursor inside this assembly, but we can't split it
     * due to the entry's configuration, this will tell us the nearest side
     * to insert it adjacent to this assembly.
     * 
     * If the cursor could go either way, it will favor toward the top.
     */
    shuntOut(
      cursor: Cursor.Fragment,
      mode?: PosOps.IterDirection | "nearest"
    ): PosOps.PositionResult {
      return posOps.shuntOut(this, cursor, mode);
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
    positionOf(cursor: Cursor.Fragment): CursorPosition {
      return queryOps.positionOf(this, cursor);
    }

    /**
     * Determines if this assembly and `otherAssembly` share a source.
     * 
     * If they are related, {@link Cursor.Any text cursors} for one assembly
     * should have meaning to the other.
     */
    isRelatedTo(otherAssembly: IFragmentAssembly) {
      return queryOps.checkRelated(this, otherAssembly);
    }
  }

  return Object.assign(exports, {
    FragmentAssembly
  });
});

export default theModule;
export type FragmentAssembly = InstanceType<ReturnType<typeof theModule>["FragmentAssembly"]>;