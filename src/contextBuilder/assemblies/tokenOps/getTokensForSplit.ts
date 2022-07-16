import { assertExists } from "@utils/assert";

import type { AugmentedTokenCodec, Tokens } from "../../TokenizerService";

/**
 * The amount of tokens used for mending when the split occurs inside
 * a single token.  (`5` is a bit overkill, but most of the performance
 * hit is from marshalling the background worker, anyways.)
 */
const TOKEN_MENDING_RANGE = 5;

/** Just an immutable, empty tokens array. */
const EMPTY_TOKENS: Tokens = Object.freeze([]);

/**
 * Splits an array of `tokens` into two.
 * 
 * The `offset` is in characters relative to the string decoded from
 * `tokens`.
 */
export default async function getTokensForSplit(
  /** The token codec to use. */
  codec: AugmentedTokenCodec,
  /** The offset of characters to split at. */
  offset: number,
  /** The tokens array to split. */
  tokens: Tokens,
  /**
   * If available, the decoded text.  If not provided, the text will
   * be decoded from the tokens, which takes a small performance hit.
   */
  decodedText?: string
): Promise<[Tokens, Tokens]> {
  // Fast-path: This is the only case we will allow for an empty split.
  // Naturally, you probably should not even bother.
  if (tokens.length === 0 && offset === 0)
    return [EMPTY_TOKENS, EMPTY_TOKENS];

  const result = assertExists(
    "Expected to locate the offset in the tokens.",
    await codec.findOffset(tokens, offset, decodedText)
  );

  switch (result.type) {
    // Easy cases; one is empty and the other is our given tokens.
    case "before": return [EMPTY_TOKENS, tokens];
    case "after": return [tokens, EMPTY_TOKENS];
    // We don't need to do anything special in this case because the
    // cursor falls between two sets of tokens.
    case "double": {
      const index = result.max.index;
      return [
        tokens.slice(0, index),
        tokens.slice(index)
      ];
    }
    // In this case, we're splitting a single token into two parts,
    // which means we will need two new tokens, and the ends at the
    // cut could even encode differently.
    case "single": {
      const splitToken = result.data.value;
      const left = splitToken.slice(0, result.remainder);
      const right = splitToken.slice(result.remainder);

      const index = result.data.index;
      return Promise.all([
        codec.mendTokens([tokens.slice(0, index), left], TOKEN_MENDING_RANGE),
        codec.mendTokens([right, tokens.slice(index + 1)], TOKEN_MENDING_RANGE)
      ]);
    }
    // @ts-ignore - We'll want to know if this happens.
    default: throw new Error(`Unexpected result type: ${result.type}`);
  }
}