
# Custom Context
## A NovelAI User-Script

This user-script inject a new context-builder into NovelAI with new features and capabilities.  The code itself is pretty modular, as this is also intended as an experimentation platform.

This repo was forked from the following template: [cvzi's rollup userscript template](https://github.com/cvzi/rollup-userscript-template)

## Features:
- [x] [Comments searched by keywords](#Comment-Searching), unlocking new meta-programming possibilities.
- [x] [Context-groups](#Context-Groups), an alternative to sub-contexts.
- [ ] Weighted random entry selection (coming soon).
- [ ] Q-Queries, a more user-friendly alternative to regular expressions (coming soon).

## End-User Installation

**NOTE: This user-script can break due to a NovelAI update at any time.  When this happens, it will attempt to fail-over to vanilla behaviors, but it is possible even this can fail.**

If the injection fails, you'll have to wait for me to figure out what needs fixing and release a new version.  Expect interruptions now and then, especially if your scenario has come to rely on this script and is no longer really compatible with vanilla NovelAI.

**Install at your own discretion; disable or uninstall it if causes issues.**

Grab the latest release and use a Greasemonkey compatible user-script extension like [Tampermonkey](https://www.tampermonkey.net/) to install it.

Note that the user-script is currently targeting modern browsers with pretty up-to-date JavaScript feature sets.  It should work with current version Chrome, but I'm not certain about other browsers.

If you have difficulty running it, like syntax errors and the like, let me know and I'll look into adjusting the export target for you.

### Android Options

There are a number of browsers with extension support on Android.  I personally use [Kiwi Browser](https://play.google.com/store/apps/details?id=com.kiwibrowser.browser) as it also has good and optional Google integration, if you want to have that.

### iOS Options

I was surprised to learn that Apple actually allows a few extensions for the Safari browser these days.  I haven't tried it myself, but you can apparently find a Safari extension called [Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887) on the App Store.

## Comment Searching

By default, NovelAI removes comments before the keywords are applied to activate your entries.  This user-script provides an option to allow comments to remain during the keyword search and remove them prior to insertion.

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

Again, due to a lack of any sort of means to apply logic or constraints to keywords, you can only do so much with this trick.  The lack of control over activation is pretty limiting.

## Context-Groups

**NOTE: due to limited applications for this feature, the release version is currently shipping with this disabled.  If you'd like to turn it on, you will need to change the configuration and build it yourself.**

Context-groups are an alternative to sub-contexts.  It's meant to support the (not yet available) weighted-random selection feature by allowing lorebook entries to compete based on their apparent relevancy instead of just "insertion order" alone.

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