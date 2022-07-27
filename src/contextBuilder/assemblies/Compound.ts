import usConfig from "@config";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { isFunction } from "@utils/is";
import { assert, assertAs, assertExists } from "@utils/assert";
import * as IterOps from "@utils/iterables";
import { chain } from "@utils/iterables";
import ContextBuilder from "@nai/ContextBuilder";
import cursorForDir from "./positionOps/cursorForDir";
import $SearchService from "../SearchService";
import $TextSplitterService from "../TextSplitterService";
import $TokenizedAssembly from "./Tokenized";

import type { UndefOr, AnyValueOf } from "@utils/utility-types";
import type { StructuredOutput, ReportReasons } from "@nai/ContextBuilder";
import type { IContextField } from "@nai/ContextModule";
import type { BudgetedSource } from "../rx/4-selection/_shared";
import type { ContextContent } from "../ContextContent";
import type { AssemblyResultMap } from "../SearchService";
import type { AugmentedTokenCodec, Tokens } from "../TokenizerService";
import type { Cursor } from "../cursors";
import type { ITokenizedAssembly } from "./_interfaces";
import type { FragmentAssembly } from "./Fragment";
import type { TokenizedAssembly } from "./Tokenized";
import type { Position, IterDirection, InsertionPosition } from "./positionOps";

/** The bare minimum needed for an assembly. */
export interface AssemblyLike extends ITokenizedAssembly {
  readonly text: string;
  readonly isEmpty: boolean;

  isRelatedTo: FragmentAssembly["isRelatedTo"];
  isFoundIn: FragmentAssembly["isFoundIn"];
  entryPosition: TokenizedAssembly["entryPosition"];
  locateInsertion: TokenizedAssembly["locateInsertion"];
  shuntOut: TokenizedAssembly["shuntOut"];

  findBest?: FragmentAssembly["findBest"];
  splitAt?: TokenizedAssembly["splitAt"];

  /**
   * Special method for sub-contexts.  Returns a new cursor that is
   * relative to this assembly, but only for the current state of the
   * sub-context (which changes if a sub-assembly is inserted into it).
   */
  adaptCursor?: (cursor: Cursor.Fragment) => UndefOr<Cursor.Fragment>;
}

/** The bare minimum needed for content. */
export interface ContentLike {
  readonly text: string;
  readonly contextConfig: ContextContent["contextConfig"];
  readonly trimmed: Promise<UndefOr<AssemblyLike>>;

  readonly field?: IContextField;
  readonly fieldConfig?: Record<string, unknown>;
  isCursorLoose?: ContextContent["isCursorLoose"];
  rebudget?: ContextContent["rebudget"];
  finalize?: ContextContent["finalize"];
}

/** The bare minimum needed for the source. */
export interface SourceLike {
  readonly identifier: BudgetedSource["identifier"];
  readonly uniqueId: BudgetedSource["uniqueId"];
  readonly type: BudgetedSource["type"];
  readonly entry: ContentLike;

  readonly activations?: BudgetedSource["activations"];
}

export type ShuntingMode = "nearest" | "inDirection";

// A short-hand type alias.
type ActionableResult = Position.SuccessResult | Position.InsertResult;

export namespace Insertion {
  export interface Target {
    readonly index: number;
    readonly assembly: AssemblyLike;
    readonly source: UndefOr<SourceLike>;
  }

  export interface RejectedResult {
    readonly type: "rejected";
    /** May be any string, but NAI uses {@link ReportReasons}. */
    readonly reason: string;
    readonly tokensUsed: 0;
    readonly shunted: 0;
  }

  export interface InitResult {
    readonly type: "initial";
    readonly tokensUsed: number;
    readonly shunted: 0;
  }

  interface MainBase {
    readonly type: Exclude<Position.Result["type"], IterDirection>;
    readonly target: Target;
    readonly tokensUsed: number;
    readonly shunted: number;
  }

  export interface InsertResult extends MainBase {
    readonly type: "inside"
  }

  export interface BeforeResult extends MainBase {
    readonly type: "insertBefore"
  }
  
  export interface AfterResult extends MainBase {
    readonly type: "insertAfter"
  }

  type MainResult = InsertResult | BeforeResult | AfterResult;
  export type SuccessResult = InitResult | MainResult;
  export type Result = RejectedResult | SuccessResult;

