import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { assert, assertExists } from "@utils/assert";
import * as IterOps from "@utils/iterables";
import makeCursor from "./cursors/Fragment";
import $CursorOps from "./assemblies/cursorOps";
import $QueryOps from "./assemblies/queryOps";
import $SequenceOps from "./assemblies/sequenceOps";
import $TextSplitterService from "./TextSplitterService";
import $FragmentAssembly from "./FragmentAssembly";
import $ContentAssembly from "./ContentAssembly";

import type { UndefOr } from "@utils/utility-types";
import type { IFragmentAssembly } from "./assemblies/Fragment";
import type { TextFragment } from "./TextSplitterService";
import type { ContinuityOptions } from "./ContentAssembly";
import type { AugmentedTokenCodec, Tokens } from "./TokenizerService";
import type { Cursor } from "./cursors";

export interface DerivedOptions extends ContinuityOptions {
  /** Required when not deriving from another `TokenizedAssembly`. */
  codec?: AugmentedTokenCodec;
  /** The tokens for the derived assembly. */
  tokens?: Tokens;
}

const TOKEN_MENDING_RANGE = 5;

const theModule = usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const { FragmentAssembly } = $FragmentAssembly(require);
  const { ContentAssembly } = $ContentAssembly(require);
  const cursorOps = $CursorOps(require);
  const queryOps = $QueryOps(require);
  const seqOps = $SequenceOps(require);

  // I'm reminded why I absolutely HATE classes...  HATE!  HATE!
  // If the word "hate" were written on every micro-angstrom of my...

  const getTokensForSplit = async (
    codec: AugmentedTokenCodec,
    offset: number,
    tokens: Tokens,
    fullText: string
  ): Promise<[Tokens, Tokens]> => {
    const result = assertExists(
      "Expected to locate the cursor in the tokens.",
      await codec.findOffset(tokens, offset, fullText)
    );

    if (result.type === "double") {
      // We don't need to do anything special in this case because the
      // cursor falls between two sets of tokens.
      const index = result.max.index;
      return [
        tokens.slice(0, index),
        tokens.slice(index)
      ];
    }
    else {
      // In this case, we're splitting a single token into two parts,
      // which means we will need two new tokens, and the ends at the
      // cut could even encode differently.
      const splitToken = result.data.value;
      const left = splitToken.slice(0, result.remainder);
      const right = splitToken.slice(result.remainder);

      const index = result.data.index;
      return Promise.all([
        codec.mendTokens([tokens.slice(0, index), left], TOKEN_MENDING_RANGE),
        codec.mendTokens([right, tokens.slice(index + 1)], TOKEN_MENDING_RANGE)
      ]);
    }
  }

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
      const theDerived = ContentAssembly.fromDerived(
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
      const usedCursor = cursorOps.contentCursorOf(this, cursor, loose);
      if (!usedCursor) return undefined;
      
      const [beforeCut, afterCut] = seqOps.splitAt(this.content, usedCursor);
      const [beforeTokens, afterTokens] = await getTokensForSplit(
        this.#codec,
        cursorOps.toFullText(this, usedCursor).offset,
        this.#tokens,
        this.text
      );

      // If we're splitting this assembly, it doesn't make sense to preserve
      // the suffix on the assembly before the cut or the prefix after the cut.
      // Replace them with empty fragments, as needed.
      const { prefix, suffix } = this;
      const afterPrefix = ss.asEmptyFragment(prefix);
      const beforeSuffix = ss.asEmptyFragment(suffix);

      // Because we're changing the prefix and suffix, we're going to invoke
      // the constructor directly instead of using `fromDerived`.
      return [
        new TokenizedAssembly(
          prefix, beforeCut, beforeSuffix,
          beforeTokens, this.#codec,
          this.isContiguous, this.source
        ),
        new TokenizedAssembly(
          afterPrefix, afterCut, suffix,
          afterTokens, this.#codec,
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
    async asOnlyContent(): Promise<TokenizedAssembly> {
      // No need if we don't have a prefix or suffix.
      if (!queryOps.isAffixed(this)) return this;

      // This can be seen as splitting the prefix and suffix from the rest
      // of the content, so we will want to get tokens for each of these
      // splits we make.

      const { prefix, suffix } = this;

      // Starts with the current tokens and drops the prefix from them.
      const [nextPrefix, noPrefixTokens] = await dew(async () => {
        const tokensIn = this.#tokens;
        if (!prefix.content) return [prefix, tokensIn];

        const ftCursor = cursorOps.toFullText(
          this,
          makeCursor(this, ss.afterFragment(prefix))
        );
        const [, theTokens] = await getTokensForSplit(
          this.#codec,
          ftCursor.offset,
          tokensIn,
          this.text
        );
        return [ss.asEmptyFragment(prefix), theTokens];
      });

      // This must use the tokens from the prefix and adjust the full-text
      // cursor for the now missing prefix portion.
      const [nextSuffix, finalTokens] = await dew(async () => {
        const tokensIn = noPrefixTokens;
        if (!suffix.content) return [suffix, tokensIn];

        const ftCursor = cursorOps.toFullText(
          this,
          makeCursor(this, ss.beforeFragment(suffix))
        );
        const [theTokens] = await getTokensForSplit(
          this.#codec,
          ftCursor.offset - prefix.content.length,
          tokensIn,
          [...this.content, this.suffix].map(ss.asContent).join("")
        );
        return [ss.asEmptyFragment(suffix), theTokens];
      });

      return new TokenizedAssembly(
        nextPrefix, this.content, nextSuffix,
        finalTokens, this.#codec,
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