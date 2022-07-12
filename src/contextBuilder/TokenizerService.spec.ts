import { describe, it, expect } from "@jest/globals";
import { beforeEach } from "@jest/globals";
import fakeRequire from "@spec/fakeRequire";
import { toFragmentSeq } from "@spec/helpers-splitter";
import * as helpers from "@spec/helpers-tokenizer";
import * as mockStory from "@spec/mock-story";

import { dew } from "@utils/dew";
import { chain, iterReverse, interweave, iterPosition } from "@utils/iterables";
import { skip, take, skipRight, takeRight } from "@utils/iterables";
import * as AI from "@utils/asyncIterables";
import $TokenizerService, { AugmentedTokenCodec } from "./TokenizerService";

const tokenizer = $TokenizerService(fakeRequire);
const { mockCodec } = helpers;

// These tests make use of the mock codec which has a limited number
// of phrases it can encode and decode.  Please reference its source
// for a table of phrases that it will accept.

describe("AugmentedTokenCodec", () => {
  describe("mendTokens", () => {
    let mendingFn: AugmentedTokenCodec["mendTokens"];
    beforeEach(() => {
      mendingFn = tokenizer.codecFor(0, mockCodec).mendTokens;
    });

    // A great many scenarios are tested by the append/prepend encoders.
    // So, we're just going to test the scenarios unique to `mendTokens`.
    // These tests rely on the default `UNSAFE_TOKEN_BUFFER` value to
    // collapse tokens so they match the result of `mockCodec.encode`.

    it("should do basic string encoding", async () => {
      const result = await mendingFn(["foo bar"]);

      expect(result).toEqual(await mockCodec.encode("foo bar"));
    });

    it("should do string concatenation encoding", async () => {
      const result = await mendingFn(["foo", " ", "bar"]);

      expect(result).toEqual(await mockCodec.encode("foo bar"));
    });

    it("should handle an array of tokens between two strings", async () => {
      const result = await mendingFn([
        "foo",
        [1, 111, 321, 112, 1], // " [ foobar ] "
        "bar"
      ]);

      expect(result).toEqual(await mockCodec.encode("foo [ foobar ] bar"));
    });

    it("should handle a string between two arrays of tokens", async () => {
      const result = await mendingFn([
        [301, 1, 111], // "foo [ "
        "foobar",
        [112, 312] // " ] bar"
      ]);

      expect(result).toEqual(await mockCodec.encode("foo [ foobar ] bar"));
    });

    it("should handle mending of many arrays of tokens", async () => {
      const result = await mendingFn([
        [301, 1, 111], // "foo [ "
        [301, 302], // "foobar"
        [112, 312] // " ] bar"
      ]);

      expect(result).toEqual(await mockCodec.encode("foo [ foobar ] bar"));
    });

    it("should work with large inputs", async () => {
      const { startComments, middleComments, endComments } = mockStory;
      const concatComments = [startComments, middleComments, endComments].join("");

      const startTokens = await mockCodec.encode(startComments);
      const middleTokens = await mockCodec.encode(middleComments);
      const endTokens = await mockCodec.encode(endComments);
      const expected = await mockCodec.encode(concatComments);

      // Throw a battery of trials at it.
      const trials = [
        [startTokens, middleComments, endTokens],     // T S T
        [startComments, middleTokens, endComments],   // S T S
        [startTokens, middleTokens, endTokens],       // T T T
        [startComments, middleComments, endComments], // S S S
      ];

      for (const trial of trials) {
        const result = await mendingFn(trial);
        expect(result).toEqual(expected);
      }
    });
  });

  describe("findOffset", () => {
    let findOffset: AugmentedTokenCodec["findOffset"];
    beforeEach(() => {
      findOffset = tokenizer.codecFor(0, mockCodec).findOffset;
    });
  
    it("should find a single index when inside a token", async () => {
      const tokens = [301, 1, 302]; // "foo bar"
  
      const fooResult = await findOffset(tokens, 2);
      expect(fooResult).toEqual({
        type: "single",
        data: expect.objectContaining({
          index: 0,
          token: 301,
          value: "foo"
        }),
        remainder: 2
      });
  
      const barResult = await findOffset(tokens, 5);
      expect(barResult).toEqual({
        type: "single",
        data: expect.objectContaining({
          index: 2,
          token: 302,
          value: "bar"
        }),
        remainder: 1
      });
    });
  
    it("should find a range when bordering two tokens", async () => {
      const tokens = [301, 1, 302]; // "foo bar"
  
      const fooResult = await findOffset(tokens, 3);
      expect(fooResult).toEqual({
        type: "double",
        min: expect.objectContaining({
          index: 0,
          token: 301,
          value: "foo"
        }),
        max: expect.objectContaining({
          index: 1,
          token: 1,
          value: " "
        }),
        remainder: 0
      });
  
      const barResult = await findOffset(tokens, 4);
      expect(barResult).toEqual({
        type: "double",
        min: expect.objectContaining({
          index: 1,
          token: 1,
          value: " "
        }),
        max: expect.objectContaining({
          index: 2,
          token: 302,
          value: "bar"
        }),
        remainder: 0
      });
    });

    it("should work with a given `sourceText`", async () => {
      // It does not directly validate the tokens versus the text.
      // There is an indirect check that it does when it performs
      // the binary search, but it requires `debugLogging` to be
      // enabled.

      const tokens = [301, 1, 302]; // "foo bar"
      const sourceText = await mockCodec.decode(tokens);

      const result = await findOffset(tokens, 5, sourceText);
      expect(result).toEqual({
        type: "single",
        data: expect.objectContaining({
          index: 2,
          token: 302,
          value: "bar"
        }),
        remainder: 1
      });
    });

    it("should work with the offset being dead center", async () => {
      // This is a bit of a gotcha.  When doing a binary search,
      // it is possible for the offset to be in both halves because
      // the offset happens to be between those fragments.
      const tokens = [211, 212, 213, 211, 212, 213]; // "112233112233"

      const result = await findOffset(tokens, 6);
      expect(result).toEqual({
        type: "double",
        min: expect.objectContaining({
          index: 2,
          token: 213,
          value: "33"
        }),
        max: expect.objectContaining({
          index: 3,
          token: 211,
          value: "11"
        }),
        remainder: 0
      });
    });

    it("should work with a large amount of tokens", async () => {
      const sourceText = mockStory.mockStory;
      const tokens = await mockCodec.encode(sourceText);

      // There are 14 `"2222"` tokens in there.  We're going to find
      // the index of of the 8th one.
      const manyTwos = chain(tokens)
        .thru(iterPosition)
        .filter(([i, t]) => t === 232)
        .toArray();
      
      // Sanity check this test.
      expect(manyTwos.length).toBe(14);

      // Pull the 8th one and determine its offset.
      const [index] = manyTwos[7];
      const baseOffset = (await mockCodec.decode(tokens.slice(0, index))).length;

      const borderResult = await findOffset(tokens, baseOffset + 4, sourceText);
      expect(borderResult).toEqual({
        type: "double",
        min: expect.objectContaining({
          index: index,
          token: 232,
          value: "2222"
        }),
        max: expect.objectContaining({
          index: index + 1,
          token: 312,
          value: " bar"
        }),
        remainder: 0
      });

      const insideResult = await findOffset(tokens, baseOffset + 2, sourceText);
      expect(insideResult).toEqual({
        type: "single",
        data: expect.objectContaining({
          index: index,
          token: 232,
          value: "2222"
        }),
        remainder: 2
      });
    });

    it("should fail when `offset` is out of range of the string", async () => {
      const tokens = [301, 1, 302]; // "foo bar"
      const tooLo = () => findOffset(tokens, -3);
      const tooHi = () => findOffset(tokens, 9);

      await expect(tooLo()).rejects.toThrow();
      await expect(tooHi()).rejects.toThrow();
    });
  });
});

