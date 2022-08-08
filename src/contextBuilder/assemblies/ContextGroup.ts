import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { assert } from "@utils/assert";
import * as IterOps from "@utils/iterables";
import UUID from "@nai/UUID";
import getTokensForSplit from "./tokenOps/getTokensForSplit";
import makeCursor from "../cursors/Fragment";
import $TextSplitterService from "../TextSplitterService";
import $CursorOps from "./cursorOps";
import $PositionOps from "./positionOps";
import $TokenizedAssembly from "./Tokenized";
import $CompoundAssembly from "./Compound";

import type { UndefOr } from "@utils/utility-types";
import type { StructuredOutput } from "@nai/ContextBuilder";
import type { ContextConfig, Categories } from "@nai/Lorebook";
import type { SourceType } from "../ContextSource";
import type { TextFragment } from "../TextSplitterService";
import type { TrimType } from "../TrimmingProviders";
import type { AugmentedTokenCodec, Tokens } from "../TokenizerService";
import type { Cursor } from "../cursors";
import type { IFragmentAssembly } from "./_interfaces";
import type { TokenizedAssembly } from "./Tokenized";
import type { AssemblyLike, ContentLike, SourceLike } from "./Compound";
import type { Position, IterDirection, InsertionPosition } from "./positionOps";

// For JSDoc links...
import type { TrimOptions } from "../TrimmingService";

type CategoryWithSubContext = Categories.BaseCategory & Categories.WithSubcontext;

interface TokenizedFragment {
  text: string;
  tokens: Tokens;
}

const EMPTY_TOKENS: Tokens = Object.freeze([]);

