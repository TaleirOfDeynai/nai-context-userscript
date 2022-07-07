import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { assert } from "@utils/assert";
import { isArray, isFunction, isObject } from "@utils/is";
import { defer, future } from "@utils/functions";
import { chain, buffer, last, skipRight, toImmutable } from "@utils/iterables";
import { createLogger } from "@utils/logging";
import $TokenizerCodec from "@nai/TokenizerCodec";
import $TextSplitterService from "./TextSplitterService";

import type { UndefOr } from "@utils/utility-types";
import type { Deferred, Future } from "@utils/functions";
import type { TokenCodec as AsyncTokenCodec } from "@nai/TokenizerCodec";
import type { TokenizerTypes } from "@nai/TokenizerHelpers";
import type { TextOrFragment, TextFragment } from "./TextSplitterService";

export interface SyncTokenCodec {
  encode(text: string): number[];
  decode(tokens: number[]): string;
}

export type SomeTokenCodec = AsyncTokenCodec | SyncTokenCodec;
export type TokenCodec = AsyncTokenCodec;
export type Tokens = readonly number[];

export interface ResumeData {
  readonly type: "append" | "prepend";
  /**
   * The number of tokens in {@link EncodeResult.tokens} considered safe.
   * 
   * These will be sliced off by the {@link StreamEncodeFn}, either
   * `prependEncoder` or `appendEncoder`.
   */
  readonly safeCount: number;
  /** The tokens to append or prepend to {@link EncodeResult.tokens}. */
  readonly unsafeTokens: Tokens;
}

export interface EncodeResult {
  /** The fragments this result contains (excluding prefix/suffix). */
  readonly fragments: readonly TextFragment[];
  /** The tokens, with prefix/suffix. */
  readonly tokens: Tokens;
  /**
   * The data needed to resume encoding, when used as the
   * {@link StreamEncodeOptions.seedResult seedResult}.
   */ 
  readonly resume: ResumeData;
}

export interface StreamEncodeOptions {
  /** A string to be prepended to each intermediate result. */
  prefix?: string;
  /** A string to be appended to each intermediate result. */
  suffix?: string;
  /** A previous result to continue from. */
  seedResult?: EncodeResult;
  /** How many tokens to set aside as unverified between encodings. */
  bufferSize?: number;
}

export interface StreamEncodeFn {
  (
    /** The {@link TokenCodec} to use for token encode/decode. */
    codec: AugmentedTokenCodec,
    /**
     * An iterable containing the text fragments to encode.
     * As this is a prepend encoder, these fragments should be provided
     * in reversed order.
     */
    toEncode: Iterable<TextFragment>,
    /** Options used to setup the encoder. */
    options?: StreamEncodeOptions
  ): AsyncIterable<EncodeResult>
}

export interface TokenData {
  index: number;
  token: number;
  value: string;
}

namespace TokenOffset {
  interface Single {
    type: "single";
    /** The data of the token. */
    data: TokenData;
    /** How many characters into `data.value` the original offset resides. */
    remainder: number;
  }
  
  interface Double {
    type: "double";
    /** The data of the token before the offset. */
    min: TokenData;
    /** The data of the token after the offset. */
    max: TokenData;
    /** There is no dangling offset. */
    remainder: 0;
  }
  
  export type Result = Single | Double;
}

export type TokenOffsetResult = TokenOffset.Result;

export interface AugmentedTokenCodec extends AsyncTokenCodec {
  mendTokens(
    /** The sections of tokens and strings to be mended together. */
    inputSections: Array<Tokens | TextOrFragment>,
    /** How many tokens at mending boundaries to re-encode. */
    bufferSize?: number
  ): Promise<Tokens>;

  /**
   * Searches the given `tokens` to locate a range of indices in `tokens`
   * that contains the cursor at some `offset` number of characters.
   * 
   * It returns a range, since the offset could lie between two tokens.
   * If it does not, both elements of the returned array will be equal.
   * 
   * @todo Investigate if a binary search would be more efficient.
   */
  findOffset(
    /** The array of tokens to search. */
    tokens: Tokens,
    /** The character offset to locate. */
    offset: number
  ): Promise<UndefOr<TokenOffsetResult>>;
}

