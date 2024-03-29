import { GM_config } from "../../vendor/gm-config/gm_config";
import * as fields from "./fields";

import type { LorebookConfig as LC } from "@nai/Lorebook";
import type { SorterKey } from "../contextBuilder/rx/_common/sorting";
import type { WeigherKey, WeightingConfig } from "../contextBuilder/rx/_common/weights";
import type { ShuntingMode } from "../contextBuilder/assemblies/Compound";

GM_config.init({
  id: "nai-context-userscript",
  title: "NovelAI Custom Context",
  fields: Object.assign({}, 
    fields.section("Sourcing", [
      fields.checkBox("sourcing_standardizeHandling", {
        label: "Standardize Prefix/Suffix Handling"
      })
    ]),
    fields.section("Activation", [
      fields.checkBox("activation_vanillaIntegration", {
        label: "Integrate with Vanilla Searches"
      }),
      fields.checkBox("activation_searchComments", {
        label: "Search Comments"
      })
    ]),
    fields.section("Sub-Context", [
      fields.checkBox("subContext_groupedInsertion", {
        label: "Use Context-Groups"
      })
    ]),
    fields.section("Selection", [
      fields.checkBox("selection_orderByKeyLocations", {
        label: "Order by Key Locations",
        default: false
      }),
      // TODO: Make a UI for this.
      fields.hidden("selection_insertionOrdering", {
        label: "Insertion Ordering",
        default: JSON.stringify([
          "budgetPriority",
          "selectionIndex",
          "contextGroup",
          // "reservation",
          "activationEphemeral",
          "activationForced",
          // "activationStory",
          "storyKeyOrder",
          // "categoryName",
          // "entryName",
          "cascadeFinalDegree",
          "cascadeInitDegree"
        ] as SorterKey[], undefined, 2)
      }),
      fields.subSection("Weighted-Random Selection", [
        fields.checkBox("weightedRandom_enabled", {
          label: "Enable"
        }),
        fields.checkBox("weightedRandom_seedWithStory", {
          label: "Use Story-Seeded Randomness"
        }),
        // TODO: Make a UI for this.
        fields.hidden("weightedRandom_weighting", {
          label: "Weighting Functions",
          default: JSON.stringify([
            ["storyCount", "searchRange"],
            ["cascadeCount", "cascadeRatio"]
          ] as WeightingConfig, undefined, 2)
        }),
        // TODO: Make a UI for this.
        fields.hidden("weightedRandom_selectionOrdering", {
          label: "Selection Ordering",
          default: JSON.stringify([
            "budgetPriority"
          ] as SorterKey[], undefined, 2)
        })
      ])
    ]),
    fields.section("Assembly", [
      fields.select("assembly_shuntingMode", {
        label: "Shunting Mode",
        options: ["In Same Direction", "Nearest"],
        default: "In Same Direction"
      }),
      fields.integer("assembly_satisfactionThreshold", {
        label: "Early Satisfaction Threshold",
        min: 0,
        max: 100,
        default: 10
      })
    ]),
    fields.section(["Debugging", "These options will require refreshing the page."], [
      fields.checkBox("debug_logging", {
        label: "Enable Logging",
        default: false
      }),
      fields.checkBox("debug_timeTrial", {
        label: "Enable Performance Comparison",
        default: false
      })
    ])
  )
});

/** Configuration options affecting activation. */
const activation = {
  /**
   * The vanilla activation checker can be replaced with one that
   * uses the same cache as the custom context-builder.  In cases
   * where NovelAI does its own checks outside of the context-builder,
   * this can be used to avoid the overhead of re-parsing the matcher
   * and can even use the cached results from previous runs when
   * possible.
   */
  get vanillaIntegration() {
    return GM_config.get("activation_vanillaIntegration").valueOf() as boolean;
  },
  /**
   * Vanilla NovelAI removes comments before keyword searching is
   * performed.  If lorebook keywords could match text in comments,
   * they could be used to gain more control over cascade activation
   * by matching unusual text that you wouldn't want inserted into
   * the story.
   * 
   * If this is set to `true`, comments will be retained during the
   * activation phase and removed during the assembly phase.
   * 
   * Note that this won't work well with key-relative insertion,
   * since the key-relative entries need to be able to find a keyword
   * match in the partially assembled context; if it was in a removed
   * comment, that will be impossible.
   */
  get searchComments() {
    return GM_config.get("activation_searchComments").valueOf() as boolean;
  }
};

