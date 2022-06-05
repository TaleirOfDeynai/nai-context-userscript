import { expect } from "@jest/globals";
import { chain, skip, take } from "@utils/iterables";

import type { AsymmetricMatcher } from "@jest/expect/build/types";
import type { UndefOr } from "@utils/utility-types";
import type { TextFragment } from "@src/contextBuilder/TextSplitterService";

// Our token codec is going to be fairly limited in what it can
// encode.  All tests will only be able to deal with these
// phrases.  Anything unrecognized throws an error.

const encodeMap = new Map<string, number>([
  // 0+ are kinds of whitespace and punctuation.
  [" ", 1],
  ["  ", 2],
  ["\t", 3],
  ["\n", 4],
  [".", 11],
  ["!", 12],
  ["?", 13],
  ["~", 14],
  ["...", 21],
  ["!!!", 22],
  ["???", 23],
  ["~~~", 24],
  // 100+ are forms of encapsulation.
  ["[", 101],
  ["]", 102],
  ["[ ", 111],
  [" ]", 112],
  ["#", 121],
  ["##", 122],
  // 200+ are arrangements of numbers.
  ["1", 201],
  ["2", 202],
  ["3", 203],
  ["11", 211],
  ["22", 212],
  ["33", 213],
  // This gap is intentional.
  ["1111", 231],
  ["2222", 232],
  ["3333", 233],
  // 300+ are foobar.
  ["foo", 301],
  ["bar", 302],
  [" foo", 311],
  [" bar", 312],
  ["foobar", 321],
  [" foobar", 322]
]);

const decodeMap = chain(encodeMap)
  .map(([word, token]) => [token, word] as const)
  .value((iter) => new Map(iter));

/** These methods are async to fit the expected interface. */
export const mockCodec = {
  async encode(text: string): Promise<number[]> {
    let rem = text;
    const tokens: number[] = [];
    // Keep going until we've fully parsed the text.
    while(rem) {
      const bestMatch = chain(encodeMap)
        .filter(([word]) => rem.startsWith(word))
        .reduce(undefined, (best: UndefOr<[string, number]>, kvp) => {
          if (!best) return kvp;
          if (best[0].length > kvp[0].length) return best;
          return kvp;
        });
      if (bestMatch != null) {
        const [word, token] = bestMatch;
        tokens.push(token);
        rem = rem.slice(word.length);
        continue;
      }
      throw new Error(`No encoding at: \`${rem}\``);
    }

    return tokens;
  },
  async decode(tokens: number[]): Promise<string> {
    return chain(tokens)
      .map((token) => {
        const word = decodeMap.get(token);
        if (word != null) return word;
        throw new Error(`No value for token: ${token}`);
      })
      .value((iter) => [...iter].join(""));
  }
};

export function toPrependExpected(
  srcFrags: readonly TextFragment[],
  srcTokens: readonly number[] | string
): Promise<AsymmetricMatcher>;
export function toPrependExpected(
  srcFrags: readonly TextFragment[],
  count: number,
  srcTokens: readonly number[] | string
): Promise<AsymmetricMatcher>;
export async function toPrependExpected(
  srcFrags: readonly TextFragment[],
  ...args: [readonly number[] | string] | [number, readonly number[] | string]
) {
  const count = args.length !== 1 ? args[0] : srcFrags.length;
  const srcTokens = args.length !== 1 ? args[1] : args[0];
  
  const fragments
    = count === srcFrags.length ? srcFrags
    : [...skip(srcFrags, srcFrags.length - count)];
  const tokens
    = Array.isArray(srcTokens) ? srcTokens
    : await mockCodec.encode(srcTokens as string);
  return expect.objectContaining({ fragments, tokens, resume: expect.any(Object) });
}

export function toAppendExpected(
  srcFrags: readonly TextFragment[],
  srcTokens: readonly number[] | string
): Promise<AsymmetricMatcher>;
export function toAppendExpected(
  srcFrags: readonly TextFragment[],
  count: number,
  srcTokens: readonly number[] | string
): Promise<AsymmetricMatcher>;
export async function toAppendExpected(
  srcFrags: readonly TextFragment[],
  ...args: [readonly number[] | string] | [number, readonly number[] | string]
) {
  const count = args.length !== 1 ? args[0] : srcFrags.length;
  const srcTokens = args.length !== 1 ? args[1] : args[0];
  
  const fragments
    = count === srcFrags.length ? srcFrags
    : [...take(srcFrags, count)];
  const tokens
    = Array.isArray(srcTokens) ? srcTokens
    : await mockCodec.encode(srcTokens as string);
  return expect.objectContaining({ fragments, tokens, resume: expect.any(Object) });
}