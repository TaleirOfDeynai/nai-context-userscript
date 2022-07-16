import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { assert, assertExists } from "@utils/assert";
import { toImmutable } from "@utils/iterables";
import { protoExtend } from "@utils/object";
import $TextSplitterService from "../TextSplitterService";
import $CursorOps from "./cursorOps";
import $ManipOps from "./manipOps";
import $PositionOps from "./positionOps";
import $QueryOps from "./queryOps";
import $TokenOps from "./tokenOps";
import $BaseAssembly from "./Base";
import $FragmentAssembly from "./Fragment";

import type { UndefOr } from "@utils/utility-types";
import type { TextFragment } from "../TextSplitterService";
import type { AugmentedTokenCodec, Tokens } from "../TokenizerService";
import type { TrimType } from "../TrimmingProviders";
import type { ContinuityOptions } from "./Fragment";
import type { Cursor } from "../cursors";
import type { IFragmentAssembly, ITokenizedAssembly } from "./_interfaces";
import type * as PosOps from "./positionOps";

export interface DerivedOptions extends ContinuityOptions {
  /** Required when not deriving from another `TokenizedAssembly`. */
  codec?: AugmentedTokenCodec;
  /** The tokens for the derived assembly. */
  tokens?: Tokens;
}

const theModule = usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const cursorOps = $CursorOps(require);
  const manipOps = $ManipOps(require);
  const posOps = $PositionOps(require);
  const queryOps = $QueryOps(require);
  const tokenOps = $TokenOps(require);
  const { BaseAssembly } = $BaseAssembly(require);
  const fragAssembly = $FragmentAssembly(require);

  /**
   * A class fitting {@link IFragmentAssembly} that provides caching facilities
   * and convenient access to the limited set of operators used for context
   * content sourcing.
   * 
   * It essentially acts as a wrapper around a plain-object assembly.
   */
  class TokenizedAssembly extends BaseAssembly implements ITokenizedAssembly {
    constructor(
      wrapped: ITokenizedAssembly,
      codec: AugmentedTokenCodec,
      isContiguous: boolean
    ) {
      super(wrapped, isContiguous);
      this.#tokens = toImmutable(wrapped.tokens);
      this.#codec = codec;
    }

    /**
     * The array of tokens for the assembly, built from the concatenation
     * of `prefix`, `content`, and `suffix`.
     */
    get tokens() {
      return this.#tokens;
    }
    readonly #tokens: Tokens;

    /** The codec we're using for manipulation. */
    get codec() {
      return this.#codec;
    }
    readonly #codec: AugmentedTokenCodec;

    /** Bound version of {@link cursorOps.isFoundIn}. */
    isFoundIn(cursor: Cursor.Fragment): boolean {
      return cursorOps.isFoundIn(this, cursor);
    }

    /** Bound version of {@link posOps.entryPosition}. */
    entryPosition(
      /** Which direction to iterate. */
      direction: PosOps.IterDirection,
      /** The type of insertion to be done. */
      insertionType?: TrimType
    ): Cursor.Fragment {
      return posOps.entryPosition(this, direction, insertionType);
    }

    /** Bound version of {@link posOps.locateInsertion}. */
    locateInsertion(
      /** The type of insertion being done. */
      insertionType: TrimType,
      /** An object describing how to locate the insertion. */
      positionData: Readonly<PosOps.InsertionPosition>
    ): PosOps.PositionResult {
      return posOps.locateInsertion(this, insertionType, positionData);
    }

    /** Bound version of {@link posOps.shuntOut}. */
    shuntOut(
      /** The cursor defining the location we're being shunt from. */
      cursor: Cursor.Fragment,
      /** The shunt mode to use. */
      mode?: PosOps.IterDirection | "nearest"
    ): PosOps.PositionResult {
      return posOps.shuntOut(this, cursor, mode);
    }

    /** Bound version of {@link tokenOps.splitAt}. */
    async splitAt(
      /** The cursor demarking the position of the cut. */
      cursor: Cursor.Fragment,
      /**
       * If `true` and no fragment exists in the assembly for the position,
       * the next best position will be used instead as a fallback.
       */
      loose: boolean = false
    ): Promise<UndefOr<[TokenizedAssembly, TokenizedAssembly]>> {
      const result = await tokenOps.splitAt(this, this.#codec, cursor, loose);

      return result?.assemblies.map((a) => {
        return new TokenizedAssembly(a, this.#codec, this.isContiguous);
      }) as [TokenizedAssembly, TokenizedAssembly];
    }

    /** Bound version of {@link tokenOps.removeAffix}. */
    async asOnlyContent(): Promise<TokenizedAssembly> {
      const result = await tokenOps.removeAffix(this, this.#codec);

      // If we're already only-content, `removeAffix` will return its input.
      if (result === this) return this;

      return new TokenizedAssembly(result, this.#codec, this.isContiguous);
    }
  }

  /**
   * Checks if the given `assembly` is a {@link TokenizedAssembly}.
   * 
   * Specifically, the class; it may still be an object that fits the
   * interface, but it's not a {@link TokenizedAssembly}.
   */
  function isInstance(assembly: unknown): assembly is TokenizedAssembly {
    return assembly instanceof TokenizedAssembly;
  }

  /** Helper to ensure we have tokens on the assembly. */
  async function asRootAssembly(
    tokenCodec: AugmentedTokenCodec,
    assembly: IFragmentAssembly,
    tokens?: Tokens
  ): Promise<ITokenizedAssembly> {
    tokens = tokens ?? await dew(() => {
      // @ts-ignore - We're checking you dumb piece of shit.
      if ("tokens" in assembly) return assembly.tokens as Tokens;
      return tokenCodec.encode(queryOps.getText(assembly));
    })
    return protoExtend(manipOps.makeSafe(assembly), { tokens });
  }

  /**
   * Converts the given assembly into a {@link TokenizedAssembly}.
   * 
   * A token codec is required, in case a conversion needs to be made;
   * the assembly's text will need to be encoded.
   */
  async function castTo(
    /** The token codec to use when a conversion is needed. */
    tokenCodec: AugmentedTokenCodec,
    /** The assembly to cast. */
    assembly: IFragmentAssembly
  ) {
    if (isInstance(assembly)) return assembly;
    return new TokenizedAssembly(
      await asRootAssembly(tokenCodec, assembly),
      tokenCodec,
      queryOps.isContiguous(assembly)
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
  async function fromDerived(
    /** The fragments making up the derivative's content. */
    fragments: Iterable<TextFragment>,
    /**
     * The assembly whose fragments were used to make the given fragments.
     * This assembly does not need to be a source assembly.
     */
    originAssembly: IFragmentAssembly,
    /** The options for creating a derived assembly. */
    options?: DerivedOptions
  ) {
    // Fast path: the underlying data of `FragmentAssembly` is immutable, so if
    // we're given one, just spit it right back out.
    if (isInstance(fragments)) {
      // But make sure we're still internally consistent.
      assert(
        "Expected the assembly to be related to `originAssembly`.",
        queryOps.checkRelated(fragments, originAssembly)
      );
      assert(
        "Expected the assembly to have identical tokens.",
        dew(() => {
          const gTokens = options?.tokens;
          if (!gTokens) return true;

          const aTokens = fragments.tokens;
          if (aTokens === gTokens) return true;
          if (aTokens.length !== gTokens.length) return false;
          for (let i = 0; i < aTokens.length; i++)
            if (aTokens[i] !== gTokens[i])
              return false;

          return true;
        })
      );
      return fragments;
    }

    const tokenCodec = dew(() => {
      if (isInstance(originAssembly)) return originAssembly.codec;
      return assertExists(
        "A codec is required unless deriving from a tokenized assembly.",
        options?.codec
      );
    });

    const isContiguous = dew(() => {
      // Our assumption is the derived assembly has the same continuity as
      // its origin assembly.
      if (!options?.assumeContinuity) return queryOps.isContiguous(originAssembly);
      // Otherwise, we check off the content.
      return ss.isContiguous(theRoot.content);
    });

    // Being lazy; this will do all the checks we want done.
    const theRoot = await asRootAssembly(
      tokenCodec,
      fragAssembly.fromDerived(fragments, originAssembly, {
        assumeContinuity: true
      }),
      options?.tokens
    );

    return new TokenizedAssembly(theRoot, tokenCodec, isContiguous);
  }

  return Object.assign(exports, {
    isInstance,
    castTo,
    fromDerived
  });
});

export default theModule;

// Perform some TypeScript sorcery to get the class' instance type.
namespace Sorcery {
  type TheModule = ReturnType<typeof theModule>;
  type CastToFn = TheModule["castTo"];
  export type TokenizedAssembly = Awaited<ReturnType<CastToFn>>;
}

export type TokenizedAssembly = Sorcery.TokenizedAssembly;