/** Configuration options affecting entry sourcing. */
const sourcing = {
  /**
   * Vanilla NovelAI includes the prefix and suffix of entries
   * for keyword searches during cascade activation, but during
   * story activation, the prefix and suffix are not included.
   * 
   * If this is set to `true`, the story entry will be treated like
   * any other entry and its prefix and suffix will be searched.
   * 
   * Note: this is a little more complicated, since NovelAI
   * (accidentally?) includes the story in cascade activation, so in
   * the end, cascading entries would have activated off its prefix
   * and suffix if they failed to activate off the story text alone.
   * 
   * This is probably somewhat of a heisenbug waiting to happen.
   */
  get standardizeHandling() {
    return GM_config.get("sourcing_standardizeHandling").valueOf() as boolean;
  }
};

/** Configuration options affecting lorebook features. */
const lorebook = {
  /** Nothing here at the moment. */
};

/** Configuration options relating to sub-context assembly. */
const subContext = {
  /**
   * Vanilla NovelAI pre-processes sub-contexts prior to final assembly,
   * which involves separating all the lorebook entries of a category
   * from the root context and assembling them into a new mega-entry,
   * which is then inserted into the root context.
   * 
   * If this is set to `true`, a different strategy will be used where
   * all entries of a category will not be separated from other entries
   * and will be inserted into the root context according to their
   * insertion order (AKA `budgetPriority`), but they will be anchored
   * to a group positioned according to the sub-context's settings.
   * 
   * This can allow for more flexibility in budgeting the context;
   * entries of the sub-context will only be inserted if entries that
   * do not belong to the sub-context have left room for it at insertion
   * time.
   * 
   * Additionally, this makes entries work more consistently; insertion
   * priority works the same for all entries and only how the entry is
   * positioned changes.  You don't need to consider which "insertion
   * priority" is important when comparing two entries.
   * 
   * This has performance implications that will vary depending on how
   * the lorebook is designed.
   * - This option can be faster if you have a lot of sub-contexts
   *   and the majority of their pre-assembled text would end up trimmed
   *   out when inserted into the root context.  That is, time is not
   *   wasted trimming down text of the sub-context which would
   *   ultimately be discarded anyways.
   * - This option can be slower if the lorebook is budgeted with these
   *   sub-contexts in mind.  The vanilla behavior of assembling the
   *   sub-contexts in isolation can be done concurrently, which results
   *   in better background worker utilization.
   */
  get groupedInsertion() {
    return GM_config.get("subContext_groupedInsertion").valueOf() as boolean;
  }
};

/** Configuration options relating to the selection phase, in general. */
const selection = {
  /**
   * An override to enable the `orderByKeyLocations` capability.  If this
   * is set, lorebooks that do not have this option defined will use this
   * setting.
   */
  get orderByKeyLocations() {
    return GM_config.get("selection_orderByKeyLocations").valueOf() as boolean;
  },
  /**
   * Defines how to sort entries into formal insertion order.
   * 
   * Due to all the concurrency in this user-script, entries quickly get
   * rearranged and shuffled, sometimes in non-deterministic ways.  In
   * order to restore determinism, the entries get sorted prior to the
   * assembly phase.
   * 
   * This array allows you to configure how the entries are to be sorted
   * back into a stable order.  The order you provide sorter keys in is
   * the order of priority, so if `"budgetPriority"` comes before
   * `"reservation"`, when two entries are equal by their budget priority,
   * the tie will then be broken by sorting on whether the entry has a
   * reservation or not.
   * 
   * The allowed sorters are found {@link SorterKey here}.
   * 
   * To have vanilla style ordering, you should structure as so:
   * - `"budgetPriority"`
   * - `"contextGroup"`
   * - `"reservation"`
   * - ...then any other sorters you'd like to apply.
   * 
   * The context builder will still work, regardless of what you throw
   * at it, but it won't work as expected unless you follow the above.
   * 
   * Note: the `"storyKeyOrder"` sorter mimics a secret vanilla feature
   * when {@link LC.orderByKeyLocations orderByKeyLocations} is enabled
   * in the lorebook config, which will order entries by the position
   * of the latest keyword match in the story.  This currently can only
   * be enabled by exporting the lorebook, adding the setting, and
   * re-importing it.
   * 
   * For proper NovelAI behavior, you should make sure this sorter is
   * included in the array as well.
   * 
   * Note: the sorters of `"naturalByType"` and `"naturalByPosition"` are
   * special and will be ignored if used here.  These are the fail-safe
   * sorters and help to make this user-script behave as NovelAI does.
   */
  get insertionOrdering() {
    // TODO: Validate this.
    const cfg = GM_config.get("selection_insertionOrdering").valueOf();
    return JSON.parse(cfg as any) as SorterKey[];
  }
} as const;

