import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { isFunction, isObject } from "@utils/is";
import { defer } from "@utils/functions";
import { chain, buffer } from "@utils/iterables";
import $TokenizerCodec from "@nai/TokenizerCodec";
import $TextSplitterService from "./TextSplitterService";

import type { Deferred } from "@utils/functions";
import type { TokenCodec as AsyncTokenCodec } from "@nai/TokenizerCodec";
import type { TokenizerTypes } from "@nai/TokenizerHelpers";
import type { TextFragment } from "./TextSplitterService";
import { assert } from "@utils/assert";
import { UndefOr } from "@utils/utility-types";


export interface SyncTokenCodec {
  encode(text: string): number[];
  decode(tokens: number[]): string;
}

export type SomeTokenCodec = AsyncTokenCodec | SyncTokenCodec;
export type TokenCodec = AsyncTokenCodec;

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
  readonly unsafeTokens: readonly number[];
}

export interface EncodeResult {
  /** The fragments this result contains (excluding prefix/suffix). */
  readonly fragments: readonly TextFragment[];
  /** The tokens, with prefix/suffix. */
  readonly tokens: readonly number[];
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
    codec: TokenCodec,
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

type ResumeTuple = [
  /** The tokens considered unstable. */
  wilderness: readonly number[],
  /** The tokens considered stable. */
  safeHouse: readonly number[],
  /** The fragments encoded thus far. */
  encoded: readonly TextFragment[]
];

const UNSAFE_TOKEN_BUFFER = 10;

export default usModule((require, exports) => {
  const tokenizerCodec = require($TokenizerCodec);
  const textSplitter = $TextSplitterService(require);

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
    codec: TokenCodec,
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
      const boundary = await codec.decode([...wilderness]);
      const fullText = [...theBuffer.map(textSplitter.asContent), boundary].join("");
      const theTokens = await codec.encode(fullText);

      // Prepare the result for this encoding before updating our state.
      const fragments = Object.freeze([...theBuffer, ...encoded]);
      const tokens = await dew(async () => {
        // Without a prefix, this is easy.
        if (!prefix) return Object.freeze([...theTokens, ...safeHouse]);

        // But with a prefix, we have to do one more cycle to tack it on the beginning.
        const theStart = await codec.decode(theTokens.slice(0, bufferSize));
        const withPrefix = await codec.encode(`${prefix}${theStart}`);
        return Object.freeze([...withPrefix, ...theTokens.slice(bufferSize), ...safeHouse]);
      });

      // The first `bufferSize` tokens are considered unverified.
      wilderness = Object.freeze(theTokens.slice(0, bufferSize));
      // And anything afterwards is now considered verified.
      safeHouse = [...theTokens.slice(bufferSize), ...safeHouse];
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
    codec: TokenCodec,
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
      const boundary = wilderness.length ? await codec.decode([...wilderness]) : "";
      const fullText = [boundary, ...theBuffer.map(textSplitter.asContent)].join("");
      const theTokens = await codec.encode(fullText);

      // Prepare the result for this encoding before updating our state.
      const fragments = Object.freeze([...encoded, ...theBuffer]);
      const tokens = await dew(async () => {
        // Without a suffix, this is easy.
        if (!suffix) return Object.freeze([...safeHouse, ...theTokens]);

        // But with a suffix, we have to do one more cycle to tack it on the end.
        const theEnd = await codec.decode(theTokens.slice(-bufferSize));
        const withSuffix = await codec.encode(`${theEnd}${suffix}`);
        return Object.freeze([...safeHouse, ...theTokens.slice(0, -bufferSize), ...withSuffix]);
      });

      // The last `bufferSize` tokens are considered unverified.
      wilderness = Object.freeze(theTokens.slice(-bufferSize));
      // And anything before that is now considered verified.
      safeHouse = [...safeHouse, ...theTokens.slice(0, -bufferSize)];
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
   * Ensures `givenCodec` is a codec, or returns an appropriate global
   * codec instance.
   */
  const getCodec = (type: TokenizerTypes, givenCodec?: SomeTokenCodec): TokenCodec => {
    if (isCodec(givenCodec)) return {
      encode: (text) => Promise.resolve(givenCodec.encode(text)),
      decode: (tokens) => Promise.resolve(givenCodec.decode(tokens))
    };

    return {
      encode: (text) => new tokenizerCodec.GlobalEncoder().encode(text, type),
      decode: (tokens) => new tokenizerCodec.GlobalEncoder().decode(tokens, type)
    };
  };

  /**
   * Wraps the given `codec` in a task runner that will run two encode/decode
   * tasks concurrently and buffer any more than that, favoring executing the
   * latest task before older tasks.
   * 
   * This will hopefully utilize both the background worker and main thread
   * more efficiently, keeping the worker saturated and the main thread
   * unblocked (as much as is reasonable).
   * 
   * The task management would be better placed into the actual background
   * worker, since a task-runner on the main thread can only actually advance
   * its jobs after the current event loop ends...  But it will still be
   * better than no management at all.
   */
  const wrapInTaskRunner = (codec: TokenCodec): TokenCodec => {
    const jobSubject = new rx.Subject<Deferred<string| number[]>>();

    // This will execute deferred tasks as appropriate.
    jobSubject.pipe(rxop.taskRunner((v) => v.execute())).subscribe(rx.noop);

    return {
      encode: (text) => {
        const def = defer(() => codec.encode(text));
        jobSubject.next(def);
        return def.promise;
      },
      decode: (tokens) => {
        const def = defer(() => codec.decode(tokens));
        jobSubject.next(def);
        return def.promise;
      }
    };
  };

  /**
   * Provides a codec of the given `tokenizerType`.  If `givenCodec` is
   * provided, it will be checked to make sure it follows the interface
   * and will be used instead of the global codec, if so.
   */
  function codecFor(tokenizerType: TokenizerTypes, givenCodec?: SomeTokenCodec) {
    const codec = getCodec(tokenizerType, givenCodec);
    return wrapInTaskRunner(codec);
  }

  return Object.assign(exports, {
    isCodec,
    codecFor,
    prependEncoder,
    appendEncoder
  });
});