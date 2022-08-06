import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { assert, assertExists } from "@utils/assert";
import * as IterOps from "@utils/iterables";
import { createLogger } from "@utils/logging";
import ContextBuilder from "@nai/ContextBuilder";
import $CompoundAssembly from "../../assemblies/Compound";
import $ContextGroup from "../../assemblies/ContextGroup";
import $Common from "../_common";

import type { UndefOr } from "@utils/utility-types";
import type { ILogger } from "@utils/logging";
import type { StructuredOutput } from "@nai/ContextBuilder";
import type { CompoundAssembly, Insertion } from "../../assemblies/Compound";
import type { ContextGroup, CategoryGroup } from "../../assemblies/ContextGroup";
import type { ContextParams } from "../../ParamsService";
import type { BudgetedSource, InsertableSource, InsertableObservable } from "../_common/selection";
import type { CategorizedSource } from "../_common/categories";

export namespace Assembler {
  interface Base {
    source: InsertableSource;
    reservedTokens: number;
    availableTokens: number;
    consumedTokens: number;
  }

  export interface Rejected extends Base {
    result: Insertion.RejectedResult;
  }

  export interface Inserted extends Base {
    result: Insertion.SuccessResult;
    structuredOutput: StructuredOutput[];
    description: string;
  }

  export type Report = Rejected | Inserted;
}

