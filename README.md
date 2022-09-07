# Custom Context for NovelAI

This user-script injects a new context-builder into NovelAI with new features and capabilities.  The code itself is pretty modular, as this is also intended as an experimentation platform.

This repo was forked from the following template: [cvzi's rollup userscript template](https://github.com/cvzi/rollup-userscript-template)

## Features:
- [x] [Comments searched by keywords](https://github.com/TaleirOfDeynai/nai-context-userscript/wiki/Feature:-Comment-Searching), unlocking new meta-programming possibilities.
- [x] [Context-groups](https://github.com/TaleirOfDeynai/nai-context-userscript/wiki/Feature:-Context-Groups), an alternative to sub-contexts.
- [x] [Weighted-random entry selection](https://github.com/TaleirOfDeynai/nai-context-userscript/wiki/Feature:-Weighted-Random-Selection).
- [ ] Q-Queries, a more user-friendly alternative to regular expressions (coming soon).

## End-User Installation

**NOTE: This user-script can break due to a NovelAI update at any time.  When this happens, it will attempt to fail-over to vanilla behaviors, but it is possible even this can fail.**

If the injection fails, you'll have to wait for me to figure out what needs fixing and release a new version.  Expect interruptions now and then, especially if your scenario has come to rely on this script and is no longer really compatible with vanilla NovelAI.

**Install at your own discretion; disable or uninstall it if causes issues.**

Grab the latest version from the [releases page](https://github.com/TaleirOfDeynai/nai-context-userscript/releases) and use a Greasemonkey compatible user-script extension like [Tampermonkey](https://www.tampermonkey.net/) to install it.

Note that the user-script is currently targeting modern browsers with pretty up-to-date JavaScript feature sets.  It should work with recent versions of the major browsers, but I'm not certain about other browsers, especially mobile ones.

If you have difficulty running it, like syntax errors and the like, let me know what version of browser you're running and I'll look into adjusting the export target to support it.

### Android Options

There are a number of browsers with extension support on Android.  I personally use [Kiwi Browser](https://play.google.com/store/apps/details?id=com.kiwibrowser.browser) as it also has good and optional Google integration, if you want to have that.

### iOS Options

I was surprised to learn that Apple actually allows a few extensions for the Safari browser these days.  I haven't tried it myself, but you can apparently find a Safari extension called [Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887) on the App Store.

## Is it broken?

If the script has broken and I have not yet addressed it, please do one of the following:

- Open an issue here.
- Ping me in NovelAI's Discord; the `#community-research` channel is probably most appropriate.  I'm on there as "Taleir".

## The Wiki

Various topics on what this user-script does and how to work with it were moved to the wiki to shorten this readme.  Below are a few quick links to some important pages you may need to reference.

- [The Wiki Landing Page](https://github.com/TaleirOfDeynai/nai-context-userscript/wiki)
- [Configuring the User-Script](https://github.com/TaleirOfDeynai/nai-context-userscript/wiki/Configuration-Menu)
- [Questions & Answers](https://github.com/TaleirOfDeynai/nai-context-userscript/wiki/Questions-&-Answers)

## Developer Installation

1. Pull the repo.
2. `npm install`
3. Build and/or run using one of the following:
   - `npm run start` will build a special development script in `./dist/dev.user.js` that, when added to your user-script plugin, will update the script as you make code changes.  However, if a TypeScript error happens, the process will stop with an error.
   - `npm run build` will do a single build and put the result into `./dist/bundle.user.js`.
   - `npm run test` will run the test suites.

## Stuff for NovelAI Devs

If any NovelAI devs are looking at this, here's some things you might be interested in.

### Mark of Defilement

I see you use Sentry to collect error telemetry.  You will probably want to know when this user-script is active so you can either disable your telemetry or at least mark any events you collect as coming from a modified web client.

This user-script will set `window.__USERSCRIPT_ACTIVE` to `true` to let you know the client is modified.

### Tokenizer Wishlist

The fact the global tokenizer is on a background worker is pretty cool.  Unfortunately, the way it is right now doesn't really make it the best for supporting concurrency.  It's obvious you just wanted to avoid freezing the UI thread, which is great!

However, I have seen you mostly doing serial operations, like an `await` in a `for` loop, even when the result of the previous loop has no connection to the next loop.  A `Promise.all` call is a very rare thing to see and this mostly seems to be due to how your sanity timeout was implemented.  There is performance left on the table there!

Granted, I took a much different approach that does many, smaller encode requests in an attempt to reduce repeat work and the total length of strings sent for encoding, so I'm disproportionally affected by interaction overhead with the tokenizer.  I wrote around it to claw back some of that lost performance by adding an arbitrator in front of the tokenizer to allow limited concurrency while keeping it from getting overloaded...

...but with just a few tweaks, you could just solve this entirely!  And you'll probably want to do that for the scripting API anyways; you can get your team to agree to serial interactions with the tokenizer, but it will be harder to get the rest of the world to do so.

#### Switch from `setTimeout` to `setInterval`

At least in Chromium, `setTimeout` is a surprisingly expensive function and you use it every time a task is dispatched to the tokenizer to setup a timeout that will fail the operation if it takes too long.

However, if you try to do concurrency and send multiple tasks to the background worker in one go while the UI thread tends to other things, you can overload it and cause one task to trigger its timeout because the tokenizer still has 20 other tasks ahead of it to work through before it can even start on it.  I suspect that is why you avoid `Promise.all` when it makes the most sense to use it.

Far as I can tell, this timeout is really just a sanity check to make sure the tokenizer worker hasn't completely died or something; you just want to make sure you're still getting SOME response back from it.

So, consider doing the following instead:

1. Starting from an idle tokenizer, when the first encode/decode task comes in, use `setInterval`.  Once the interval is active, any additional tasks that come in will just use the current interval.
2. On each interval, check to see if at least ONE task has since completed.
   - If so, there's no problem; keep it up!
   - If not, reject all remaining tasks with a timeout error (and discard any messages that would have resolved them, if they eventually come in).
   - You may need to grab a library that provides a `Future` type, which is just a promise-like with `reject` and `resolve` as semi-public methods rather than trapped in a function closure.
3. When all tasks have been fulfilled, use `clearInterval` and reset for the next batch.
4. Because this is now stateful (with a shared interval ID), you should stop doing `new GlobalEncoder().encode(...)` in the wrapped tokenizer created in the context-builder.
   - There is no reason to pay for an object instantiation every time you want to invoke `encode` or `decode`; you only have the one background worker anyways and it's globally shared.
   - Even if you had multiple workers, you'd probably want to have intelligent load-balancing between them with a single point-of-entry to arbitrate for them.
   - You can just get rid of the class all-together or instantiate only one instance in the module and export that.  I'm sure you can figure out how to handle that `prepare` function in either scenario.

With this, dozens of `encode` or `decode` tasks can come in from something like a `Promise.all` and only one `setInterval` and `clearInterval` will be done for the whole batch.  At worst it's as bad as `setTimeout` when doing things serially.

But you won't need to do things serially any more; you can go nuts with parallel processing and saturate that worker; keep that sucker busy with no down time!

#### Add a `decodeKvp` Task

In one of my functions, I had to resort to a binary search with the `decode` task to locate a specific token that I might-possibly-need to split into two tokens.  If I could have efficiently gotten a `Map<number, string>` representing what tokens map to what strings, I could have just done one `await` and then a loop to find which token held the offset I was after.

You guys also need this; your experimental Tokenizer feature is currently doing a noticeably slow for-loop that awaits `decode([token])` for every single token ...serially.  What could take only 10ms is taking over 500ms due to marshaling overhead and just waiting for the event loop to realize it has a message to process.

Decoding tokens _is_ super fast relative to encoding them, but marshalling between threads adds significant overhead, and even with the `setInterval` tweak above and switching to a `Promise.all`, there will still be a significant loss due to serializing and deserializing data between the threads for each task.

That's how JavaScript threading currently works; it does a `JSON.stringify` and `JSON.parse` for each message between threads.  There's proposals to fix this with cheap per-object ownership exchange but the browser makers are still feuding over implementation details, last I checked.

Anyways, having a `decodeKvp` task (and maybe a symmetric `encodeKvp` task) added to the global tokenizer that spits back an `Array<[number, string]>` in a single `postMessage` would make your stuff super quick and I could also exchange this complicated asynchronous binary search for a simple synchronous linear search.

And I see your context-builder can be given some object with `encode` and `decode` methods to use in-lieu of the global tokenizer, which I assume is for testing purposes.  You'll have to create less-optimized adapters for that case, but that is trivial to do:

```js
const decodeKvp = async (tokens) => {
  const inFlight = tokens.map((t) => givenCodec.decode([t]));
  const strings = await Promise.all(inFlight);
  return strings.map((s, i) => [tokens[i], s]);
};
const encodeKvp = async (str) => {
  const tokens = await givenCodec.encode(str);
  return await decodeKvp(tokens);
};
```