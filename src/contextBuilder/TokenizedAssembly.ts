import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { assert } from "@utils/assert";
import * as IterOps from "@utils/iterables";
import { chain, toImmutable } from "@utils/iterables";
import $TextSplitterService from "./TextSplitterService";
import $FragmentAssembly from "./FragmentAssembly";
import $ContentAssembly from "./ContentAssembly";

import type { UndefOr } from "@utils/utility-types";
import type { TokenCodec } from "@nai/TokenizerCodec";
import type { ContextConfig } from "@nai/Lorebook";
import type { ContextParams } from "./ParamsService";
import type { TextFragment } from "./TextSplitterService";
import type { FragmentAssembly, FragmentCursor } from "./FragmentAssembly";
import type { ContinuityOptions } from "./ContentAssembly";
import type { Trimmer } from "./TrimmingService";
import type { EncodeResult } from "./TokenizerService";

export interface DerivedOptions extends ContinuityOptions {
  /** The tokens for the derived assembly. */
  tokens?: readonly number[];
}

const theModule = usModule((require, exports) => {
  const splitterService = $TextSplitterService(require);
  const { createFragment, isContiguous } = splitterService;
  const { beforeFragment, afterFragment } = splitterService;
  const { FragmentAssembly, isCursorInside } = $FragmentAssembly(require);
  const { ContentAssembly } = $ContentAssembly(require);

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
      tokens: readonly number[],
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
      /** The token codec or context parameters object. */
      codecSource: TokenCodec | ContextParams,
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

      const tokenCodec
        = "tokenCodec" in codecSource ? codecSource.tokenCodec
        : codecSource;

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
    readonly #tokens: readonly number[];

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
    splitAt(
      /** The cursor demarking the position of the cut. */
      cursor: FragmentCursor,
      /**
       * If `true` and no fragment exists in the assembly for the position,
       * the next best position will be used instead as a fallback.
       */
      loose: boolean = false
    ): UndefOr<[TokenizedAssembly, TokenizedAssembly]> {
      throw new Error("NOT IMPLEMENTED");
    }

    /**
     * Generates a version of this assembly that has no prefix or suffix.
     * 
     * It still has the same source, so cursors for that source will still
     * work as expected.
     */
    asOnlyContent(): TokenizedAssembly {
      // No need if we don't have a prefix or suffix.
      if (!this.isAffixed) return this;

      throw new Error("NOT IMPLEMENTED");
    }
  }

  return Object.assign(exports, {
    TokenizedAssembly
  });
});

export default theModule;
export type TokenizedAssembly = InstanceType<ReturnType<typeof theModule>["TokenizedAssembly"]>;