/**
 * These options enable different entry selection strategies that affect
 * what entries are ultimately included in the context.
 * 
 * Vanilla NovelAI follows {@link CC.budgetPriority insertion priority},
 * inserting as many entries as possible in this order.  While simple and
 * easy to understand, larger lorebooks have an extremely difficult time
 * budgeting the context such that a good spread of information is
 * provided to the AI.  When too many entries activate, it is hard to stop
 * the context from being saturated with a single dominant topic.
 * 
 * But, all the other stuff that activated related to other topics are
 * important too; you want those to still get representation.  Unfortunately,
 * NovelAI doesn't have any options available for dealing with entry
 * over-selection besides sub-contexts, and they don't really solve the
 * problem (as a sub-context can itself be over-selected).
 * 
 * These options enable weighted-random selection, which groups entries
 * into small pools and then randomly picks from them based on how fitting
 * the entry appears to be for the current story.
 * 
 * Weighted-randomness is not applied in the following cases:
 * - Entries that are {@link LEC.forceActivation always enabled}.
 * - Ephemeral entries.
 * 
 * These entries will always be selected first, before any random selection
 * is applied within a group.
 * 
 * Please note, selection order does not correspond to insertion order.
 * Entries can be selected in any order but they must be inserted in
 * the order specified by {@link CC.budgetPriority insertion priority}.
 */
const weightedRandom = {
  /**
   * Enables the weighted-random selection strategy.
   */
  get enabled() {
    return GM_config.get("weightedRandom_enabled").valueOf() as boolean;
  },
  /**
   * When `true`, randomness will be seeded from the current story text
   * which should, assuming no other changes that would affect the weights,
   * cause the same context to generate on retries.
   */
  get seedWithStory() {
    return GM_config.get("weightedRandom_seedWithStory").valueOf() as boolean;
  },
  /**
   * The weighting function to use in scoring each entry.
   * 
   * The weighting functions are applied in order, so multipliers will
   * affect only the score up to that point.  You can group weighting
   * functions together in sub-arrays:
   * 
   * ```json
   * [
   *   ["fooScorer", "barPenalizer"],
   *   ["bazScorer", "bazAdjustment"],
   *   "barPenalizer"
   * ]
   * ```
   * 
   * Each group will run in isolation and its result will add to the
   * current score; a group result is **always** added.
   * 
   * So in the example:
   * - The score starts at 0.
   * - `"fooScorer"` and `"barPenalizer"` will run and add their result to
   *   the score.
   * - `"bazScorer"` and `"bazAdjustment"` will run and add their result to
   *   the score.
   * - The current score is then run through `"barPenalizer"`, which will
   *   likely apply a multiplier to the result of the two groups.
   * 
   * The allowed weighers are found {@link WeigherKey here}.
   * 
   * Can't wait to design a UI around this configuration value.
   */
  get weighting() {
    // TODO: Validate this.
    const cfg = GM_config.get("weightedRandom_weighting").valueOf();
    return JSON.parse(cfg as any) as WeightingConfig;
  },
  /**
   * Defines the the criteria for ordering and grouping entries into
   * selection groups.  All entries that are found to be equal to one
   * another will be grouped.
   * 
   * These groups are then selected from until exhausted.
   * 
   * This uses the same sorters as {@link selection.insertionOrdering}
   * and the allowed sorters are found {@link SorterKey here}.
   */
  get selectionOrdering() {
    // TODO: Validate this.
    const cfg = GM_config.get("weightedRandom_selectionOrdering").valueOf();
    return JSON.parse(cfg as any) as SorterKey[];
  }
};