export default usModule((require, exports) => {
  const { REASONS } = require(ContextBuilder);
  const { CompoundAssembly } = $CompoundAssembly(require);
  const { isContextGroup, isCategoryGroup } = $ContextGroup(require);
  const { selection, categories } = $Common(require);

  const NO_SPACE = Object.freeze({
    type: "rejected",
    reason: REASONS.NoSpace,
    tokensUsed: 0,
    shunted: 0
  });

  const getInsertionText = (result: Insertion.SuccessResult) => {
    if (result.type === "initial") return undefined;

    const { insertionType, offset } = result.location;
    const pluralize = offset !== 1 ? "s" : "";

    switch (insertionType) {
      case "newline": return `${offset} newline${pluralize}`;
      case "sentence": return `${offset} sentence${pluralize}`;
      case "token": return `${offset} word${pluralize}`;
      default: return undefined;
    }
  };

  const getStartText = (result: Insertion.SuccessResult) => {
    if (result.type === "initial") return undefined;
    const { location } = result;

    if (location.isKeyRelative) {
      switch (location.direction) {
        case "toBottom": return "after last found key";
        case "toTop": return "before last found key";
      }
    }
    else {
      switch (location.direction) {
        case "toBottom": return "from top";
        case "toTop": return "from bottom";
      }
    }
  };

  const getGroupText = (group: UndefOr<ContextGroup>) => {
    if (!group) return undefined;
    return `of group "${group.identifier}"`;
  };

  const getRelativeText = (result: Insertion.SuccessResult) => {
    if (result.type === "initial") return undefined;
    const ident = result.target.source?.identifier;
    if (!ident) return undefined;

    switch (result.type) {
      case "insertBefore": return `and before "${ident}"`;
      case "insertAfter": return `and after "${ident}"`;
      case "inside": return `into "${ident}"`;
    }
  };

  const getShuntingText = (result: Insertion.SuccessResult) =>
    result.shunted ? `(shunted ${result.shunted} characters out of target)` : undefined;
  
  const isInserted = (report: Assembler.Report): report is Assembler.Inserted =>
    report.result.type !== "rejected";
  
  const isRejected = (report: Assembler.Report): report is Assembler.Rejected =>
    report.result.type === "rejected";

  class ContextAssembler {
    constructor(
      contextParams: ContextParams,
      contextGroups: Set<ContextGroup>,
      reservedTokens: number
    ) {
      const { tokenCodec, contextSize, contextName } = contextParams;

      this.#reservedTokens = reservedTokens;

      this.#logger = createLogger(`ContextAssembler: ${contextName}`);
      this.#assembly = new CompoundAssembly(tokenCodec, contextSize);

      this.#reportSubject = new rx.Subject<Assembler.Report>();

      this.#reportObs = this.#reportSubject.pipe(
        this.#logger.measureStream("In-Flight Assembly Reports").markItems((item) => {
          const status = isInserted(item) ? "inserted" : "rejected";
          return `${item.source.identifier} (${status})`;
        }),
        rxop.share()
      );

      // Only category-groups exist at the moment, but who knows when that
      // will change.
      this.#categoryGroups = new Map();
      for (const group of contextGroups) {
        if (!isCategoryGroup(group)) continue;
        const key = group.category.id ?? group.category.name;
        this.#categoryGroups.set(key, group);
      }
    }

    /** The stream of assembler reports. */
    get reports(): rx.Observable<Assembler.Report> {
      return this.#reportObs;
    }
    readonly #reportSubject: rx.Subject<Assembler.Report>;
    readonly #reportObs: rx.Observable<Assembler.Report>;

    /** The stream of reports where an insertion occurred. */
    get insertions(): rx.Observable<Assembler.Inserted> {
      return this.#insertions ??= this.reports.pipe(
        rxop.filter(isInserted),
        rxop.share()
      );
    }
    #insertions: rx.Observable<Assembler.Inserted>

    /** The stream of reports where an insertion was rejected. */
    get rejections(): rx.Observable<Assembler.Rejected> {
      return this.#rejections ??= this.reports.pipe(
        rxop.filter(isRejected),
        rxop.share()
      );
    }
    #rejections: rx.Observable<Assembler.Rejected>;

    /**
     * The final form of the assembly, after the final report has been emitted.
     * 
     * After this emits, the assembler has finished its work.
     */
    get finalAssembly(): rx.Observable<CompoundAssembly> {
      return this.#finalAssembly ??= rx.from([this.#assembly]).pipe(
        rxop.followUpAfter(this.reports),
        rxop.tap((assembly) => this.#logger.info(assembly)),
        rxop.shareReplay(1)
      );
    }
    #finalAssembly: rx.Observable<CompoundAssembly>;

    get #waitingGroups(): Iterable<ContextGroup> {
      return IterOps.chain(this.#categoryGroups.values())
        .filter((group) => !this.#assembly.hasAssembly(group))
        .value();
    }
    get #insertedGroups(): Iterable<ContextGroup> {
      return IterOps.chain(this.#categoryGroups.values())
        .filter((group) => this.#assembly.hasAssembly(group))
        .value();
    }
    readonly #categoryGroups: Map<string, CategoryGroup>;

    readonly #logger: ILogger;
    readonly #assembly: CompoundAssembly;

    #reservedTokens: number;

    get #consumedTokens() {
      const directConsumed = this.#assembly.tokens.length;
      // Must account for tokens from uninserted groups.
      return IterOps.chain(this.#waitingGroups)
        .reduce(directConsumed, (a, g) => a + g.tokens.length);
    }

    /** Amount of tokens available, reservations not taken into account. */
    get #availableTokens() {
      return Math.max(0, this.#assembly.tokenBudget - this.#consumedTokens);
    }

    /** Amount of tokens available for entries without reservations. */
    get #currentBudget() {
      return Math.max(0, this.#assembly.availableTokens - this.#reservedTokens);
    }

    /** Subscribes to `selected` and makes this instance's observables hot. */
    connect(selected: InsertableObservable) {
      // We will need to process each source in order.
      dew(async () => {
        const subject = this.#reportSubject;
        try {
          for await (const source of rx.eachValueFrom(selected))
            await this.#doInsert(source);
          subject.complete();
        }
        catch (err) {
          subject.error(err);
        }
      });

      return this;
    }

    #determineType(source: InsertableSource) {
      // These get inserted regardless, since we should have been informed of them.
      if (isContextGroup(source)) return "group";

      // Categorized entries are preferable inserted into their category group.
      // It is possible that a group was not created for the category.
      catChecks: {
        if (!selection.isBudgetedSource(source)) break catChecks;
        if (!categories.isCategorized(source)) break catChecks;

        const group = this.#categoryGroups.get(source.entry.fieldConfig.category);
        if (!group) break catChecks;
        return "forCategory";
      }

      // The run-of-the-mill entry.
      if (selection.isBudgetedSource(source)) return "basic";

      return "unknown";
    }

    #updateReservations(source: BudgetedSource) {
      const { actualReservedTokens } = source.budgetStats;
      if (actualReservedTokens <= 0) return;
  
      this.#reservedTokens -= actualReservedTokens;
      this.#reservedTokens = Math.max(0, this.#reservedTokens);
    }

    #determineBudget(source: BudgetedSource) {
      const { actualReservedTokens, reservedTokens, tokenBudget } = source.budgetStats;
      if (actualReservedTokens > 0) {
        // Use at least our reserved tokens, more if we have the room.
        const maxBudget = Math.max(reservedTokens, this.#currentBudget);
        return Math.min(tokenBudget, maxBudget);
      }

      return Math.min(tokenBudget, this.#currentBudget);
    }

    #buildStructuredOutput() {
      const fromInserted = this.#assembly.structuredOutput();
      const fromGroups = IterOps.chain(this.#waitingGroups)
        .collect((group) => {
          const tokenCount = group.tokens.length;
          if (tokenCount === 0) return undefined;

          const { identifier, type } = group;
          const text = [
            `<Uninserted context-group "`,
            identifier,
            `" with ${tokenCount} tokens.>\n`
          ].join(" ");

          return { identifier, type, text } as StructuredOutput;
        })
        .toArray();
      
      if (!fromGroups.length) return [...fromInserted];

      // I want a newline between the waiting groups and real entries.
      const init = IterOps.take(fromGroups, fromGroups.length - 1);
      const last = IterOps.last(fromGroups) as StructuredOutput;
      return [
        ...init,
        { ...last, text: `${last.text}\n`},
        ...fromInserted
      ];
    }

    #doReport(
      source: InsertableSource,
      result: Insertion.Result,
      prevTokens: number,
      group?: ContextGroup
    ): void {
      const reservedTokens = this.#reservedTokens;
      const availableTokens = this.#availableTokens;
      const consumedTokens = this.#consumedTokens;

      if (result.type === "rejected") {
        this.#reportSubject.next(Object.freeze({
          source, result,
          reservedTokens,
          availableTokens,
          consumedTokens
        }));
      }
      else {
        const structuredOutput = this.#buildStructuredOutput();

        const description = [
          `"${source.identifier}"`,
          getInsertionText(result),
          getStartText(result),
          getGroupText(group),
          getRelativeText(result),
          getShuntingText(result),
        ].filter(Boolean).join(" ");

        this.#logger.info(`Inserted ${description}; ${prevTokens} => ${availableTokens}`);

        this.#reportSubject.next(Object.freeze({
          source, result,
          reservedTokens,
          availableTokens,
          consumedTokens,
          description,
          structuredOutput
        }));
      }
    }

    async #doInsertEntry(source: BudgetedSource) {
      const currentTokens = this.#availableTokens;
      // If we actually hit 0 tokens remaining, we're just straight done.
      if (!currentTokens) return this.#doReport(source, NO_SPACE, currentTokens);

      this.#updateReservations(source);
      const budget = this.#determineBudget(source);
      const result = await this.#assembly.insert(source, budget);
      this.#doReport(source, result, currentTokens);
    }

    async #doInsertCategoryEntry(source: BudgetedSource & CategorizedSource) {
      const currentTokens = this.#availableTokens;
      // If we actually hit 0 tokens remaining, we're just straight done.
      if (!currentTokens) return this.#doReport(source, NO_SPACE, currentTokens);

      // We insert into the category-group instead, but we still need to do
      // accounting of reservations and the overall budget.
      const catId = source.entry.fieldConfig.category;
      const group = assertExists(
        `Expected to have a category group for ${catId}.`,
        this.#categoryGroups.get(catId)
      );

      this.#updateReservations(source);
      const budget = this.#determineBudget(source);
      const result = await group.insert(source, budget);
      
      if (result.type !== "rejected") {
        // On successful insertions, inform our assembly that a group may have
        // changed so it can do token accounting.  It doesn't matter if the
        // group itself has not yet been inserted; it knows what's up.
        await this.#assembly.updatedGroup(group);
      }

      this.#doReport(source, result, currentTokens, group);
    }

    async #doInsertGroup(group: CategoryGroup) {
      const currentTokens = this.#availableTokens;

      // We will always insert a context-group.  All of its entries should
      // have been budgeted and accounted for ahead of time.
      const result = await this.#assembly.insert(group, this.#assembly.tokenBudget);
      assert(
        `Expected context-group \`${group.identifier}\` to be inserted.`,
        result.type !== "rejected"
      );

      this.#doReport(group, result, currentTokens);
    }

    async #doInsert(source: InsertableSource) {
      switch (this.#determineType(source)) {
        case "basic": return this.#doInsertEntry(source as any);
        case "forCategory": return this.#doInsertCategoryEntry(source as any);
        case "group": return this.#doInsertGroup(source as any);
        default: throw Object.assign(new Error("Unknown source."), { source });
      }
    }
  }

  const contextAssembler = (
    contextParams: ContextParams,
    contextGroups: Set<ContextGroup>,
    reservedTokens: number
  ) => {
    return (selected: InsertableObservable) =>
      new ContextAssembler(contextParams, contextGroups, reservedTokens)
        .connect(selected);
  };

  return Object.assign(exports, {
    contextAssembler
  });
});