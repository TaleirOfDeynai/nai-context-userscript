import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import { toImmutable } from "@utils/iterables";
import $QueryOps from "./assemblies/queryOps";
import $CursorOps from "./assemblies/cursorOps";
import $PositionOps from "./assemblies/positionOps";

import type { UndefOr } from "@utils/utility-types";
import type { AssemblyStats } from "./assemblies/sequenceOps";
import type { CursorPosition } from "./assemblies/cursorOps";
import type * as PosOps from "./assemblies/positionOps";
import type { TextFragment } from "./TextSplitterService";
import type { TrimType } from "./TrimmingProviders";
import type { Assembly } from "./assemblies";
import type { Cursor } from "./cursors";

const theModule = usModule((require, exports) => {
  const queryOps = $QueryOps(require);
  const cursorOps = $CursorOps(require);
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
  abstract class FragmentAssembly implements Assembly.IFragment, Iterable<TextFragment> {
    constructor(
      prefix: TextFragment,
      content: Iterable<TextFragment>,
      suffix: TextFragment,
      isContiguous: boolean,
      source: Assembly.IFragment | null
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
      return this.#assemblyStats ??= queryOps.getStats(this, true);
    }
    #assemblyStats: UndefOr<AssemblyStats> = undefined;

    /**
     * The stats for only the {@link content} portion of the assembly.
     */
    get contentStats(): AssemblyStats {
      return this.#contentStats ??= queryOps.getContentStats(this, true);
    }
    #contentStats: UndefOr<AssemblyStats> = undefined;

    /**
     * The source of this assembly.  If `isSource` is `true`, this
     * will return itself, so this will always get a source fragment.
     */
    get source(): Assembly.IFragment {
      return this.#source ?? this;
    }
    readonly #source: Assembly.IFragment | null;

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
      return cursorOps.fromFullText(this, cursor);
    }

    /**
     * Converts an fragment cursor into a full-text cursor.
     * 
     * The cursor must be addressing a fragment that exists within this assembly.
     */
    toFullText(cursor: Cursor.Fragment): Cursor.FullText {
      return cursorOps.toFullText(this, cursor);
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
      return cursorOps.isFoundIn(this, cursor);
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
      return cursorOps.findBest(this, cursor, preferContent);
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
       * If a {@link Cursor.Selection}:
       * - When `direction` is `"toTop"`, the first cursor is used.
       * - When `direction` is `"toBottom"`, the second cursor is used.
       */
      position: Cursor.Fragment | Cursor.Selection,
      /** The splitting type to use to generate the fragments. */
      splitType: TrimType,
      /** Which direction to iterate. */
      direction: PosOps.IterDirection
    ): Iterable<TextFragment> {
      if (this.isEmpty) return [];

      // In case the cursor points to no existing fragment, this will move
      // it to the next nearest fragment.
      const cursor = cursorOps.findBest(this, posOps.cursorForDir(position, direction));
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
      return posOps.locateInsertion(this, insertionType, positionData);
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
      return posOps.entryPosition(this, direction, insertionType);
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
      return cursorOps.positionOf(this, cursor);
    }

    /**
     * Determines if this assembly and `otherAssembly` share a source.
     * 
     * If they are related, {@link Cursor.Any text cursors} for one assembly
     * should have meaning to the other.
     */
    isRelatedTo(otherAssembly: Assembly.IFragment) {
      return queryOps.checkRelated(this, otherAssembly);
    }
  }

  return Object.assign(exports, {
    FragmentAssembly
  });
});

export default theModule;
export type FragmentAssembly = InstanceType<ReturnType<typeof theModule>["FragmentAssembly"]>;