  export namespace Iteration {
    export interface State extends InsertionPosition {
      source: SourceLike;
      target: Target;
    }

    export interface Result extends Readonly<State> {
      readonly result: ActionableResult;
    }
  }
}

const isInsertResult = (result: ActionableResult): result is Position.InsertResult =>
  result.type !== "inside";

const theModule = usModule((require, exports) => {
  const { REASONS } = require(ContextBuilder);
  const { findHighestIndex } = $SearchService(require);
  const ss = $TextSplitterService(require);
  const tokenized = $TokenizedAssembly(require);

  const baseReject = { type: "rejected", tokensUsed: 0, shunted: 0 } as const;

  const NO_TEXT: Insertion.RejectedResult
    = Object.freeze({ ...baseReject, reason: REASONS.NoText });

  const NO_SPACE: Insertion.RejectedResult
    = Object.freeze({ ...baseReject, reason: REASONS.NoSpace });

  const NO_KEY: Insertion.RejectedResult
    = Object.freeze({ ...baseReject, reason: REASONS.NoContextKey });

  const toTokens = (f: AssemblyLike) => f.tokens;

  /**
   * This class tracks and assists the context assembly process, tracking
   * consumed tokens and handling the insertion of {@link ContextContent}
   * into the location it needs to be.
   * 
   * This is essentially a collection of {@link TokenizedAssembly}.
   * 
   * Unlike a normal assembly, this type of assembly is not immutable and
   * does not work with the standard assembly operators.
   */
  class CompoundAssembly {
    constructor(codec: AugmentedTokenCodec, tokenBudget: number) {
      this.#codec = codec;
      this.#tokenBudget = tokenBudget;

      this.#assemblies = [];
      this.#tokens = [];
      this.#subContexts = new Set();
      this.#knownSources = new Set();
      this.#textToSource = new Map();
    }

    #subContexts: Set<CompoundAssembly>;
    #knownSources: Set<SourceLike>;
    #textToSource: Map<unknown, SourceLike>;

    /** The codec used to encode the tokens in this assembly. */
    protected get codec(): AugmentedTokenCodec {
      return this.#codec;
    }
    readonly #codec: AugmentedTokenCodec;

    /**
     * The assemblies that make up this assembly.
     * 
     * Do not mutate this array directly.  Don't do it!
     */
    protected get assemblies(): readonly AssemblyLike[] {
      // Scout's honor you won't mutate this array.
      return this.#assemblies;
    }
    #assemblies: AssemblyLike[];

    /** The full, concatenated text of the assembly. */
    get text(): string {
      return this.#assemblies.map((a) => a.text).join("");
    }

    /** The current tokens of the assembly. */
    get tokens(): Tokens {
      return this.#tokens;
    }
    #tokens: Tokens;

    get tokenBudget() {
      return this.#tokenBudget;
    }
    readonly #tokenBudget: number;

    get availableTokens() {
      return Math.max(0, this.tokenBudget - this.tokens.length);
    }

    /**
     * Inserts an assembly into this compound assembly as a sub-assembly.
     */
    async insert(
      source: SourceLike,
      budget: number
    ): Promise<Insertion.Result> {
      // Fast-path: No text, instant rejection (unless it's a sub-context).
      if (source.entry.text === "")
        if (!(source instanceof CompoundAssembly))
          return NO_TEXT;

      // Fast-path: No budget, instant rejection.
      if (!budget) return NO_SPACE;

      // Fast-path: no fancy stuff for the first thing inserted.
      if (!this.#assemblies.length) {
        const inserted = await this.#getAssembly(source.entry, budget);
        if (!inserted) return NO_SPACE;

        return await this.#doInsertInitial(source, inserted);
      }

      // Can we locate a place to start our search for its insertion location?
      const startState = this.#findStart(source);
      if (!startState) return NO_KEY;

      // Can we fit it into the budget?
      const inserted = await this.#getAssembly(source.entry, budget);
      if (!inserted) return NO_SPACE;

      for (const iterResult of this.#iterateInsertion(startState)) {
        const { result } = iterResult;
        switch (iterResult.result.type) {
          case "insertBefore":
          case "insertAfter":
            return await this.#doShuntOut(iterResult, source, inserted, result);
          case "inside":
            return await this.#doInsertInside(iterResult, source, inserted);
          default:
            throw new Error(`Unexpected insertion type: ${(result as any).type}`);
        }
      }

      // Should not happen, but let me know if it does.
      throw new Error("Unexpected end of iteration.");
    }

    /**
     * Lorebook entries can configure when they can split other entries
     * apart and if they themselves may be split apart.  This function
     * runs those checks.
     */
    canSplitInto(
      toInsert: ContentLike,
      toSplit: ContentLike
    ): boolean {
      const canInsert = Boolean(toInsert.fieldConfig?.allowInnerInsertion ?? true);
      const canSplit = Boolean(toSplit.fieldConfig?.allowInsertionInside ?? false);
      return canInsert && canSplit;
    }

    /**
     * Converts this compound assembly into a static {@link TokenizedAssembly}.
     * 
     * The conversion is a destructive process.  All information about assemblies
     * that were inserted will be lost and cursors targeting those assemblies will
     * not be able to be used with this assembly.
     */
    toAssembly(): Promise<TokenizedAssembly> {
      const { text } = this;

      return tokenized.castTo(this.codec, {
        prefix: ss.createFragment("", 0),
        content: Object.freeze([ss.createFragment(text, 0)]),
        suffix: ss.createFragment("", text.length),
        tokens: this.tokens
      });
    }

    /** Yields the structured output of the assembly. */
    *structuredOutput(): Iterable<StructuredOutput> {
      for (const assembly of this.#assemblies) {
        if (assembly instanceof CompoundAssembly) {
          yield* assembly.structuredOutput();
        }
        else {
          const { text } = assembly;
          const { uniqueId: identifier, type } = assertExists(
            "Expected to find source for an assembly.",
            this.findSource(assembly)
          );
          yield { identifier, type, text };
        }
      }
    }

    /** Gets all sources that are within this compound assembly. */
    protected enumerateSources(): Set<SourceLike> {
      if (!this.#subContexts.size) return this.#knownSources;

      return chain(this.#subContexts)
        .flatMap((c) => c.enumerateSources())
        .prepend(this.#knownSources)
        .value((sources) => new Set(sources));
    }

    /**
     * Maps an assembly back to its {@link SourceLike}.
     */
    protected findSource(assembly: AssemblyLike): UndefOr<SourceLike> {
      // First, try the sources we are holding.
      const direct = this.#textToSource.get(assembly.source ?? assembly);
      if (direct) return direct;

      // It's possible that it could be in a sub-context.
      for (const asm of this.#subContexts) {
        const source = asm.findSource(assembly);
        if (source) return source;
      }

      return undefined;
    }

    /** Handle the mending of the tokens. */
    protected async mendTokens(tokensToMend: Tokens[]): Promise<Tokens> {
      return await this.codec.mendTokens(tokensToMend);
    }

    /** Updates the internal state for a successful insertion. */
    protected async updateState(
      newAssemblies: AssemblyLike[],
      tokens: Tokens,
      source: SourceLike,
      inserted: AssemblyLike
    ) {
      const diffLength = tokens.length - this.#tokens.length;

      this.#assemblies = newAssemblies;
      this.#tokens = tokens;
      this.#knownSources.add(source);
      this.#textToSource.set(inserted.source ?? inserted, source);

      if (inserted instanceof CompoundAssembly)
        this.#subContexts.add(inserted);

      // Make sure we clean up the entry.
      await source.entry.finalize?.();

      return diffLength;
    }

    #getActivator(source: SourceLike, target: SourceLike): UndefOr<AssemblyResultMap> {
      const { activations } = source;
      if (!activations) return undefined;

      if (target.type === "story") return activations.get("keyed");

      const { field } = target.entry;
      if (!field) return undefined;

      return activations.get("cascade")?.matches.get(field);
    }

    #handleSelection(
      selection: Cursor.Selection,
      direction: IterDirection,
      assembly: AssemblyLike,
      content: ContentLike
    ): UndefOr<Cursor.Fragment> {
      const cursor = cursorForDir(selection, direction);
      if (assembly.isFoundIn(cursor)) return cursor;

      // The assembly can adapt the cursor itself.  This is used by sub-contexts
      // to convert a cursor for a sub-assembly into one for itself.
      const adapted = assembly.adaptCursor?.(cursor);
      if (adapted) return adapted;

      // A loose cursor is one that referenced searchable text, but that text
      // was absent from the insertable text.  If that's not the case, we can't
      // use this cursor.
      if (!content.isCursorLoose?.(cursor)) return undefined;

      // Otherwise, we'll give it some additional leeway when used in a
      // key-relative context.
      return assembly.findBest?.(cursor);
    }

    #findStart(source: SourceLike): UndefOr<Insertion.Iteration.State> {
      assert(
        "Must have at least one assembly to find a starting location.",
        this.#assemblies.length > 0
      );

      const { fieldConfig, contextConfig: { insertionPosition } } = source.entry;
      const direction = insertionPosition < 0 ? "toTop" : "toBottom";
      const remOffset = direction === "toTop" ? 1 : 0;
      const isKeyRelative = Boolean(fieldConfig?.keyRelative ?? false);

      if (isKeyRelative === true) {
        // We want to find the match closest to the bottom of all content
        // currently in the assembly.
        const matches = chain(this.enumerateSources())
          .collect((origin: SourceLike) => {
            const activator = this.#getActivator(source, origin);
            if (!activator) return undefined;

            const latestMatch = findHighestIndex(activator);
            if (!latestMatch) return undefined;

            const { selection } = latestMatch[1];
            return [origin, selection];
          })
          .value((iter) => new Map(iter));

        if (matches.size === 0) return undefined;

        // To get the one closest to the bottom, iterate in reverse.
        const assemblies = chain(this.#assemblies)
          .thru(IterOps.iterPosition)
          .thru(IterOps.iterReverse)
          .value();

        for (const [index, asm] of assemblies) {
          const source = this.findSource(asm);
          if (!source) continue;

          const selection = matches.get(source);
          if (!selection) continue;

          const cursor = this.#handleSelection(selection, direction, asm, source.entry);
          if (!cursor) continue;

          const target = assertExists(
            `Expected assembly at ${index} to exist.`,
            this.#makeTarget(index)
          );

          return {
            direction, cursor, source, target,
            offset: Math.abs(insertionPosition + remOffset)
          };
        }

        return undefined;
      }
      else {
        const index = direction === "toTop" ? this.#assemblies.length - 1 : 0;
        // We specifically want the position without the insertion type.
        // This places the cursor at the start/end of all the text.
        const cursor = this.#assemblies[index].entryPosition(direction);

        const target = assertExists(
          `Expected assembly at ${index} to exist.`,
          this.#makeTarget(index)
        );

        return {
          direction, cursor, source, target,
          offset: Math.abs(insertionPosition + remOffset)
        };
      }
    }

    async #getAssembly(content: ContentLike, budget: number) {
      if (isFunction(content.rebudget)) return await content.rebudget(budget);

      // If it can't rebudget, the `trimmed` assembly must both exist
      // and fit within the given budget.
      const assembly = await content.trimmed;
      if (!assembly) return undefined;
      if (assembly.tokens.length > budget) return undefined;
      return assembly;
    }

    #makeTarget(index: number): UndefOr<Insertion.Target> {
      const assembly = this.#assemblies.at(index);
      if (!assembly) return undefined;

      const source = this.findSource(assembly);
      return Object.freeze({ index, assembly, source });
    }

    async #doInsertInitial(
      source: SourceLike,
      inserted: AssemblyLike
    ): Promise<Insertion.InitResult> {
      assert("Expected to be empty.", this.#assemblies.length === 0);
      const tokensUsed = await this.updateState(
        [inserted], inserted.tokens, source, inserted
      );

      return { type: "initial", tokensUsed, shunted: 0 };
    }

    /** Inserts adjacent to `index`, based on `iterState.result.type`. */
    async #doInsertAdjacent(
      iterState: Insertion.Iteration.Result,
      source: SourceLike,
      inserted: AssemblyLike,
      type?: Position.InsertResult["type"]
    ): Promise<Insertion.AfterResult | Insertion.BeforeResult> {
      const { target } = iterState;
      const oldAsm = this.#assemblies;

      type ??= assertAs(
        "Expected `iterState.result` to be an `InsertResult`.",
        isInsertResult, iterState.result
      ).type;

      const index = target.index + (type === "insertAfter" ? 1 : 0);
      const asmBefore = oldAsm.slice(0, index);
      const asmAfter = oldAsm.slice(index);

      const newAsm = [...asmBefore, inserted, ...asmAfter];
      const tokens = await this.mendTokens(newAsm.map(toTokens));

      const tokensUsed = await this.updateState(newAsm, tokens, source, inserted);
      return { type, target, tokensUsed, shunted: 0 };
    }

    async #doShuntOut(
      iterResult: Insertion.Iteration.Result,
      source: SourceLike,
      inserted: AssemblyLike,
      shuntRef: Cursor.Fragment | ActionableResult
    ): Promise<Insertion.Result> {
      const { target } = iterResult;

      const result = dew(() => {
        if (shuntRef.type !== "fragment") return shuntRef;
        const { shuntingMode } = usConfig.assembly;
        const direction = shuntingMode === "inDirection" ? iterResult.direction : "nearest";
        return target.assembly.shuntOut(shuntRef, direction);
      });

      // This should not be possible unless the implementation of `shuntOut`
      // changes to allow it...  In which case, this error will hopefully
      // let us know something needs to change here.
      if (!isInsertResult(result))
        throw new Error(`Unexpected shunt direction: ${result.type}`);

      return {
        ...await this.#doInsertAdjacent(iterResult, source, inserted, result.type),
        shunted: result.shunted
      };
    }

    /** Inserts into the assembly at `index`. */
    async #doInsertInside(
      iterResult: Insertion.Iteration.Result,
      source: SourceLike,
      inserted: AssemblyLike
    ): Promise<Insertion.Result> {
      const { target, cursor } = iterResult;
      const oldAsm = this.#assemblies;

      checks: {
        // If there is no source, we can't check if we can even split.
        if (!target.source) break checks;
        // If the entry does not support splitting, shunt it.
        if (!("splitAt" in target.assembly)) break checks;
        if (!isFunction(target.assembly.splitAt)) break checks;
        // If we are disallowed from splitting this entry, shunt it.
        if (!this.canSplitInto(source.entry, target.source.entry)) break checks;

        const splitResult = await target.assembly.splitAt(cursor);
      
        // If the split fails, we'll fail-over to bumping it out instead.
        // I don't think this can actually happen, in practice, but just
        // in case.
        if (!splitResult) break checks;

        const asmBefore = oldAsm.slice(0, target.index);
        const asmAfter = oldAsm.slice(target.index + 1);

        const [splitBefore, splitAfter] = splitResult;
        const newAsm = [...asmBefore, splitBefore, inserted, splitAfter, ...asmAfter];
        const tokens = await this.mendTokens(newAsm.map(toTokens));

        const tokensUsed = await this.updateState(newAsm, tokens, source, inserted);
        return { type: "inside", target, tokensUsed, shunted: 0 };
      }

      // If we got kicked out of the `checks` block, we must do a shunt.
      return await this.#doShuntOut(iterResult, source, inserted, cursor);
    }

    *#iterateInsertion(
      initState: Insertion.Iteration.State
    ): Iterable<Insertion.Iteration.Result> {
      let state = initState;

      const { insertionType } = initState.source.entry.contextConfig;

      // We'll allow only one reversal to avoid infinite loops.
      let didReversal = false;

      while (true) {
        const { index } = state.target;
        const curAsm = this.#assemblies[index];

        // Check for emptiness; `SubContext` will report empty when it
        // has no assemblies inside it, in which case we should skip it.
        if (!curAsm.isEmpty) {
          const result = curAsm.locateInsertion(insertionType, state);

          switch (result.type) {
            case "toTop":
            case "toBottom":
              state.offset = result.remainder;

              if (state.direction === result.type) break;
              if (didReversal) return;
              state.direction = result.type;
              didReversal = true;
              break;
            default:
              yield Object.freeze({ ...state, result });
          }
        }

        const offset = state.direction === "toTop" ? -1 : 1;
        const nextIndex = index + offset;
        const nextTarget = this.#makeTarget(nextIndex);

        if (!nextTarget) {
          // We hit the end.  Insert it before or after the last target.
          const type = state.direction === "toTop" ? "insertBefore" : "insertAfter";
          yield Object.freeze({ ...state, result: { type, shunted: 0 } as const });
          return;
        }

        state.target = nextTarget;
        state.cursor = nextTarget.assembly.entryPosition(
          state.direction,
          insertionType
        );
      }
    }
  }

  return Object.assign(exports, {
    CompoundAssembly
  });
});

export default theModule;
export type CompoundAssembly = InstanceType<ReturnType<typeof theModule>["CompoundAssembly"]>;