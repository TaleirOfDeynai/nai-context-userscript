import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { assert, assertExists } from "@utils/assert";
import * as IterOps from "@utils/iterables";
import $QueryOps from "./assemblies/queryOps";
import $TokenOps from "./assemblies/tokenOps";
import $TextSplitterService from "./TextSplitterService";
import $OldFragmentAssembly from "./FragmentAssembly";
import $FragmentAssembly from "./assemblies/Fragment";

import type { UndefOr } from "@utils/utility-types";
import type { TextFragment } from "./TextSplitterService";
import type { ContinuityOptions } from "./assemblies/Fragment";
import type { AugmentedTokenCodec, Tokens } from "./TokenizerService";
import type { IFragmentAssembly } from "./assemblies/_interfaces";
import type { Cursor } from "./cursors";

export interface DerivedOptions extends ContinuityOptions {
  /** Required when not deriving from another `TokenizedAssembly`. */
  codec?: AugmentedTokenCodec;
  /** The tokens for the derived assembly. */
  tokens?: Tokens;
}

const theModule = usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const { FragmentAssembly } = $OldFragmentAssembly(require);
  const fragAssembly = $FragmentAssembly(require);
  const queryOps = $QueryOps(require);
  const tokenOps = $TokenOps(require);

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
  class TokenizedAssembly extends FragmentAssembly {
    constructor(
      prefix: TextFragment,
      content: Iterable<TextFragment>,
      suffix: TextFragment,
      tokens: Tokens,
      codec: AugmentedTokenCodec,
      isContiguous: boolean,
      source: IFragmentAssembly | null
    ) {
      super(prefix, content, suffix, isContiguous, source);
      this.#tokens = tokens;
      this.#codec = codec;
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
    static async fromDerived(
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
      if (fragments instanceof TokenizedAssembly) {
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
        if (originAssembly instanceof TokenizedAssembly) return originAssembly.#codec;
        return assertExists(
          "A codec is required unless deriving from a tokenized assembly.",
          options?.codec
        );
      });

      // Being lazy; this will do all the checks we want done.
      const theDerived = fragAssembly.fromDerived(
        fragments, originAssembly, { assumeContinuity: true }
      );

      const assumeContinuity = options?.assumeContinuity ?? false;
      const tokens = await dew(() => {
        if (options?.tokens) return options.tokens;
        return tokenCodec.encode(theDerived.text);
      });

      const { content } = theDerived;
      return new TokenizedAssembly(
        theDerived.prefix, content, theDerived.suffix,
        IterOps.toImmutable(tokens),
        tokenCodec,
        // We'll assume the derived assembly has the same continuity as
        // its origin assembly.
        assumeContinuity ? queryOps.isContiguous(originAssembly) : ss.isContiguous(content),
        theDerived.source
      );
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
    readonly #codec: AugmentedTokenCodec;

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
        return new TokenizedAssembly(
          a.prefix, a.content, a.suffix,
          a.tokens, this.#codec,
          this.isContiguous, this.source
        );
      }) as [TokenizedAssembly, TokenizedAssembly];
    }

    /**
     * Generates a version of this assembly that has no prefix or suffix.
     * 
     * It still has the same source, so cursors for that source will still
     * work as expected.
     */
    async asOnlyContent(): Promise<TokenizedAssembly> {
      const result = await tokenOps.removeAffix(this, this.#codec);

      // If we're already only-content, `removeAffix` will return its input.
      if (result === this) return this;

      return new TokenizedAssembly(
        result.prefix, result.content, result.suffix,
        result.tokens, this.#codec,
        this.isContiguous, this.source
      );
    }
  }

  return Object.assign(exports, {
    TokenizedAssembly
  });
});

export default theModule;
export type TokenizedAssembly = InstanceType<ReturnType<typeof theModule>["TokenizedAssembly"]>;