describe("prepend encoder", () => {
  const { prependEncoder } = tokenizer;
  const toExpected = helpers.toPrependExpected;

  let augmentedCodec: AugmentedTokenCodec;
  beforeEach(() => {
    augmentedCodec = tokenizer.codecFor(0, mockCodec);
  });

  // Be aware that the prepend encoder expects fragments in reverse
  // order.  Each iteration will prepend the next fragment in the
  // sequence it is given.

  it("should do basic encoding", async () => {
    // This actually does iterative encoding using the given fragments,
    // but the end result should be the same as simply running the
    // encoder on the joined string.
    const inOrder = toFragmentSeq(["foo", " ", "bar"], 10);
    const encoded = await AI.lastValueFrom(prependEncoder(
      augmentedCodec,
      iterReverse(inOrder)
    ));

    expect(encoded).toEqual(await toExpected(inOrder, await mockCodec.encode("foo bar")));
  });

  it("should collapse tokens between steps", async () => {
    // Our mock codec has tokens for numbers like "1", "11", and
    // "1111", but not "111".  Naturally, we'd like it to collapse
    // to the minimum possible tokens.
    const inOrder = toFragmentSeq(Array.from("11112222"), 10);
    const encodedSeq = await AI.toArray(prependEncoder(
      augmentedCodec,
      iterReverse(inOrder)
    ));

    // Using the raw token values to be certain.
    expect(encodedSeq).toEqual([
      await toExpected(inOrder, 1, [202]),
      await toExpected(inOrder, 2, [212]),
      await toExpected(inOrder, 3, [212, 202]),
      await toExpected(inOrder, 4, [232]),
      await toExpected(inOrder, 5, [201, 232]),
      await toExpected(inOrder, 6, [211, 232]),
      await toExpected(inOrder, 7, [211, 201, 232]),
      await toExpected(inOrder, 8, [231, 232])
    ]);
  });

  it("should respect the `bufferSize` option", async () => {
    // The `bufferSize` describes how many tokens should be treated
    // as unsafe and potentially collapsable.  It is `10` by default,
    // which is why the previous test worked out alright.

    // But a `bufferSize` of `1` should cause it to only collapse up
    // to two of the numbers together, since the "111" will encode
    // like `["11", "1"]` and the "1" will then be moved out of
    // the buffer.
    const inOrder = toFragmentSeq(Array.from("11111"), 10);
    const encodedSeq = await AI.toArray(prependEncoder(
      augmentedCodec,
      iterReverse(inOrder),
      { bufferSize: 1 }
    ));

    // Using the raw token values to be certain.
    expect(encodedSeq).toEqual([
      await toExpected(inOrder, 1, [201]),
      await toExpected(inOrder, 2, [211]),
      await toExpected(inOrder, 3, [211, 201]),
      // Normally, this would collapse to `231`, but the `201` from
      // the last iteration is now locked in.
      await toExpected(inOrder, 4, [211, 201, 201]),
      // Another lock in and now we have a pretty sub-optimal sequence.
      await toExpected(inOrder, 5, [211, 201, 201, 201])
    ]);
  });

  it("should only yield after prepending wordy fragments", async () => {
    // The `" "` is not wordy, so it will get combined with `"foo"`.
    const inOrder = toFragmentSeq(["foo", " ", "bar"], 10);
    const encodedSeq = await AI.toArray(prependEncoder(
      augmentedCodec,
      iterReverse(inOrder)
    ));

    // Three fragments, but we expect only two updates.
    expect(encodedSeq).toEqual([
      await toExpected(inOrder, 1, "bar"),
      await toExpected(inOrder, 3, "foo bar")
    ]);
  });

  it("should still yield on non-wordy fragments if they're the last fragment", async () => {
    // Additionally to the above, we don't want to lose non-wordy
    // fragments at significant positions.
    const inOrder = toFragmentSeq([" ", "foo", " ", "bar"], 10);
    const encoded = await AI.lastValueFrom(prependEncoder(
      augmentedCodec,
      iterReverse(inOrder)
    ));

    expect(encoded).toEqual(await toExpected(inOrder, " foo bar"));
  });

  it("should include the prefix and suffix in each step", async () => {
    const inOrder = toFragmentSeq(Array.from("123"), 10);
    const encodedSeq = await AI.toArray(prependEncoder(
      augmentedCodec,
      iterReverse(inOrder),
      { prefix: "[ ", suffix: " ]" }
    ));

    expect(encodedSeq).toEqual([
      await toExpected(inOrder, 1, "[ 3 ]"),
      await toExpected(inOrder, 2, "[ 23 ]"),
      await toExpected(inOrder, 3, "[ 123 ]")
    ]);
  });

  it("should include `resume` data in the result", async () => {
    // We've actually only been checking `fragments` and `tokens` so
    // far. This just confirms, once, that it is producing the `resume`
    // data too.
    const inOrder = toFragmentSeq(["foo", " ", "bar"], 10);
    const encoded = await AI.lastValueFrom(prependEncoder(
      augmentedCodec,
      iterReverse(inOrder),
      // Small buffer size so we have some safe tokens.
      { prefix: "[ ", suffix: " ]", bufferSize: 1 }
    ));

    expect(encoded).toEqual(expect.objectContaining({
      resume: {
        type: "prepend",
        safeCount: (await mockCodec.encode(" bar ]")).length,
        unsafeTokens: await mockCodec.encode("foo")
      }
    }));
  });

  it("should be capable of resuming with the `seedResult` option", async () => {
    // Each time the trimmer busts the budget, it will take the last
    // fragment that failed and try to increase the granularity of
    // the splitting, so if a paragraph can't fit, it'll try to
    // break the paragraph into sentences and attempt to fit as
    // many of those as it can.

    // During this transition, it needs to provide the last result
    // that was in budget as a seed from which to resume encoding.
    const prefix = "[ ";
    const suffix = " ]";

    const nextSource = Array.from("123");
    const nextFragments = toFragmentSeq(nextSource, 10);

    // These come after `nextSource`, so we'll apply the correct offset.
    const [firstFrag] = nextFragments;
    const seedOffset = firstFrag.offset + firstFrag.content.length;
    const seedSource = ["foo", "bar", " ", "foo", " ", "bar"];
    const seedFragments = toFragmentSeq(seedSource, seedOffset);
    const seedResult = {
      fragments: seedFragments,
      // We're encoding with a prefix and suffix, so those would
      // be present in the seed tokens.
      tokens: await mockCodec.encode([prefix, ...seedSource, suffix].join("")),
      // The resume data will not include the prefix, however.
      // This should reconstruct the last state of this fictional encode.
      resume: {
        type: "prepend",
        safeCount: (await mockCodec.encode(" foo bar ]")).length,
        unsafeTokens: await mockCodec.encode("foobar")
      } as const
    };

    const encoded = await AI.lastValueFrom(prependEncoder(
      augmentedCodec,
      iterReverse(nextFragments),
      { prefix, suffix, seedResult }
    ));

    expect(encoded).toEqual(await toExpected(
      [...nextFragments, ...seedFragments],
      await mockCodec.encode([prefix, ...nextSource, ...seedSource, suffix].join(""))
    ));
  });

  it("should be able to resume in practice", async () => {
    // We've checked it is producing the resume data...
    // We've checked that it can resume from artificial data...
    // Now, let's sanity check this works with its own output.
    const prefix = "[ ";
    const suffix = " ]";

    // We're using the vanilla buffer size, so we're going to
    // need a lot of fragments.
    const fullSource = [...interweave(" ", dew(function* () {
      for (let i = 0; i < 50; i++) {
        if (i % 5 === 0) yield "foobar";
        else yield "foo";
        yield "bar";
      }
    }))];
    const fullFragments = toFragmentSeq(fullSource, 10);

    // Being prepend, we'll skip 20 fragments to get a resume point
    // that we can prepend to.
    const resumeMe = await AI.lastValueFrom(prependEncoder(
      augmentedCodec,
      iterReverse(skip(fullFragments, 20)),
      { prefix, suffix }
    ));

    // And now we'll prepend those first 20 fragments by resuming.
    const checkMe = await AI.lastValueFrom(prependEncoder(
      augmentedCodec,
      iterReverse(take(fullFragments, 20)),
      { prefix, suffix, seedResult: resumeMe }
    ));

    // And it should be the same as if we encoded the full thing in one go.
    expect(checkMe).toEqual(await toExpected(
      fullFragments,
      await mockCodec.encode([prefix, ...fullSource, suffix].join(""))
    ));
  });

  it("should FAIL if it tries to resume from an append result", async () => {
    // You can resume from any prepend, no matter the `bufferSize` option,
    // since the resume data allows it to reconstruct the internal state.
    // However, it can't resume from an append, as they manage their state
    // differently, so it sanity checks the seed result to prevent this.
    const appendResult = {
      fragments: [],
      tokens: [],
      resume: {
        type: "append",
        safeCount: 0,
        unsafeTokens: []
      } as const
    };

    const nextSource = Array.from("123");
    const nextFragments = toFragmentSeq(nextSource, 10);

    const result = AI.lastValueFrom(prependEncoder(
      augmentedCodec,
      nextFragments,
      { seedResult: appendResult }
    ));

    await expect(result).rejects.toThrow();
  });
});

