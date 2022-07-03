import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { assert, assertExists } from "@utils/assert";
import * as IterOps from "@utils/iterables";
import { toImmutable } from "@utils/iterables";
import $TextSplitterService from "./TextSplitterService";
import $TokenizerService from "./TokenizerService";
import $FragmentAssembly from "./FragmentAssembly";
import $ContentAssembly from "./ContentAssembly";

import type { UndefOr } from "@utils/utility-types";
import type { TokenCodec } from "@nai/TokenizerCodec";
import type { TextFragment } from "./TextSplitterService";
import type { FragmentAssembly, FragmentCursor } from "./FragmentAssembly";
import type { ContinuityOptions } from "./ContentAssembly";
import type { Tokens } from "./TokenizerService";

export interface DerivedOptions extends ContinuityOptions {
  /** Required when not deriving from another `TokenizedAssembly`. */
  codec?: TokenCodec;
  /** The tokens for the derived assembly. */
  tokens?: Tokens;
}

const TOKEN_MENDING_RANGE = 5;

const theModule = usModule((require, exports) => {
  const splitterService = $TextSplitterService(require);
  const { createFragment, isContiguous } = splitterService;
  const { beforeFragment, afterFragment } = splitterService;
  const { FragmentAssembly, splitSequenceAt, makeCursor } = $FragmentAssembly(require);
  const { ContentAssembly } = $ContentAssembly(require);
  const { tokensOfOffset, mendTokens } = $TokenizerService(require);

  // I'm reminded why I absolutely HATE classes...  HATE!  HATE!
  // If the word "hate" were written on every micro-angstrom of my...

  const getTokensForSplit = async (
    codec: TokenCodec,
    offset: number,
    tokens: Tokens
  ): Promise<[Tokens, Tokens]> => {
    const result = assertExists(
      "Expected to locate the cursor in the tokens.",
      await tokensOfOffset(codec, tokens, offset)
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
      const mendingFn = mendTokens(codec, TOKEN_MENDING_RANGE);
      return Promise.all([
        mendingFn(tokens.slice(0, index), left),
        mendingFn(right, tokens.slice(index + 1))
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
      codec: TokenCodec,
      isContiguous: boolean,
      source: FragmentAssembly | null
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
      originAssembly: FragmentAssembly,
      /** The options for creating a derived assembly. */
      options?: DerivedOptions
    ) {
      // Fast path: the underlying data of `FragmentAssembly` is immutable, so if
      // we're given one, just spit it right back out.
      if (fragments instanceof TokenizedAssembly) {
        // But make sure we're still internally consistent.
        assert(
          "Expected the assembly to be related to `originAssembly`.",
          TokenizedAssembly.checkRelated(fragments, originAssembly)
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
        return tokenCodec.encode(theDerived.fullText);
      });

      const { content } = theDerived;
      return new TokenizedAssembly(
        theDerived.prefix, content, theDerived.suffix,
        IterOps.toImmutable(tokens),
        tokenCodec,
        // We'll assume the derived assembly has the same continuity as
        // its origin assembly.
        assumeContinuity ? originAssembly.isContiguous : isContiguous(content),
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
    readonly #codec: TokenCodec;

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
      cursor: FragmentCursor,
      /**
       * If `true` and no fragment exists in the assembly for the position,
       * the next best position will be used instead as a fallback.
       */
      loose: boolean = false
    ): Promise<UndefOr<[TokenizedAssembly, TokenizedAssembly]>> {
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
      
      const [beforeCut, afterCut] = splitSequenceAt(this.content, usedCursor);
      const [beforeTokens, afterTokens] = await getTokensForSplit(
        this.#codec,
        this.toFullText(usedCursor).offset,
        this.#tokens
      );

      // If we're splitting this assembly, it doesn't make sense to preserve
      // the suffix on the assembly before the cut or the prefix after the cut.
      // Replace them with empty fragments, as needed.
      const { prefix, suffix } = this;
      const afterPrefix = !prefix.content ? prefix : createFragment("", 0, prefix);
      const beforeSuffix = !suffix.content ? suffix : createFragment("", 0, suffix);

      // Because we're changing the prefix and suffix, we're going to invoke
      // the constructor directly instead of using `fromDerived`.
      return [
        new TokenizedAssembly(
          prefix, toImmutable(beforeCut), beforeSuffix,
          beforeTokens, this.#codec,
          this.isContiguous, this.source
        ),
        new TokenizedAssembly(
          afterPrefix, toImmutable(afterCut), suffix,
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
      if (!this.isAffixed) return this;

      // This can be seen as splitting the prefix and suffix from the rest
      // of the content, so we will want to get tokens for each of these
      // splits we make.

      const { prefix, suffix } = this;

      // Starts with the current tokens and drops the prefix from them.
      const [nextPrefix, noPrefixTokens] = await dew(async () => {
        const tokensIn = this.#tokens;
        if (!prefix.content) return [prefix, tokensIn];

        const ftCursor = this.toFullText(makeCursor(this, afterFragment(prefix)));
        const [, theTokens] = await getTokensForSplit(
          this.#codec,
          ftCursor.offset,
          tokensIn
        );
        return [createFragment("", 0, prefix), theTokens];
      });

      // This must use the tokens from the prefix and adjust the full-text
      // cursor for the now missing prefix portion.
      const [nextSuffix, finalTokens] = await dew(async () => {
        const tokensIn = noPrefixTokens;
        if (!suffix.content) return [suffix, tokensIn];

        const ftCursor = this.toFullText(makeCursor(this, beforeFragment(suffix)));
        const [theTokens] = await getTokensForSplit(
          this.#codec,
          ftCursor.offset - prefix.content.length,
          tokensIn
        );
        return [createFragment("", 0, suffix), theTokens];
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