const theModule = usModule((require, exports) => {
  const uuid = require(UUID);
  const ss = $TextSplitterService(require);
  const tokenized = $TokenizedAssembly(require);
  const cursorOps = $CursorOps(require);
  const posOps = $PositionOps(require);
  const { CompoundAssembly } = $CompoundAssembly(require);

  /**
   * A class that represents a group within a context; these are used as
   * an alternative to the pre-assembled sub-context.
   * 
   * Everything in this is implemented pretty lazily and could be optimized
   * better.  Accessing most properties of {@link IFragmentAssembly} will
   * instantiate objects and perform iterations on the sub-assemblies.
   */
  class ContextGroup
    extends CompoundAssembly
    implements AssemblyLike, ContentLike, SourceLike
  {
    constructor(
      codec: AugmentedTokenCodec,
      identifier: string,
      uniqueId: string,
      type: SourceType,
      contextConfig: Readonly<ContextConfig>,
      prefix: TokenizedFragment,
      suffix: TokenizedFragment
    ) {
      super(codec, contextConfig.tokenBudget);

      this.#identifier = identifier;
      this.#uniqueId = uniqueId;
      this.#type = type;
      this.#contextConfig = contextConfig;
      this.#prefix = prefix;
      this.#suffix = suffix;
      this.#trimmedFrag = undefined;
    }

    /**
     * Creates a fragment from {@link Compound.text}, but emulates the
     * behavior of trimming with {@link TrimOptions.preserveEnds} set
     * to `false`.
     * 
     * This is the typical of lorebook entries.
     */
    get trimmedFrag(): TextFragment {
      return this.#trimmedFrag ??= dew(() => {
        const text = this.isEmpty ? "" : super.text;
        const offset = this.#prefix.text.length;
        return this.#trimEnds(ss.createFragment(text, offset));
      });
    }
    #trimmedFrag: UndefOr<TextFragment>;

    // Implementations for `SourceLike`.

    get identifier() {
      return this.#identifier;
    }
    readonly #identifier: string;

    get uniqueId() {
      return this.#uniqueId;
    }
    readonly #uniqueId: string;

    get type() {
      return this.#type;
    }
    readonly #type: SourceType;
  
    get entry() {
      return this;
    }

    get field() {
      return {
        text: "",
        id: this.#uniqueId,
        contextConfig: this.#contextConfig
      };
    }

    // Implementations for `ContentLike`.

    get contextConfig() {
      return this.#contextConfig;
    }
    readonly #contextConfig: Readonly<ContextConfig>;

    get trimmed() {
      return Promise.resolve(this);
    }

    // Implementations for `AssemblyLike`.

    /**
     * The full, concatenated text of the assembly.  If this assembly is
     * empty, its text will also be empty.
     */
    get text() {
      if (this.isEmpty) return "";

      return [
        this.#prefix.text,
        this.trimmedFrag.content,
        this.#suffix.text
      ].join("");
    }

    /**
     * The content text of the assembly.  If this assembly is empty, its
     * content will also be empty.
     */
    get contentText() {
      return this.trimmedFrag.content;
    }

    /**
     * The current tokens of the assembly.  If this assembly is empty,
     * its tokens will also be empty.
     */
    get tokens(): Tokens {
      return this.isEmpty ? EMPTY_TOKENS : super.tokens;
    }

    get prefix(): TextFragment {
      return ss.createFragment(this.#prefix.text, 0);
    }
    readonly #prefix: TokenizedFragment;

    get content(): readonly TextFragment[] {
      const fragment = this.trimmedFrag;
      if (!fragment.content) return Object.freeze([]);

      let offset = this.#prefix.text.length + fragment.offset;
      return Object.freeze([ss.createFragment(fragment.content, offset)]);
    }

    get suffix(): TextFragment {
      const offset = this.#prefix.text.length + super.text.length;
      return ss.createFragment(this.#suffix.text, offset);
    }
    readonly #suffix: TokenizedFragment;

    /** A context-group is always its own source. */
    get source(): this {
      return this;
    }

    /**
     * A context-group is treated as empty until it has a non-empty assembly
     * inside it, regardless of if its `prefix` or `suffix` have content.
     */
    get isEmpty(): boolean {
      if (this.assemblies.length === 0) return true;
      return this.assemblies.every((asm) => asm.isEmpty);
    }

    /**
     * Implementation of {@link AssemblyLike.adaptCursor}.
     * 
     * This will adapt the cursor to this context-group's current `text` if
     * the cursor is targeting one of its sub-assemblies.
     * 
     * This cursor is only valid for the current state of the group;
     * if the group is modified, the cursor may point to a different
     * position than intended.
     */
    adaptCursor(cursor: Cursor.Fragment): UndefOr<Cursor.Fragment> {
      if (cursor.origin === this) return cursor;

      let offset = this.#prefix.text.length;
      for (const asm of this.assemblies) {
        checks: {
          if (!asm.isRelatedTo(cursor.origin)) break checks;
          // It may still be in a split sub-assembly.
          if (!asm.isFoundIn(cursor)) break checks;
          // In case the cursor was in a trimmed portion at the start
          // or end of the content, adjust the cursor so it's in a
          // valid location for this assembly.
          return cursorOps.findBest(this, makeCursor(this, offset), true);
        }

        offset += asm.text.length;
      }

      return undefined;
    }

    /** Implementation of {@link AssemblyLike.isRelatedTo}. */
    isRelatedTo(other: IFragmentAssembly): boolean {
      if (other === this) return true;

      for (const asm of this.assemblies)
        if (asm.isRelatedTo(other))
          return true;
      return false;
    }

    /** Implementation of {@link AssemblyLike.isFoundIn}. */
    isFoundIn(cursor: Cursor.Fragment): boolean {
      if (cursor.origin !== this) return false;
      return cursorOps.isFoundIn(this, cursor);
    }

    /** Implementation of {@link AssemblyLike.entryPosition}. */
    entryPosition(
      /** Which direction to iterate. */
      direction: IterDirection,
      /** The type of insertion to be done. */
      insertionType?: TrimType
    ): Cursor.Fragment {
      return posOps.entryPosition(this, direction, insertionType);
    }

    /** Implementation of {@link AssemblyLike.locateInsertion}. */
    locateInsertion(
      /** The type of insertion being done. */
      insertionType: TrimType,
      /** An object describing how to locate the insertion. */
      positionData: Readonly<InsertionPosition>
    ): Position.InsertResult {
      assert(
        "Expected cursor to related to this assembly.",
        this.isRelatedTo(positionData.cursor.origin)
      );
      assert(
        "Expected to not be an empty compound assembly.",
        !this.isEmpty
      );

      // Context-groups cannot be inserted into using the same method as normal
      // fragment assemblies.  So, if the insertion point is within this assembly,
      // it's getting shunted out, period.
      const result = posOps.locateInsertion(this, insertionType, positionData);
      
      switch (result.type) {
        case "insertAfter":
        case "insertBefore":
          return result;
        default: {
          const { shuntingMode } = usConfig.assembly;
          const direction = shuntingMode === "inDirection" ? positionData.direction : "nearest";
          return this.shuntOut(positionData.cursor, direction);
        }
      }
    }

    /** Implementation of {@link AssemblyLike.shuntOut}. */
    shuntOut(
      /** The cursor defining the location we're being shunt from. */
      cursor: Cursor.Fragment,
      /** The shunt mode to use. */
      mode?: IterDirection | "nearest"
    ): Position.InsertResult {
      return posOps.shuntOut(this, cursor, mode);
    }

    /**
     * Converts this context-group into a into a static {@link TokenizedAssembly}.
     * 
     * The conversion is a destructive process.  All information about assemblies
     * that were inserted will be lost and cursors targeting those assemblies will
     * not be able to be used with this assembly.
     */
    toAssembly(): Promise<TokenizedAssembly> {
      return tokenized.castTo(this.codec, this);
    }

    /** Yields the structured output of the assembly. */
    *structuredOutput(): Iterable<StructuredOutput> {
      if (this.isEmpty) return;

      // Similar to the problem outlined in `mendTokens`, the structured
      // output must also reflect the trimmed `text` or NovelAI will fail
      // an assertion.

      // Fortunately, `trimmedFrag` should be correct and `super.structuredOutput`
      // should concatenate into `super.text`.  So, we can just convert each
      // element into fragments, slice up `trimmedFrag` and replace the `text`
      // of the structured output.

      const { uniqueId: identifier, type } = this;
      // Yield the prefix, if needed.
      if (this.#prefix.text) yield { identifier, type, text: this.#prefix.text };

      // Here we work on the content.
      let remaining = this.trimmedFrag;
      let offset = 0;
      for (const so of super.structuredOutput()) {
        // There's probably no reason to yield empty elements.
        if (!so.text) continue;

        const srcFrag = ss.createFragment(so.text, offset);
        const splitOffset = srcFrag.offset + srcFrag.content.length;
        if (ss.isOffsetInside(splitOffset, remaining)) {
          const [left, right] = ss.splitFragmentAt(remaining, splitOffset);
          yield { ...so, text: left.content };
          remaining = right;
        }
        else {
          // We'd better be done!
          yield { ...so, text: remaining.content };
          remaining = ss.createFragment("", splitOffset);
        }
        
        offset += so.text.length;
      }

      // Yield the suffix, if needed.
      if (this.#suffix.text) yield { identifier, type, text: this.#suffix.text };
    }

    protected validateBudget(budget: number) {
      // When the assembly is empty, we are pretending that the prefix and suffix
      // do not exist; their tokens have not been being accounted for.  That
      // means the budget calculated earlier may not actually fit this assembly.
      // Let's make sure we rectify this.

      // Firstly, if we aren't empty, use the default behavior.
      if (!this.isEmpty) return super.validateBudget(budget);

      // Now, let's adjust the budget to account for the prefix and suffix.
      // This isn't going to be 100% accurate, since the token mending process
      // can shave off a token or two, but it'll be close enough.
      const pLen = this.#prefix.tokens.length;
      const sLen = this.#suffix.tokens.length;
      const overhead = pLen + sLen;
      budget = super.validateBudget(budget - overhead);

      // We must have room to fit the prefix and suffix into the budget.
      return budget > overhead ? budget : 0;
    }

    protected async mendTokens(tokensToMend: Tokens[]): Promise<Tokens> {
      // We have a problem here; we need the tokens to decode into the
      // same text as will be in `this.text`, but these tokens may not
      // reflect that. The whitespace that is removed in `trimmedFrag`
      // is still present in the tokens.  Sadly, we must do work some
      // foul magic to get this internally consistent.

      // First, mend the tokens as they were given.
      const origTokens = await super.mendTokens(tokensToMend);
      // Now, we'll need to decode them, since the `assemblies` array is
      // not yet updated.  Accessing `text` or `trimmedText` will produce
      // an outdated result.
      const origFrag = ss.createFragment(await this.codec.decode(origTokens), 0);
      // And now apply the trimming behavior.  The fragment's offsets will
      // tell us how much was trimmed.  We can use this to trim the tokens.
      const trimmedFrag = this.#trimEnds(origFrag);

      const [leftTokens, leftFrag] = await this.#dropLeft(
        ss.beforeFragment(trimmedFrag),
        origTokens,
        origFrag
      );

      const [trimmedContent] = await this.#dropRight(
        ss.afterFragment(trimmedFrag),
        leftTokens,
        leftFrag
      );

      // Now, we just need to mend once more with the prefix and suffix
      // tokens included.
      return await super.mendTokens([
        this.#prefix.tokens,
        trimmedContent,
        this.#suffix.tokens
      ]);
    }

    protected async updateState(
      newAssemblies: AssemblyLike[],
      tokens: Tokens,
      source: SourceLike,
      inserted: AssemblyLike
    ): Promise<number> {
      // Invalidate the cached trimmed-text.
      this.#trimmedFrag = undefined;
      return await super.updateState(newAssemblies, tokens, source, inserted);
    }

    /**
     * Trims the given `fragment`, emulating the behavior of trimming with
     * {@link TrimOptions.preserveEnds} set to `false`.
     * 
     * This is the typical way to handle lorebook entries prior to insertion
     * and yeah, this detail makes this a bit gross.
     */
    #trimEnds(fragment: TextFragment): TextFragment {
      if (!fragment.content) return fragment;

      return IterOps.chain([fragment])
        .thru(ss.makeFragmenter(this.contextConfig.maximumTrimType))
        .pipe(IterOps.journey, ss.hasWords)
        .value((iter) => ss.mergeFragments([...iter]));
    }

    /** Drops the characters before `offset`. */
    async #dropLeft(
      offset: number,
      curTokens: Tokens,
      curFrag: TextFragment
    ): Promise<[Tokens, TextFragment]> {
      // No need if the offset is right at the start.
      if (offset === ss.beforeFragment(curFrag))
        return [curTokens, curFrag];

      const [, newFrag] = ss.splitFragmentAt(curFrag, offset);
      const [, newTokens] = await getTokensForSplit(
        this.codec, offset, curTokens, curFrag.content
      );
      return [newTokens, newFrag];
    }

    /** Drops the characters after `offset`. */
    async #dropRight(
      offset: number,
      curTokens: Tokens,
      curFrag: TextFragment
    ): Promise<[Tokens, TextFragment]> {
      // No need if the offset is right at the end.
      if (offset === ss.afterFragment(curFrag))
        return [curTokens, curFrag];

      const [newFrag] = ss.splitFragmentAt(curFrag, offset);
      const [newTokens] = await getTokensForSplit(
        this.codec, offset, curTokens, curFrag.content
      );
      return [newTokens, newFrag];
    }
  }

  /** Creates an empty context-group for a category. */
  async function forCategory(
    codec: AugmentedTokenCodec,
    category: CategoryWithSubContext
  ): Promise<CategoryGroup> {
    const { name, id, subcontextSettings } = category;
    const { contextConfig } = subcontextSettings;

    const [prefix, suffix] = await Promise.all([
      dew(async () => {
        const { prefix } = contextConfig;
        if (!prefix) return { text: "", tokens: EMPTY_TOKENS };
        const tokens = await codec.encode(prefix);
        return { text: prefix, tokens };
      }),
      dew(async () => {
        const { suffix } = contextConfig;
        if (!suffix) return { text: "", tokens: EMPTY_TOKENS };
        const tokens = await codec.encode(suffix);
        return { text: suffix, tokens };
      })
    ]) as [TokenizedFragment, TokenizedFragment];

    return Object.assign(
      new ContextGroup(
        codec,
        `S:${name}`,
        id ?? uuid.v4(),
        "lore",
        contextConfig,
        prefix,
        suffix
      ),
      { category }
    );
  }

  function isContextGroup<T>(value: T): value is T & ContextGroup {
    return value instanceof ContextGroup;
  }

  function isCategoryGroup<T>(value: T): value is T & CategoryGroup {
    if (!isContextGroup(value)) return false;
    return "category" in value;
  }

  return Object.assign(exports, {
    ContextGroup,
    forCategory,
    isContextGroup,
    isCategoryGroup
  });
});

export default theModule;
export type ContextGroup = InstanceType<ReturnType<typeof theModule>["ContextGroup"]>;
export type CategoryGroup = ContextGroup & { category: CategoryWithSubContext };