import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { assert } from "@utils/assert";
import UUID from "@nai/UUID";
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
   * A class that represents a sub-context.
   * 
   * Everything in this is implemented pretty lazily and could be optimized
   * better.  Accessing most properties of {@link IFragmentAssembly} will
   * instantiate objects and perform iterations on the sub-assemblies.
   */
  class SubContext
    extends CompoundAssembly
    implements AssemblyLike, ContentLike, SourceLike
  {
    constructor(
      codec: AugmentedTokenCodec,
      identifier: string,
      type: SourceType,
      contextConfig: Readonly<ContextConfig>,
      prefix: TokenizedFragment,
      suffix: TokenizedFragment
    ) {
      super(codec, contextConfig.tokenBudget);

      this.#identifier = identifier;
      this.#type = type;
      this.#contextConfig = contextConfig;
      this.#prefix = prefix;
      this.#suffix = suffix;

      this.#uniqueId = uuid.v4();
    }

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
        super.text,
        this.#suffix.text
      ].join("");
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
      let offset = this.#prefix.text.length;
      return Object.freeze([ss.createFragment(super.text, offset)]);
    }

    get suffix(): TextFragment {
      const offset = this.#prefix.text.length + super.text.length;
      return ss.createFragment(this.#suffix.text, offset);
    }
    readonly #suffix: TokenizedFragment;

    /** A sub-context is always its own source. */
    get source(): this {
      return this;
    }

    /**
     * A sub-context is treated as empty until it has a non-empty assembly
     * inside it, regardless of if its `prefix` or `suffix` have content.
     */
    get isEmpty(): boolean {
      if (this.assemblies.length === 0) return true;
      return this.assemblies.every((asm) => asm.isEmpty);
    }

    /**
     * Implementation of {@link AssemblyLike.adaptCursor}.
     * 
     * This will adapt the cursor to this sub-context's current `text` if
     * the cursor is targeting one of its sub-assemblies.
     * 
     * This cursor is only valid for the current state of the sub-context;
     * if the sub-context is modified, the cursor may point to a different
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
          return makeCursor(this, offset);
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

      // Sub-contexts cannot be inserted into using the same method as normal
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
     * Converts this sub-context into a into a static {@link TokenizedAssembly}.
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
      const { uniqueId: identifier, type } = this;
      if (this.#prefix.text) yield { identifier, type, text: this.#prefix.text };
      yield* super.structuredOutput();
      if (this.#suffix.text) yield { identifier, type, text: this.#suffix.text };
    }

    protected async mendTokens(tokensToMend: Tokens[]): Promise<Tokens> {
      return await super.mendTokens([
        this.#prefix.tokens,
        ...tokensToMend,
        this.#suffix.tokens
      ]);
    }
  }
  /** Creates an empty sub-context for a category. */
  async function forCategory(
    codec: AugmentedTokenCodec,
    category: CategoryWithSubContext
  ): Promise<CategoryContext> {
    const { name, subcontextSettings } = category;
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
      new SubContext(codec, `S:${name}`, "lore", contextConfig, prefix, suffix),
      { category: name }
    );
  };

  return Object.assign(exports, {
    SubContext,
    forCategory
  });
});

export default theModule;
export type SubContext = InstanceType<ReturnType<typeof theModule>["SubContext"]>;
export type CategoryContext = SubContext & { category: string };