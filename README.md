# Custom Context for NovelAI

This user-script injects a new context-builder into NovelAI with new features and capabilities.  The code itself is pretty modular, as this is also intended as an experimentation platform.

This repo was forked from the following template: [cvzi's rollup userscript template](https://github.com/cvzi/rollup-userscript-template)

## Features:
- [x] [Comments searched by keywords](#comment-searching), unlocking new meta-programming possibilities.
- [x] [Context-groups](#context-groups), an alternative to sub-contexts.
- [x] [Weighted-random entry selection](#weighted-random-selection).
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

## Configuration Options

The [configuration menu](#how-do-I-access-the-configuration-menu) allows you to configure the user-script, enabling or disabling features and making it work how you might need it to work.

Here are the current options and a short explanation of their function:

- **Sourcing**
  - **Standardize Prefix/Suffix Handling** (on by default) - When searching for key matches, vanilla NovelAI adds the prefix and suffix to lorebook entries but not to the story entry.  Enabling this option will make sure the prefix and suffix are also added to the story so all entries behave the same way.
- **Activation**
  - **Integrate with Vanilla Searches** (on by default) - In case NovelAI attempts to use the keys of an entry outside of the main context-builder, enabling this will try to catch that and make sure this user-script's search system is used instead.  This makes sure the same caching system and searching behavior is used.
  - **Search Comments** (on by default) - Enables or disables the [comment searching](#comment-searching) feature, which allows your keys to find matches in comments.
- **Sub-Context**
  - **Use Context-Groups** (on by default) - Enables or disables the [Context-Groups](#context-groups) feature, which changes how sub-contexts work pretty drastically.
- **Selection**
  - **Weighted-Random Selection**
    - **Enable** (on by default) - Enables or disables the [weighted-random selection](#weighted-random-selection) feature.
    - **Use Story-Seeded Randomness** (on by default) - When enabled, generates the context the same way on retries, as long as nothing else changed that might affect the randomness (like insertion positions of entries in your lorebook).  Disable it if you want the context to reshuffle when you retry; you never know when you might've just gotten a bad roll!
- **Assembly**
  - **Shunting Mode** - When an entry can't be inserted into another entry for whatever reason, it needs to be kicked out of it.  This allows you to tweak how that happens.
    - `"In Same Direction"` - The default.  Shunts in the direction indicated by the inserted entry's "insertion position" configuration; that is `-1` or less places it before the entry and `0` or more places it after the entry.
    - `"Nearest"` - Shunts to the nearest boundary of the insertion target.  So, if it was trying to insert near the start of the entry, it will be placed before it.  Otherwise, it places it after it.
- **Debugging**
  - **Enable Logging** (off by default) - Enables debug logging.
    - Spams the browser's console with information on the entire context building process.
    - Enables performance telemetry of the context builder's pipeline.  Chrome can give you a breakdown in one of its "Performance" recordings.
    - This will have a negative impact on performance, *especially* if you have the console open.  Updating that in realtime is expensive.
  - **Enable Performance Comparison** (off by default) - Runs both the context builders of the user-script and vanilla NovelAI.
    - Reports the resulting contexts of each to the browser's console.
    - Tracks performance telemetry of each function individually.
    - Since this builds two contexts each time, it does slow things down a lot.
    - Best not to use it with debug logging enabled if you want to get decently comparable timings.

## FAQ

#### How does this work compared to vanilla NovelAI?

It should be generally compatible except with lorebooks that rely on *very* specific behaviors to do some kind of crazy meta-programming.

In particular:

- Comment removal is normalized for all entries, including ephemeral entries.
  - A comment is any line that starts with `##`, btw.
- The text of an entry used for keyword searching is normalized.
  - NovelAI includes the prefix/suffix for lorebook entries but not the story.  It was normalized to apply the lorebook behavior to the story as well.
  - I'm considering changing this to do the opposite instead, because a regular expression like `/^## .+$/m` can fail to match because of the prefix adding more before the line.  It *felt* like bad UX, seeing my comment in the lorebook editor right at the beginning of the entry but the matcher says "no" ...but this is also a much bigger, *breakier* change.
- Trimming should never leave behind dangling whitespace that would create inconsistency with the prefix/suffix.  If it ever does, let me know.
- The "token" trimming level currently just separates by words in a Eurocentric way.  That trim-level won't work all that well with Japanese (sorry Genji!) or other languages that lack space-separation between words.
- Entries can never be inserted into the prefix or suffix of other entries; the entry will be shunted to before/after the prefix/suffix instead.
- In the case of multiple entries with the same insertion priority, it can use extra information gathered from cascade activations to break those ties a little more intelligently.  It will try to place cascade activations after the entry that triggered them.
  - But again, **only where the insertion priority is equal to other entries**...
  - Except when using [weighted-random selection](#weighted-random-selection).

#### How do I access the configuration menu?

The user-script uses Greasemonkey's `GM.registerMenuCommand` permission to register a command that will open the configuration menu.

How the user-script extension presents this menu command is up to the individual extension, but on Tampermonkey, you can access it from its icon on your browser's toolbar while NovelAI is loaded.

![Finding the Configuration in Tampermonkey](/assets/configuration.png)

Refer to your user-script extension's documentation to figure out how to find the configuration menu command or if it is even capable of presenting one.

You can learn what each option in the menu does [over here](#configuration-options).

#### What happens if it breaks?

The script uses Greasemonkey's `GM.notification` permission to inform you with a message.  It will let you know it can't work, but you will probably have to open the developer's console to see the specific reason as to why it didn't work.

If it broke in a detectable way, it will attempt to recover by deferring to the vanilla NovelAI behaviors.  Hopefully, those won't also break!

#### It broke; pls fix?

It will just break from time-to-time.  And I will try to fix it so long as I'm still trying to use NovelAI.

NovelAI is using Webpack and although they did add some configuration to reduce the amount of work needed to maintain the hooks (at my request, thanks much!), it still sometimes changes the module IDs and I have to go manually update them.

And the NovelAI devs are also completely free to change their entire private API if they want, breaking this entirely.  I'll try to keep up as long as I have interest and the ability, but until they get their official scripting API going, there is just this annoying maintenance overhead we're all going to have to cope with.

#### Can I see how my entries are scoring with the weighted-random selection?

You can enable debug logging in the [configuration options](#configuration-options) and open your browser's dev console, usually with the F12 key.  You should see a "Console" tab somewhere; this is where the debug information will be logged.

Go to your story in NovelAI, open the "Advanced" tab in the right sidebar, and hit the "Current Context" button.  This will trigger the context builder and spew information onto the console.

Look for log entries prefixed with `[Weighted Selection: <Root>]` or similar (it may say something besides `<Root>` if you're using sub-contexts).  Entries that qualify for random selection will be presented with their score at the time they were selected:

`[Weighted Selection: <Root>] Selected "Taleir - Description" with score 30.94.`

## Comment Searching

By default, NovelAI removes comments before the keywords are applied to activate your entries.  This user-script provides an option to allow comments to remain during the keyword search and remove them prior to insertion.

This is enabled by default.  Open the [configuration menu](#how-do-I-access-the-configuration-menu) and use the Activation → Search Comments option to enable or disable the feature.

If you enable key-relative insertion and the match is removed because it was inside a comment, it will become relative to the nearest text that still exists instead.  This is unlike matches that are removed due to trimming.

See below for some ideas on how to make use of this feature.

### Idea: Topical Cascade

Sometimes you got an entry for a concept that happens to need a lot of words to properly pick it up in all the situations you'd like.  For instance, you might have an entry for a monarch character:

> The current ruler of the Kingdom of Alberia is Queen Livia. She was born in the kingdom and has ruled it for many years. Her father, King Aetius, died when she was young, leaving her to rule the country on her own. She's known for being kind and fair but also strict and unforgiving if you cross her.\
> **Keys:** `livia` `queen` `monarch` `ruler` `her majesty`

In cases where you want to have an entry that is activated in the same way or through additional keywords, you'd have to repeat all these same keywords in every such entry.  But with comment searching, you can reduce that repetition!

Add a comment at the start:
> \#\# Topic: Queen Livia\
> The current ruler of the Kingdom of Alberia is Queen Livia. She was born in the kingdom and has ruled it for many years. Her father, King Aetius, died when she was young, leaving her to rule the country on her own. She's known for being kind and fair but also strict and unforgiving if you cross her.

And in the related entry, add a key that will match that comment:
> Queen Livia holds an artifact named Desparity, a silver-colored scepter that glows with a soft blue light. It appears to be made from metal, though it seems to have been carved from something else entirely. The handle is wrapped with gold wire, and there are runes etched into the surface. When she points the scepter at someone, they fall unconscious.\
> **Keys:** `## Topic: Queen Livia` `desparity` `scepter` `artifact`

...and make sure cascading activation is enabled.  With this trick, any time Queen Livia's entry activates, so too will this entry, in addition to its own unique keywords.

Unfortunately, there's no real way to restrict the keyword looking for the topic to lorebook entries and the others only to the story text.  It would be nice if you could add that kind of constraint to keywords...  Maybe I'll think about that one as a future feature.

### Idea: Transient Entries

A lot of the challenge in NovelAI when you're crafting larger, guided stories is the context getting overloaded.  Sometimes, it would be nice to have some way to rotate portions of the lorebook in and out.

NovelAI has a feature like that: ephemeral entries.  Unfortunately, they still lack an interface and are cumbersome to use, especially with larger amounts of information.  So, what if we set up an "information treadmill" that can change what sorts of information are cycled in and out of the context?

Here's how!

First, setup a few ephemeral entries that activate for one turn each, but never at the same time.

`{0+3r,0:## CYCLE_1}`\
`{1+3r,0:## CYCLE_2}`\
`{2+3r,0:## CYCLE_2}`

These start at steps 0, 1, and 2, respectively, then repeat every 3 steps, get inserted at the top (irrelevant), and the entry contains a comment that has a good, unique keyword to identify it.  You can naturally use any keyword you like; it's good for your own sanity to be descriptive with it.

Similar to the topical cascade trick, just create a keyword for your entries that matches one of `## CYCLE_1`, `## CYCLE_2`, or `## CYCLE_3`.  After that, the entry will only trigger on that cycle, assuming there are no other keywords.

The ephemeral entry will be used in the cascade keyword search but, because it only contains a comment, it will never actually insert anything because removing the comment turns it into an empty entry.  It just vanishes!

Again, due to a lack of any sort of means to apply logic or constraints to keywords, you can only do so much with this trick.  The lack of control over activation is pretty limiting.

## Context-Groups

Context-groups are an alternative to sub-contexts.  It's meant to support the weighted-random selection feature by allowing lorebook entries to compete based on their apparent relevancy instead of just "insertion order" alone.

This is enabled by default.  Open the [configuration menu](#how-do-I-access-the-configuration-menu) and use the Sub-Context → Use Context-Groups option to enable or disable the feature.

### What and why?

Vanilla sub-contexts take entries belonging to a category away from the main context and use them to construct its own context in isolation, using all the same steps and insertion rules as the main context.  The resulting text is used to create a virtual lorebook entry and that is handed back to the main context to use instead.

The drawback to this is that entries from outside the category cannot directly compete for the token budget.  Instead, the sub-context would be trimmed by the main context when it tried to insert it to make it fit the budget; whatever is at the top/bottom (depending on the trim type) is what will get in.  However, you may wish instead to drop certain entries of the sub-context when budget constrained to optimize relevancy instead.

You can't optimize relevancy very effectively when isolating entries like this.

Context-groups do NOT remove category entries from the main context.  All entries compete for tokens according to the selection rules (in vanilla NovelAI, it's all about "insertion order", unless you have the secret `orderByKeyLocations` flag set), but entries that belong to a category with a sub-context are instead inserted at the position defined by the sub-context's configuration.

This does a little bit to separate "what goes in" from "where it goes in".  It's not a particularly great solution (having "budget priority" and "insertion order" as separate values would be better) but this is still useful.

### Reduced Configuration

Context-groups are only a position in the main context; they technically do not have tokens of their own to trim.  So only the following are really used to configure the group:

- Prefix
- Suffix
- Insertion Order
- Insertion Position
- Insertion Type
- Token Budget

These will all function like you expect.

The "token budget" configuration will limit the total size of the group to that amount of tokens.  As this limit is reached, entries must be either trimmed or dropped, just as you expect.

However, the "reserved tokens" property of the sub-context is not listed.  This used to be useful for specifying a minimum size to the sub-context, but that doesn't really make sense when budgeting for all entries is treated the same.  Entries must reserve their own tokens and be inserted while room still remains.

If the sub-context is configured to be inserted after entries belonging to its category, when you go through the assembly history in the context viewer, you may find that an entry is inserted but no change was made to the context.  It was inserted into the group, but the group has not yet been inserted.  Once the group is inserted, all entries that were already budgeted will appear with it.

Unfortunately, there was no way to give more feedback in the context viewer; NovelAI fails an assertion if the text the viewer receives differs from the context's output.

## Weighted-Random Selection

This feature makes it such that if there are multiple keyword-activated entries with the same insertion priority, it will use an algorithm to score those entries and order the group for insertion randomly based on that score.

This is enabled by default.  Open the [configuration menu](#how-do-I-access-the-configuration-menu) and use the Selection → Weighted-Random Selection → Enable option to enable or disable the feature.

In order to qualify for random selection, an entry:

- Must not be always-on.
- Must not be ephemerally activated.
- Must have activated by keyword, matching either the story or another entry via cascade.

Always-on and ephemeral entries will always be prioritized first, then the randomly selected entries will have their opportunities to be inserted.

### Selection vs Insertion

NovelAI has only one kind of ordering: insertion.

This user-script has two: selection and insertion.

The selection order should actually be about token budgeting; which entries are the best use of the limited tokens we have.  The insertion order should only be about when to insert entries, so they can be strategically located to optimize attention and coherency for the AI's benefit.

Even still, this user-script **does not do this**.  It still has to work with NovelAI, after all.

In order to have better compatibility with vanilla lorebooks and stories, this user-script still does its budgeting during insertion, but we can still select in whatever order we want when insertion order is ambiguous.

And in this case only, we'll order them randomly, but biased according to a relevancy score.

### How to Use

The best way to use this is to imagine your lorebook has only a few priority layers.

For instance:

- Insertion priority `500` is for topical introductions.
  - This will make sure that if something is mentioned, there is a high chance that it will be at least described for the AI.
  - Try to limit how many entries you have here and/or use very specific keywords.  If too many activate, your entire context will just be topic introductions with no deeper elaboration.
  - Keep these fairly short-and-sweet, so there's still room for more elaborative entries.  You never know when an exposition dump is going to happen.
- Insertion priority `400` is for entries elaborating on one or more topics.
  - This is where most of your entries should end up.
  - You can go nuts with the number of entries; just make sure the ones you intend for random selection have keys.
- Insertion priority `-100` is for high-visibility entries that you want right in the story text.
  - This is for stuff like, `[ In this scene, a betrayal occurs! ]`; the sort of stuff you *really* want the AI to act on.
  - Use token reservations to ensure they get inserted over the higher-priority entries.

Minimize the use of always-on entries as much as possible, as those will always have priority; each always-on entry will reduce the budget available for randomly selected entries.

This suggested approach should get you good variety without having to think too hard about it.  By all means, experiment and figure out what gives your lorebook the best results.

In order to control how these entries are inserted relative to each other, you should use category sub-contexts, but there are options there to consider.

#### With Context-Groups

The [context-groups feature](#Context-Groups) makes it so that all entries are **scored and selected together** but **inserted into isolated groups which have their own position**.

You should take this approach when:

- You have many, many topics in your lorebook.
- You want finer control over where topics end up in relation to other topics.
  - IE: you might want to ensure that the Triforce is introduced before Link and then describe the Triforce of Courage only after that, because it relates Link and the Triforce together.
- You don't care much about controlling what is omitted.
  - Sub-contexts cannot reserve tokens in this mode, so the only way you can try to force coverage is by giving individual entries belonging to that category token reservations instead.
  - You can still control the maximum amount of tokens dedicated to a topic through the sub-context's "token budget" configuration, though.

Unfortunately you have limited control over how things are ordered within a single group.  This is just a limitation arising from what vanilla configuration is available.

#### With Vanilla Sub-Contexts

With vanilla sub-contexts, the randomized selection will happen **only between the category's own entries**.  As long as at least one entry for the category has activated, a sub-context will be generated which can then be budgeted and positioned as you wish.

You should take this approach when:

- You have only a few major topics, but they have a lot of entries/minor details within them.
- You want to try and force some minimum coverage on a topic.
  - You will need to configure the sub-context's token budget and reservations to balance the budget.
- You want to have better control over presentation order within each sub-context.

The drawback of this mode is you can accidentally trim out much of the variability if your first priority layer is the only thing that consistently survives the trim, ending up with a pretty static context again.  Those first entries are the ones that pretty much always get inserted, effectively rendering the weighted-random selection pointless.

### Tips & Tricks

- In my own testing, using context-groups has been generally better compared to standard sub-contexts with this selection method.  The AI gets a healthier and broader sampling of information.
- Use cascade activation sparingly and intelligently; it can be a real score booster and make a minor entry into a dominant one.  Use it when you have an entry with keywords that you doubt will get brought up casually in the story and needs the boost from related lorebook entries.
- Each priority layer above another makes it exponentially less likely to have budget left over for it (without needing to resort to token reservations).
  - IE: all of layer `500` is selected before a single entry of layer `400`, so if layer `500` has enough entries to saturate the budget, it will drown out the entries of layer `400`.
- If you have entries that are trying to match a commonly used character's name in addition to other unique keywords, and you want dislike how often that entry appears, you can try replacing the character's name with a [topical cascade](#idea-topical-cascade) keyword to reduce how many points that name can accrue.
  - Matching every mention of the name in the story would add one point per match.
  - With a topical cascade, it would only match the topic of the comment once for 0.9 points or less.
  - This will decrease the points from the character's name significantly and increase the relative power of those unique keywords.

### How Entries are Scored

The weighting functions and how they're applied ~~are configurable~~ will be configurable when I get around to actually writing a UI for it in the configuration menu.

These are the current weighting functions and their intent:

- `storyCount` - Adds to the score based on the number of total keyword matches in the story.
  - Literally 1 point for every match.
- `searchRange` - A penalty multiplier based on whether the match nearest to the end of the story is outside the entry's defined search-range.
  - This allows out-of-range entries to still have a chance at selection, but will become much less likely the farther outside that range it is, reaching the maximum penalty at twice the range.
- `cascadeCount` - Adds to the score based on the matches found during cascade activation.
  - The score given for each keyword is reduced based on how deep into the cascade the matched entry was at the time.
  - That is, you can have an entry (third-degree) that matched an entry (second-degree) that matched an entry (first-degree) that matched the story; a match in a third-degree entry is worth less than a match in a second-degree entry and so-on.
- `cascadeRatio` - A penalty multiplier based on the ratio of cascade-only entries versus story-activated entries.
  - This only applies when there is a simple majority of cascade-only entries.
  - The idea is to penalize the cascade-only entries to add a bias toward those few entries that actually matched the story.
  - This penalty is pretty unlikely to ever be used; I thought I might have a story or two where it would be relevant, but it turns out I did not, because cascading entries can still match the story, making it hard to have cascade-only activations to begin with.
  - I left it in as a just-in-case kinda thing.  Especially in combination with [transient entries](#Idea-Transient-Entries), it might become relevant.

By default, these are applied like so:

`(storyCount * searchRange) + (cascadeCount * cascadeRatio)`

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