type ResumeTuple = [
  /** The tokens considered unstable. */
  wilderness: Tokens,
  /** The tokens considered stable. */
  safeHouse: Tokens,
  /** The fragments encoded thus far. */
  encoded: readonly TextFragment[]
];

const UNSAFE_TOKEN_BUFFER = 10;

const $$MarkOfAugmentation = Symbol("TokenizerService.tokenCodec");

export default usModule((require, exports) => {
  const tokenizerCodec = require($TokenizerCodec);
  const textSplitter = $TextSplitterService(require);

  const logger = createLogger("TokenizerService");

  // NovelAI's token codecs have a bit of a problem that makes handling
  // them efficiently challenging: they only work discretely.  You give
  // it a string, you get tokens.
  //
  // Now, consider the following:
  // You have three strings, `["foo", " ", "bar"]`, and you need to
  // yield the tokens for a concatenated string under a budget.
  //
  // If you take a naive approach, you could tokenize each string:
  // `[[21943], [220], [5657]]`
  // And see you should have three tokens when they're concatenated.
  // In reality, you'll end up with two.
  // `[21943, 2318]`
  //
  // What happened is it tokenized them like `["foo", " bar"]`, combining
  // the whitespace with the word following it.  It has a lot of combined
  // tokens like this that essentially require you to check each permutation
  // that is under your budget until you go over it, as in:
  // - Is "foo" over budget?
  // - Is "foo " over budget?
  // - Is "foo bar" over budget?
  //
  // This kinda sucks, so lets turn the discrete token codec into an async
  // iterable that only does as much work as is needed.
  //
  // We're going to have a concept of "safe" tokens and "unverified" tokens.
  // Unverified tokens are those from a text fragment that was just ingested
  // and close to the end of the string.  They get upgraded to safe tokens
  // when we ingest the next fragment and make sure the interface between
  // the two fragments is stable.
  //
  // We do that by taking the last 10-ish tokens from the end of the
  // previous fragment, decoding them back into a string, tacking them on
  // to the start of the next fragment, encoding it, and then all but the
  // last 10-ish tokens from this fragment are considered safe.


  /**
   * Creates a function that can mend together token arrays, strings, and
   * {@link TextFragment text fragments} into a single, uniform token array.
   */
  const makeMendTokens = (
    encode: TokenCodec["encode"],
    decode: TokenCodec["decode"]
  ) => {
    type Section = string | Tokens;
    type TokensFuture = Future<Tokens> & { isNew: boolean };

    /** To reduce object instantiations. */
    const NO_TOKENS: Tokens = Object.freeze([]);

    const isTokens = isArray as (v: Tokens | TextOrFragment) => v is Tokens;
    const isLengthy = (v: Section) => v.length > 0;
    const toDecoded = (v: Section) => isTokens(v) ? decode(v as any) : v;

    // We're going to be lazy; when doing assembly and inserting new tokens
    // into the context's token array, rather than try and figure out which
    // tokens were unaffected and which need mending, we're just going throw
    // all the tokens back into `mendTokens`.  When it's mending two pairs
    // of token arrays together, it can check to see if it's done that pair
    // before and pull from cache if so.
    const binaryCache = new Map<string, TokensFuture>();
    
    /** For mending pairs of tokens, this will draw from the cache. */
    const getBinaryFuture = (v: Section[]): UndefOr<TokensFuture> => {
      if (v.length !== 2 || !v.every(isTokens)) return undefined;
      const key = JSON.stringify(v);

      let theFuture = binaryCache.get(key);
      if (theFuture) {
        theFuture.isNew = false;
        return theFuture;
      }

      theFuture = Object.assign(future<Tokens>(), { isNew: true });
      binaryCache.set(key, theFuture);
      return theFuture;
    };

    /** Splits the leading tokens into safe and unsafe portions. */
    const leadingTokens = (bufferSize: number, tokens: Tokens): [Tokens, Tokens] => {
      if (tokens.length === 0) return [tokens, tokens];

      const left = tokens.slice(0, -bufferSize);
      const right = tokens.slice(-bufferSize);
      return [left, right];
    };

    /** Splits the trailing tokens into unsafe and safe portions. */
    const trailingTokens = (bufferSize: number, tokens: Tokens): [Tokens, Tokens] => {
      if (tokens.length === 0) return [tokens, tokens];

      const left = tokens.slice(0, bufferSize);
      const right = tokens.slice(bufferSize);
      return [left, right];
    };

    const doMending = async (
      /** How many tokens at mending boundaries to re-encode. */
      bufferSize: number,
      /** All the tokens we have encoded up to this point. */
      prevTokens: Tokens,
      /** The sections to be mended. */
      sections: Section[]
    ) => {
      // Be aware: this is a private function and `boundMendTokens`
      // will have filtered out empty sections for it.  No need to
      // check for those.

      // We need at least one section.
      const lastSection = last(sections);
      if (!lastSection) return prevTokens;

      // Fast-path: With empty `prevTokens`, no need to mend when
      // we only have one element in `sections`.
      if (!prevTokens.length && sections.length === 1) {
        // Clone the tokens if needed and just use them directly.
        if (isTokens(lastSection)) return toImmutable(lastSection);
        // We just need to do an `encode` on a single string.
        return await encode(lastSection);
      }

      // We need to figure out what is going to be involved in the
      // mend and what is not.  We do not need to do an expensive
      // re-encoding when we can use just decode a smaller section
      // of tokens and encode that smaller portion instead.
      const [tokensBefore, leading] = leadingTokens(bufferSize, prevTokens);
      // We need to handle the case that the last element was a string.
      const [trailing, tokensAfter]
        = isTokens(lastSection) ? trailingTokens(bufferSize, lastSection)
        : [lastSection, NO_TOKENS];
      // `trailing` already has the contribution from the last section,
      // so we'll use `skipRight` to remove it and get the sections
      // in between.
      const between = skipRight(sections, 1);

      // Because `prevTokens` could have been empty, we do still have
      // to filter empty items.  This doubles as a sanity check too.
      const theSections = [leading, ...between, trailing].filter(isLengthy);

      // If this is just mending two token arrays, let's see if we have
      // stored a result for this one already.  If we get one and it
      // isn't new, we'll use it.  Otherwise, we will need to do the
      // mend during this call, and potentially fulfill it.
      const maybeBinary = getBinaryFuture(theSections);
      if (maybeBinary?.isNew === false) {
        const fromCache = await maybeBinary.promise;
        return [...tokensBefore, ...fromCache, ...tokensAfter];
      }
      
      try {
        // Decode as needed, then encode.
        const theText = await Promise.all(theSections.map(toDecoded));
        const tokensMended = await encode(theText.join(""));

        // Resolve the binary future if we need to.
        maybeBinary?.resolve(Object.freeze(tokensMended));

        // And rejoin the split tokens back into the re-encoded portion.
        return [...tokensBefore, ...tokensMended, ...tokensAfter];
      }
      catch (err) {
        // Just in case the error happened during the re-join above.
        if (maybeBinary?.isFulfilled === false) maybeBinary.reject(err);
        throw err;
      }
    };

    /**
     * Given any arrangement of token arrays, strings, and
     * {@link TextFragment text fragments}, re-encodes everything into a
     * single, uniform array of tokens as efficiently as possible.
     */
    const boundMendTokens = async (
      /** The sections of tokens and strings to be mended together. */
      inputSections: Array<Tokens | TextOrFragment>,
      bufferSize: number = UNSAFE_TOKEN_BUFFER
    ): Promise<Tokens> => {
      // Get everything into either an array of tokens or a string.
      // While we're at it, drop any empty sections; no reason to bother.
      const sections = inputSections
        .map((v) => isTokens(v) ? v : textSplitter.asContent(v))
        .filter(isLengthy);

      // Fast-path: If empty, our result is also empty.
      if (sections.length === 0) return NO_TOKENS;

      // Fast-path: If we have only one thing, we just make sure its tokens.
      if (sections.length === 1) {
        const [section] = sections;
        if (isTokens(section)) return toImmutable(section);
        return Object.freeze(await encode(section));
      }

      // We want to process things in chunks, each containing zero-or-more
      // strings and ended by an array of tokens (possibly; there is nothing
      // that says the final element can't be a string).
      let prevTokens = NO_TOKENS;
      for (const bufSections of buffer(sections, isTokens))
        prevTokens = await doMending(bufferSize, prevTokens, bufSections);
      
      return toImmutable(prevTokens);
    };

    return boundMendTokens;
  };

  const makeFindOffset = (decode: TokenCodec["decode"]) => {
    const theCache = new Map<number, Promise<string>>();

    /**
     * Gets the translated string for a single token.  This uses a cache
     * that is reset after a context is generated.
     */
    const getTokenString = (
      /** The token to translate. */
      token: number
    ): Promise<string> => {
      let result = theCache.get(token);
      if (!result) {
        result = decode([token]);
        theCache.set(token, result);
      }
      return result;
    };

    return async (
      /** The array of tokens to search. */
      tokens: Tokens,
      /** The character offset to locate. */
      offset: number
    ): Promise<UndefOr<TokenOffsetResult>> => {
      if (!tokens.length) return undefined;
  
      // Hopefully this won't be too rough with our tokenizer optimizations.
      // A decode should be quite quick, but this is potentially several
      // hundred decodes all at once.
      const tokenTable = await chain(new Set(tokens))
        .map(async (token) => [token, await getTokenString(token)] as const)
        .value(async (promises) => new Map(await Promise.all([...promises])));
      
      let curOffset = 0;
      let result = [] as number[];
  
      for (let i = 0, len = tokens.length; i < len; i++) {
        if (result.length === 2) break;
        if (offset < curOffset) break;
  
        const token = tokens[i];
        const value = tokenTable.get(token) as string;
        curOffset += value.length;
  
        if (offset > curOffset) continue;
        result.push(i);
      }
  
      const getData = (index: number): TokenData => {
        const token = tokens[index];
        const value = tokenTable.get(token) as string;
        return { index, token, value };
      };
  
      switch (result.length) {
        case 2: {
          const min = getData(result[0]);
          const max = getData(result[1]);
          return { type: "double", min, max, remainder: 0 };
        }
        case 1: {
          const data = getData(result[0]);
          const remainder = data.value.length - (curOffset - offset);
          return { type: "single", data, remainder };
        }
        default: return undefined;
      }
    };
  };

  const bootstrapPrepend = async (
    codec: AsyncTokenCodec,
    seedResult: UndefOr<EncodeResult>,
    suffix: string
  ): Promise<ResumeTuple> => {
    // With a seed result, we can unpack the data.
    if (seedResult) {
      const { type, safeCount, unsafeTokens } = seedResult.resume;
      assert("Seed result cannot resume a prepend.", type === "prepend");
      return [
        unsafeTokens,
        // We want the last of `tokens` for a prepend.
        seedResult.tokens.slice(-safeCount),
        seedResult.fragments
      ];
    }

    // If we have a suffix, we'll prime the unverified tokens with it.
    if (suffix) return [await codec.encode(suffix), [], []];

    // Otherwise, we start fresh.
    return [[], [], []];
  };

  /**
   * An encoder that takes an iterable of {@link TextFragment} and provides
   * an asynchronous iterable that will encode the next meaningful chunk of
   * tokens and yield an intermediate result, prepended to the last result.
   * 
   * It abstracts away a lot tedium related to the token codecs and avoids
   * pitfalls in how the tokenizer may combine tokens differently from one
   * encoding to the next, while minimizing time spent encoding and decoding.
   * 
   * Each time the iterator needs to produce a new result, it does more work,
   * so only request as many values as you need.
   */
  async function* prependEncoder(
    /** The {@link TokenCodec} to use for token encode/decode. */
    codec: AugmentedTokenCodec,
    /**
     * An iterable containing the text fragments to encode.
     * As this is a prepend encoder, these fragments should be provided
     * in reversed order.
     */
    toEncode: Iterable<TextFragment>,
    /** Options used to setup the encoder. */
    options?: StreamEncodeOptions
  ): AsyncIterable<EncodeResult> {
    const prefix = options?.prefix ?? "";
    const suffix = options?.suffix ?? "";
    const seedResult = options?.seedResult;
    const bufferSize = options?.bufferSize ?? UNSAFE_TOKEN_BUFFER;

    let [wilderness, safeHouse, encoded] = await bootstrapPrepend(
      codec, seedResult, suffix
    );

    const fragmentBuffers = chain(toEncode)
      .thru((frags) => buffer(frags, textSplitter.hasWords))
      .map((bufParts) => bufParts.reverse())
      .value();

    for (const theBuffer of fragmentBuffers) {
      // We want to include unverified tokens, in case they change.
      const toPrepend = await codec.mendTokens([...theBuffer, wilderness], bufferSize);

      // Prepare the result for this encoding before updating our state.
      const fragments = Object.freeze([...theBuffer, ...encoded]);
      const tokens = await codec.mendTokens([prefix, [...toPrepend, ...safeHouse]], bufferSize);

      // The first `bufferSize` tokens are considered unverified.
      wilderness = Object.freeze(toPrepend.slice(0, bufferSize));
      // And anything afterwards is now considered verified.
      safeHouse = [...toPrepend.slice(bufferSize), ...safeHouse];
      encoded = fragments;

      const resume = Object.freeze({
        type: "prepend",
        safeCount: safeHouse.length,
        unsafeTokens: wilderness
      });

      yield Object.freeze({ fragments, tokens, resume });
    }
  }

  const bootstrapAppend = async (
    codec: AsyncTokenCodec,
    seedResult: UndefOr<EncodeResult>,
    prefix: string
  ): Promise<ResumeTuple> => {
    // With a seed result, we can unpack the data.
    if (seedResult) {
      const { type, safeCount, unsafeTokens } = seedResult.resume;
      assert("Seed result cannot resume an append.", type === "append");
      return [
        unsafeTokens,
        // We want the first of `tokens` for an append.
        seedResult.tokens.slice(0, safeCount),
        seedResult.fragments
      ];
    }

    // If we have a prefix, we'll prime the unverified tokens with it.
    if (prefix) return [await codec.encode(prefix), [], []];

    // Otherwise, we start fresh.
    return [[], [], []];
  };

  /**
   * An encoder that takes an iterable of {@link TextFragment} and provides
   * an asynchronous iterable that will encode the next meaningful chunk of
   * tokens and yield an intermediate result, appended to the last result.
   * 
   * It abstracts away a lot tedium related to the token codecs and avoids
   * pitfalls in how the tokenizer may combine tokens differently from one
   * encoding to the next, while minimizing time spent encoding and decoding.
   * 
   * Each time the iterator needs to produce a new result, it does more work,
   * so only request as many values as you need.
   */
  async function* appendEncoder(
    /** The {@link TokenCodec} to use for token encode/decode. */
    codec: AugmentedTokenCodec,
    /** An iterable containing the text fragments to encode. */
    toEncode: Iterable<TextFragment>,
    /** Options used to setup the encoder. */
    options?: StreamEncodeOptions
  ): AsyncIterable<EncodeResult> {
    const prefix = options?.prefix ?? "";
    const suffix = options?.suffix ?? "";
    const seedResult = options?.seedResult;
    const bufferSize = options?.bufferSize ?? UNSAFE_TOKEN_BUFFER;

    let [wilderness, safeHouse, encoded] = await bootstrapAppend(
      codec, seedResult, prefix
    );

    const fragmentBuffers = chain(toEncode)
      .thru((frags) => buffer(frags, textSplitter.hasWords))
      .value();

    for (const theBuffer of fragmentBuffers) {
      // We want to include unverified tokens, in case they change.
      const toAppend = await codec.mendTokens([wilderness, ...theBuffer], bufferSize);

      // Prepare the result for this encoding before updating our state.
      const fragments = Object.freeze([...encoded, ...theBuffer]);
      const tokens =  await codec.mendTokens([[...safeHouse, ...toAppend], suffix], bufferSize);

      // The last `bufferSize` tokens are considered unverified.
      wilderness = Object.freeze(toAppend.slice(-bufferSize));
      // And anything before that is now considered verified.
      safeHouse = [...safeHouse, ...toAppend.slice(0, -bufferSize)];
      encoded = fragments;

      const resume = Object.freeze({
        type: "append",
        safeCount: safeHouse.length,
        unsafeTokens: wilderness
      });

      yield Object.freeze({ fragments, tokens, resume });
    }
  }

  /** Checks if `value` satisfies the {@link SomeTokenCodec} interface. */
  const isCodec = (value: any): value is SomeTokenCodec => {
    if (!isObject(value)) return false;
    if (!("encode" in value)) return false;
    if (!("decode" in value)) return false;
    if (!isFunction(value.encode)) return false;
    if (!isFunction(value.decode)) return false;
    return true;
  };

  /**
   * Ensures `givenCodec` is a codec and wraps it to ensure it corresponds
   * to an {@link AsyncTokenCodec}. Otherwise, it returns an appropriate
   * global codec instance.
   */
  const getCodec = (type: TokenizerTypes, givenCodec?: SomeTokenCodec): TokenCodec => {
    // Wrap in a try/catch in case it is synchronous.
    if (isCodec(givenCodec)) return {
      encode: (text) => {
        try { return Promise.resolve(givenCodec.encode(text)); }
        catch (err) { return Promise.reject(err); }
      },
      decode: (tokens) => {
        try { return Promise.resolve(givenCodec.decode(tokens)); }
        catch (err) { return Promise.reject(err); }
      }
    };

    // NovelAI keeps instantiating a new class for the global encoder, but it
    // seems to work fine (and is much faster) reusing an instance so.
    const globalEncoder = new tokenizerCodec.GlobalEncoder();
    return {
      encode: (text) => globalEncoder.encode(text, type),
      decode: (tokens) => globalEncoder.decode(tokens, type)
    };
  };

  /**
   * Augments the given codec with a few additional methods.
   * 
   * It also wraps the given `codec` in a task runner that will run three
   * encode/decode tasks concurrently and buffer any more than that,
   * favoring executing the latest task before older tasks.
   * 
   * This will hopefully utilize both the background worker and main thread
   * more efficiently, keeping the worker saturated and the main thread
   * unblocked (as much as is reasonable).
   * 
   * The task management would be better placed into the actual background
   * worker, since a task-runner on the main thread can only actually advance
   * the worker's jobs after the current event loop ends...  But it will
   * still be better than no management at all.
   */
  const augmentCodec = (codec: TokenCodec): AugmentedTokenCodec => {
    // @ts-ignore - Preventing double augmentation.
    if (codec[$$MarkOfAugmentation] === true) return codec;

    const jobSubject = new rx.Subject<Deferred<string| number[]>>();

    // This will execute deferred tasks as appropriate.
    jobSubject.pipe(rxop.taskRunner((v) => v.execute(), 3)).subscribe(rx.noop);

    const encode = (text: string) => {
      const def = defer(() => codec.encode(text));
      jobSubject.next(def);
      return def.promise;
    };

    const decode = (tokens: number[]) => {
      const def = defer(() => codec.decode(tokens));
      jobSubject.next(def);
      return def.promise;
    };

    const mendTokens = makeMendTokens(encode, decode);
    const findOffset = makeFindOffset(decode);

    return {
      encode,
      decode,
      mendTokens: logger.measureFn(mendTokens, "mendTokens"),
      findOffset: logger.measureFn(findOffset, "findOffset"),
      // @ts-ignore - Don't care.  Doing it anyways.
      [$$MarkOfAugmentation]: true
    };
  };

  /**
   * Provides a codec of the given `tokenizerType`.  If `givenCodec` is
   * provided, it will be checked to make sure it follows the interface
   * and will be used instead of the global codec, if so.
   */
  function codecFor(tokenizerType: TokenizerTypes, givenCodec?: SomeTokenCodec) {
    const codec = getCodec(tokenizerType, givenCodec);
    return augmentCodec(codec);
  }

  return Object.assign(exports, {
    isCodec,
    codecFor,
    prependEncoder,
    appendEncoder
  });
});