describe("append encoder", () => {
  const { appendEncoder } = tokenizer;
  const toExpected = helpers.toAppendExpected;

  let augmentedCodec: AugmentedTokenCodec;
  beforeEach(() => {
    augmentedCodec = tokenizer.codecFor(0, mockCodec);
  });

  // Fragments are given in reading order for appending.
  // I'll be removing most comments from this one that explain
  // things; I'll clarify any important differences between
  // appending and prepending, though.

  it("should do basic encoding", async () => {
    const inOrder = toFragmentSeq(["foo", " ", "bar"], 10);
    const encoded = await AI.lastValueFrom(appendEncoder(
      augmentedCodec,
      inOrder
    ));

    expect(encoded).toEqual(await toExpected(inOrder, await mockCodec.encode("foo bar")));
  });

  it("should collapse tokens between steps", async () => {
    const inOrder = toFragmentSeq(Array.from("11112222"), 10);
    const encodedSeq = await AI.toArray(appendEncoder(
      augmentedCodec,
      inOrder
    ));

    // Using the raw token values to be certain.
    expect(encodedSeq).toEqual([
      await toExpected(inOrder, 1, [201]),
      await toExpected(inOrder, 2, [211]),
      await toExpected(inOrder, 3, [211, 201]),
      await toExpected(inOrder, 4, [231]),
      await toExpected(inOrder, 5, [231, 202]),
      await toExpected(inOrder, 6, [231, 212]),
      await toExpected(inOrder, 7, [231, 212, 202]),
      await toExpected(inOrder, 8, [231, 232])
    ]);
  });

  it("should respect the `bufferSize` option", async () => {
    const inOrder = toFragmentSeq(Array.from("11111"), 10);
    const encodedSeq = await AI.toArray(appendEncoder(
      augmentedCodec,
      inOrder,
      { bufferSize: 1 }
    ));

    // Using the raw token values to be certain.
    expect(encodedSeq).toEqual([
      await toExpected(inOrder, 1, [201]),
      await toExpected(inOrder, 2, [211]),
      // The `211` gets locked in here...
      await toExpected(inOrder, 3, [211, 201]),
      // ...so it can't convert to `231`.
      await toExpected(inOrder, 4, [211, 211]),
      await toExpected(inOrder, 5, [211, 211, 201])
    ]);
  });

  it("should only yield after appending wordy fragments", async () => {
    const inOrder = toFragmentSeq(["foo", " ", "bar"], 10);
    const encodedSeq = await AI.toArray(appendEncoder(
      augmentedCodec,
      inOrder
    ));

    // Three fragments, but we expect only two updates.
    expect(encodedSeq).toEqual([
      await toExpected(inOrder, 1, "foo"),
      await toExpected(inOrder, 3, "foo bar")
    ]);
  });

  it("should still yield on non-wordy fragments if they're the last fragment", async () => {
    const inOrder = toFragmentSeq(["foo", " ", "bar", " "], 10);
    const encoded = await AI.lastValueFrom(appendEncoder(
      augmentedCodec,
      inOrder
    ));

    expect(encoded).toEqual(await toExpected(inOrder, "foo bar "));
  });

  it("should include the prefix and suffix in each step", async () => {
    const inOrder = toFragmentSeq(Array.from("123"), 10);
    const encodedSeq = await AI.toArray(appendEncoder(
      augmentedCodec,
      inOrder,
      { prefix: "[ ", suffix: " ]" }
    ));

    expect(encodedSeq).toEqual([
      await toExpected(inOrder, 1, "[ 1 ]"),
      await toExpected(inOrder, 2, "[ 12 ]"),
      await toExpected(inOrder, 3, "[ 123 ]")
    ]);
  });

  it("should include `resume` data in the result", async () => {
    const inOrder = toFragmentSeq(["foo", " ", "bar"], 10);
    const encoded = await AI.lastValueFrom(appendEncoder(
      augmentedCodec,
      inOrder,
      // Small buffer size so we have some safe tokens.
      { prefix: "[ ", suffix: " ]", bufferSize: 1 }
    ));

    expect(encoded).toEqual(expect.objectContaining({
      resume: {
        type: "append",
        safeCount: (await mockCodec.encode("[ foo")).length,
        unsafeTokens: await mockCodec.encode(" bar")
      }
    }));
  });

  it("should be capable of resuming with the `seedResult` option", async () => {
    const prefix = "[ ";
    const suffix = " ]";

    const seedSource = ["foo", "bar", " ", "foo", " ", "bar"];
    const seedFragments = toFragmentSeq(seedSource, 10);

    const [firstFrag] = seedFragments;
    const nextOffset = firstFrag.offset + firstFrag.content.length;
    const nextSource = Array.from("123");
    const nextFragments = toFragmentSeq(nextSource, nextOffset);

    const seedResult = {
      fragments: seedFragments,
      tokens: await mockCodec.encode([prefix, ...seedSource, suffix].join("")),
      // The resume data will not include the suffix.
      resume: {
        type: "append",
        safeCount: (await mockCodec.encode("[ foobar foo")).length,
        unsafeTokens: await mockCodec.encode(" bar")
      } as const
    };

    const encoded = await AI.lastValueFrom(appendEncoder(
      augmentedCodec,
      nextFragments,
      { prefix, suffix, seedResult }
    ));

    expect(encoded).toEqual(await toExpected(
      [...seedFragments, ...nextFragments],
      await mockCodec.encode([prefix, ...seedSource, ...nextSource, suffix].join(""))
    ));
  });

  it("should be able to resume in practice", async () => {
    const prefix = "[ ";
    const suffix = " ]";

    const fullSource = [...interweave(" ", dew(function* () {
      for (let i = 0; i < 50; i++) {
        if (i % 5 === 0) yield "foobar";
        else yield "foo";
        yield "bar";
      }
    }))];
    const fullFragments = toFragmentSeq(fullSource, 10);

    // Being append, we'll drop the last 20 fragments to get a resume
    // point that we can append to.
    const resumeMe = await AI.lastValueFrom(appendEncoder(
      augmentedCodec,
      skipRight(fullFragments, 20),
      { prefix, suffix }
    ));

    // And now we'll append those last 20 fragments by resuming.
    const checkMe = await AI.lastValueFrom(appendEncoder(
      augmentedCodec,
      takeRight(fullFragments, 20),
      { prefix, suffix, seedResult: resumeMe }
    ));

    // And it should be the same as if we encoded the full thing in one go.
    expect(checkMe).toEqual(await toExpected(
      fullFragments,
      await mockCodec.encode([prefix, ...fullSource, suffix].join(""))
    ));
  });

  it("should FAIL if it tries to resume from a prepend result", async () => {
    const prependResult = {
      fragments: [],
      tokens: [],
      resume: {
        type: "prepend",
        safeCount: 0,
        unsafeTokens: []
      } as const
    };

    const nextSource = Array.from("123");
    const nextFragments = toFragmentSeq(nextSource, 10);

    const result = AI.lastValueFrom(appendEncoder(
      augmentedCodec,
      nextFragments,
      { seedResult: prependResult }
    ));

    await expect(result).rejects.toThrow();
  });
});