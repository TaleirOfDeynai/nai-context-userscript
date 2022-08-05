import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { dew } from "@utils/dew";
import { usModule } from "@utils/usModule";
import { createLogger } from "@utils/logging";
import ContextBuilder from "@nai/ContextBuilder";
import $CompoundAssembly from "../../assemblies/Compound";
import $Common from "../_common";

import type { ILogger } from "@utils/logging";
import type { StructuredOutput } from "@nai/ContextBuilder";
import type { CompoundAssembly, Insertion } from "../../assemblies/Compound";
import type { ContextParams } from "../../ParamsService";
import type { BudgetedSource, InsertableSource, InsertableObservable } from "../_common/selection";

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
  const { selection } = $Common(require);

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

    readonly #logger: ILogger;
    readonly #assembly: CompoundAssembly;

    #reservedTokens: number;

    get #consumedTokens() {
      return this.#assembly.tokens.length;
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

    #doReport(
      source: InsertableSource,
      result: Insertion.Result,
      prevTokens: number
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
        const structuredOutput = [...this.#assembly.structuredOutput()];

        const description = [
          `"${source.identifier}"`,
          getInsertionText(result),
          getStartText(result),
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

    async #doInsert(source: InsertableSource) {
      const currentTokens = this.#availableTokens;
      // If we actually hit 0 tokens remaining, we're just straight done.
      if (!currentTokens) return this.#doReport(source, NO_SPACE, currentTokens);

      if (selection.isBudgetedSource(source)) {
        this.#updateReservations(source);
        const budget = this.#determineBudget(source);
        const result = await this.#assembly.insert(source, budget);
        return this.#doReport(source, result, currentTokens);
      }
      else {
        // TODO: sub-context stuff.
      }
    }
  }

  const contextAssembler = (
    contextParams: ContextParams,
    reservedTokens: number
  ) => {
    return (selected: InsertableObservable) =>
      new ContextAssembler(contextParams, reservedTokens).connect(selected);
  };

  return Object.assign(exports, {
    contextAssembler
  });
});