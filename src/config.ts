import type { LoreEntryConfig as LEC } from "@nai/Lorebook";
import type { ContextConfig as CC } from "@nai/Lorebook";
import type { LorebookConfig as LC } from "@nai/Lorebook";

/** Configuration options affecting comment removal. */
const comments = {
  /**
   * The context builder receives a flag to enable or disable the
   * removal of comments.  This flag defaults to `true`, but I
   * don't exactly know when NovelAI would explicitly provide
   * `false`.
   * 
   * If you end up seeing comments appear in your context, try enabling
   * this to force comment removal on.
   */
  alwaysRemove: false,
  /**
   * Vanilla NovelAI only removes comments for the story text, and
   * then always before it could be used by keywords.
   * 
   * If this is set to `true`, comments will work for all entries
   * and in the same way.
   */
  standardizeHandling: true,
  /**
   * Vanilla NovelAI removes comments before keyword searching is
   * performed.  If lorebook keywords could match text in comments,
   * they could be used to gain more control over cascade activation
   * by matching unusual text that you wouldn't want inserted into
   * the story.
   * 
   * If this is set to `true`, comments will be retained during the
   * activation phase and removed during the insertion phase.
   * 
   * Note that this won't work well with key-relative insertion,
   * since the key-relative entries need to be able to find a keyword
   * match in the partially assembled context; if it was in a removed
   * comment, that will be impossible.
   */
  searchComments: true
} as const;

/** Configuration options affecting the story entry. */
const story = {
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
  standardizeHandling: true
} as const;

/** Configuration options affecting lorebook features. */
const lorebook = {
  /**
   * Vanilla NovelAI only allows key-relative entries to be inserted
   * when a matching key is found for an item already in context.
   * 
   * Unfortunately, if the only content it can match is inserted after
   * the entry, the entry is effectively useless, which is silly
   * user-experience.
   * 
   * If this is set to `true`, entries that meet the following
   * conditions will automatically reserve their tokens:
   * - The entry has "key relative" enabled.
   * - The entry has "cascading activation" disabled.
   * - The entry does not have a custom token reservation configured.
   * - The entry has a higher insertion priority than the story content.
   * 
   * Any entry that does not meet these conditions will function as it
   * does in vanilla NovelAI.
   * 
   * If the entry's match is not found in the story due to all matches
   * being trimmed out, the entry will simply be dropped and the claimed
   * tokens refunded.
   * 
   * When the tokens are refunded, all currently selected entries
   * with lower insertion priority versus the dropped entry will be
   * re-evaluated to see if they can provide more content.
   * 
   * While this makes context assembly more challenging (to us
   * developers), it removes the burden of complexity off the end-user.
   * They can get their entry in where it's supposed to go without
   * having to concern themselves with token reservations.
   */
  keyRelativeReservations: false
} as const;

/** Configuration options relating to sub-context construction. */
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
  groupedInsertion: false,
  /**
   * For key-relative entries, vanilla NovelAI will only insert the entry
   * if another entry in the same context with a higher insertion priority
   * has text matching at least one keyword.
   * 
   * That is, the context needs to currently contain a match for a key
   * at insertion time.  Because entries of sub-contexts are normally
   * isolated from the root context, these entries cannot find their way
   * into the story.
   * 
   * If this is set to `true` and `useGrouping` is also enabled, a
   * different behavior will be used that will allow key-relative entries
   * belonging to a sub-context to be inserted into the root context
   * instead; they will not be compulsively grouped.
   * 
   * The tokens used by the key-relative entry will still count toward
   * the sub-context's internal budget, even if it is separated from the
   * group.  This allows key-relative entries to work the same everywhere,
   * but be constrained by a budget shared with all entries of a category.
   */
  rootRelativeInsertion: false
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
   * A weighted selection group is created for entries that share the same
   * {@link CC.budgetPriority insertion priority}.
   * 
   * The behavior of {@link LC.orderByKeyLocations} will only apply to
   * insertion order; not selection order.
   */
  groupByInsertionPriority: false,
  /**
   * A weighted selection group is created for entries that belong to the
   * same category sub-context.
   * 
   * This option retains tight control over what ends up in the root
   * context, but allows sub-contexts to be used as a looser option
   * when desired.
   * 
   * The general process can be reasoned like the following:
   * 1) External entries with a higher insertion priority are inserted.
   * 2) When the insertion priority for the whole sub-context is reached,
   *    selection of the category's entries can begin.
   * 3) Within the sub-context, {@link CC.budgetPriority insertion priority}
   *    is ignored for all entries that qualify for random selection, even
   *    if `groupByInsertionPriority` is enabled; the sub-context group
   *    supersedes the insertion priority group.
   * 4) Non-qualifying entries are selected first, then random selection is
   *    performed.
   * 5) Selection is repeated until the sub-context's budget is satisfied
   *    or no entries remain for selection.
   * 
   * If `groupByInsertionPriority` is also enabled, the whole sub-context is
   * treated as a composite entry that is a member of the insertion priority
   * group corresponding to the sub-context's insertion priority.
   * - When `subCategory.groupedInsertion` is `false`:
   *   - If the sub-context contains only entries that do not qualify for
   *     random selection, the whole sub-context will be selected immediately.
   *   - Otherwise, the composite entry has a selection weight equal to the
   *     sum of the weights of all entries within the category that were
   *     selected when the sub-context was assembled in isolation.
   *   - When this composite entry is selected, the entire assembled
   *     sub-context is selected in one go.
   * - When `subCategory.groupedInsertion` is `true`:
   *   - Entries within the category that do not qualify for random selection
   *     will be selected immediately.
   *   - Afterwards, the composite entry has a selection weight equal to the
   *     highest weight of all currently unselected entries within the category.
   *   - When this composite entry is selected, one entry of the sub-context
   *     will then be randomly selected.
   */
  groupBySubContext: false
} as const;

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
  /** Enables debug logging for the user-script. */
  debugLogging: true,
  /** Configuration options affecting comment removal. */
  comments,
  /** Configuration options affecting the story entry. */
  story,
  /** Configuration options affecting lorebook features. */
  lorebook,
  /** Configuration options relating to sub-context construction. */
  subContext,
  /** Configuration options relating to weighted-random selection. */
  weightedRandom,
  /** Configuration options relating to context post-processing. */
  postProcess
} as const;

export default config;