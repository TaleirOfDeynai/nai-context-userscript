import { Brogue } from "brogue/dist/brogue/brogue";
import _times from "lodash/times";

const br = new Brogue();

br.parseGrammar({
  punct: [".", "!", "?", "~"],
  punctPhrase: "{punct.repeat(3)}",
  anyPunct: [{ "{punct}": 4 }, { "{punctPhrase}": 1 }],
  number: ["1", "2", "3"],
  numberPhrase: ["{number.repeat(1, 5)}", `{.raw("{number}").repeat(1, 5).expand}`],
  wordFrag: ["foo", "bar"],
  word: `{.raw("{wordFrag}").repeat(1, 3).expand}`,
  wordPhrase: [{ "{word}": 1 }, { "{numberPhrase}": 0.2 }],
  sentence: `{.raw("{wordPhrase}").times(8, 20).expand}{anyPunct}`,
  paragraph: `{.raw("{sentence}").times(2, 6).expand}`,
  quoteBlock: "\t{paragraph}",
  commentBlock: `## {.raw("{sentence}").times(1, 2).expand}`
});

/**
 * Outputs the text as is.  This allows you to output text
 * that looks like an expansion.
 * 
 * Usage:
 * `{.raw("{animal}")}` => `"{animal}"`
 */
br.registerModifier("raw", (_ignore, rawText: string) => {
  return rawText;
});

/**
 * Treats the given text as a grammar rule and expands it, allowing
 * for recursive expansions.
 * 
 * Usage:
 * `{.raw("The {animal} runs.").expand}` => `"The dog runs."`
 */
br.registerModifier("expand", (ruleText: string) => {
  return br.expand(ruleText);
});

/**
 * Concatenates the given text with no separation a random number
 * of times between `countMin` and `countMax`.
 */
br.registerModifier("repeat",
  (text: string, countMin: number, countMax = countMin) => {
    ([countMin, countMax] = [Math.min(countMin, countMax), Math.max(countMin, countMax)])
    const count = Math.floor((Math.random() * ((countMax + 1) - countMin)) + countMin);
    return _times(count, () => text).join("");
  }
);

/**
 * Overrides the default `times` modifier, allowing it to repeat
 * the given text a random number of times between `countMin` and
 * `countMax`.
 * 
 * It concatenates with a single space, by default, but it can be
 * specified with `sep`.
 */
br.registerModifier("times",
  (text: string, countMin: number, countMax = countMin, sep: string = " ") => {
    ([countMin, countMax] = [Math.min(countMin, countMax), Math.max(countMin, countMax)])
    const count = Math.floor((Math.random() * ((countMax + 1) - countMin)) + countMin);
    return _times(count, () => text).join(sep);
  }
);

export { br as procGen };

/** Generates a decent text sample. */
export const generateText = () => [
  ..._times(5, () => br.expand("{paragraph}")),
  "",
  br.expand("{quoteBlock}"),
  "",
  ..._times(5, () => br.expand("{paragraph}")),
  "",
  ..._times(10, () => br.expand("{paragraph}")),
].join("\n");

/** Generates a sample of text with comments. */
export const generateWithComments = (locations?: Array<"start" | "middle" | "end">) => {
  const locSet = new Set(locations ?? ["start", "middle", "end"]);
  const genComment = (check: boolean) =>
    check ? _times(2, () => br.expand("{commentBlock}")) : [];

  return [
    ...genComment(locSet.has("start")),
    ..._times(2, () => br.expand("{paragraph}")),
    ...genComment(locSet.has("middle")),
    ..._times(2, () => br.expand("{paragraph}")),
    ...genComment(locSet.has("end")),
  ].join("\n");
};