/** Configuration options relating to context assembly. */
const assembly = {
  /**
   * When one entry wants to insert into another, but that just isn't
   * going to happen for some reason or another, the alternative is
   * to shunt the entry either before or after the entry that is
   * rejecting it.
   * 
   * One of these options determines how that shunting happens:
   * - `"inDirection"` - If the entry to insert had a positive insertion
   *   position, it will place it after the entry.  If it was negative,
   *   it will be placed before it.
   * - `"nearest"` - Always shunts the entry to the nearest end.
   */
  get shuntingMode(): ShuntingMode {
    switch (GM_config.get("assembly_shuntingMode").valueOf()) {
      case "In Same Direction": return "inDirection";
      default: return "nearest";
    }
  },
  /**
   * The assembler will consider the context's budget satisfied when the
   * number of tokens remaining in the budget is less than or equal to
   * this value.  This should result in faster response times, since it
   * won't waste time trying to squeeze in just one more entry out of the
   * dozens it may have left.
   * 
   * This is a bit of an assumption, but I think any unused tokens will
   * probably be made available to the AI to expand its maximum response
   * length, so they kinda don't go to waste sorta?
   */
  get satisfactionThreshold() {
    return GM_config.get("assembly_satisfactionThreshold").valueOf() as number;
  }
};

/** Configuration options relating to context post-processing. */
const postProcess = {
  /**
   * When `true`, after all entries have been inserted into the context,
   * all key-activated and cascade-activated entries that were inserted
   * adjacent to each other will be formed into a group.
   * 
   * Within each group, information about cascade activation will be used
   * to rearrange the group such that entries that matched other entries
   * in the group through cascade will appear after those other entries.
   * 
   * The intention is to increase coherency of the context without having
   * to be concerned as much with insertion order.  Entries that introduce
   * a topic should appear before entries that elaborate on that topic
   * (assuming that the keywords identify topics).
   * 
   * - Fragments from always-enabled, ephemeral, and content (story, A/N,
   *   memory) entries will break up groups.
   * - Sub-contexts will behave as a composite entry that has the aggregate
   *   activation data of all entries that make up its content.
   *   - However, entries within the sub-context may still be rearranged,
   *     in isolation from the root context.
   */
  reorderUsingCascade: false
} as const;

const config = {
  open() {
    (GM_config as GM_configStruct).open();
  },
  /**
   * Enables debug logging for the user-script.
   * 
   * Setter is for unit testing.
   */
  get debugLogging() {
    return GM_config.get("debug_logging").valueOf() as boolean;
  },
  set debugLogging(value: boolean) {
    GM_config.set("debug_logging", value);
  },
  /**
   * When `true`, both the new and vanilla context builder will run,
   * measuring the performance of both for comparison.  This will
   * happen and the results will be reported to console even when
   * `debugLogging` is `false`.
   * 
   * When `false`, the vanilla context builder will only be invoked if
   * the new one fails.
   */
  get debugTimeTrial() {
    return GM_config.get("debug_timeTrial").valueOf() as boolean;
  },
  /**
   * Whether we're in a test environment.
   * 
   * See `spec-resources/_setup.cts` to see where this gets overridden.
   * This is set to `false` here rather than sniffing out for
   * `process.env.NODE_ENV` so the bundler can optimize out certain
   * branches.
   */
  inTestEnv: false,
  /** Configuration options affecting entry sourcing. */
  sourcing,
  /** Configuration options affecting activation. */
  activation,
  /** Configuration options affecting lorebook features. */
  lorebook,
  /** Configuration options relating to sub-context assembly. */
  subContext,
  /** Configuration options relating to selection. */
  selection,
  /** Configuration options relating to weighted-random selection. */
  weightedRandom,
  /** Configuration options relating to context assembly. */
  assembly,
  /** Configuration options relating to context post-processing. */
  postProcess
} as const;

export default config;