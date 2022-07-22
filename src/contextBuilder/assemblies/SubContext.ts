import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import $TextSplitterService from "../TextSplitterService";
import $CursorOps from "./cursorOps";
import $PositionOps from "./positionOps";
import $TokenizedAssembly from "./Tokenized";
import $CompoundAssembly from "./Compound";

import type { TextFragment } from "../TextSplitterService";
import type { TrimType } from "../TrimmingProviders";
import type { AugmentedTokenCodec, Tokens } from "../TokenizerService";
import type { Cursor } from "../cursors";
import type { IFragmentAssembly } from "./_interfaces";
import type { TokenizedAssembly } from "./Tokenized";
import type { AssemblyLike } from "./Compound";
import type { Position, IterDirection, InsertionPosition } from "./positionOps";

interface TokenizedFragment {
  text: string;
  tokens: Tokens;
}

const theModule = usModule((require, exports) => {
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
  class SubContext extends CompoundAssembly implements AssemblyLike {
    constructor(
      codec: AugmentedTokenCodec,
      tokenBudget: number,
      prefix: TokenizedFragment,
      suffix: TokenizedFragment
    ) {
      super(codec, tokenBudget);

      this.#prefix = prefix;
      this.#suffix = suffix;
    }

    get text() {
      return [
        this.#prefix.text,
        super.text,
        this.#suffix.text
      ].join("");
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
     * A sub-context is passed over until it has an assembly inside it,
     * regardless of if its `prefix` or `suffix` have content.
     */
    get isEmpty(): boolean {
      return this.assemblies.length === 0;
    }

    protected async mendTokens(tokensToMend: Tokens[]): Promise<Tokens> {
      return await super.mendTokens([
        this.#prefix.tokens,
        ...tokensToMend,
        this.#suffix.tokens
      ]);
    }

    /** Implementation of {@link AssemblyLike.isRelatedTo}. */
    isRelatedTo(other: IFragmentAssembly): boolean {
      if (other === this) return true;

      for (const asm of this.assemblies)
        if (asm.isRelatedTo(other))
          return true;
      return false;
    }

    /**
     * Implementation of {@link AssemblyLike.isFoundIn}.
     * 
     * Accepts both cursors for this assembly and its sub-assemblies.
     */
    isFoundIn(cursor: Cursor.Fragment): boolean {
      if (cursor.origin === this)
        return cursorOps.isFoundIn(this, cursor);

      for (const asm of this.assemblies)
        if (asm.isRelatedTo(cursor.origin))
          return asm.isFoundIn(cursor);
      return false;
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
  }

  return Object.assign(exports, {
    SubContext
  });
});

export default theModule;
export type SubContext = InstanceType<ReturnType<typeof theModule>["SubContext"]>;