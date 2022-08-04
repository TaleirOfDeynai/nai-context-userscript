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
import { getFirstFragment, getLastFragment } from "./queryOps/theBasics";
import $TokenizedAssembly from "./Tokenized";

import type { UndefOr } from "@utils/utility-types";
import type { StructuredOutput } from "@nai/ContextBuilder";
import type { IContextField } from "@nai/ContextModule";
import type { BudgetedSource } from "../rx/_shared";
import type { TrimType } from "../TrimmingProviders";
import type { ContextContent } from "../ContextContent";
import type { AssemblyResultMap, AssemblyResult } from "../SearchService";
import type { AugmentedTokenCodec, Tokens } from "../TokenizerService";
import type { Cursor } from "../cursors";
import type { ITokenizedAssembly } from "./_interfaces";
import type { FragmentAssembly } from "./Fragment";
import type { TokenizedAssembly } from "./Tokenized";
import type { Position, IterDirection, InsertionPosition } from "./positionOps";

// For JSDoc links...
import type { ReportReasons } from "@nai/ContextBuilder";

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
   * Special method for context-groups.  Returns a new cursor that is
   * relative to this assembly, but only for the current state of the
   * group (which changes if a sub-assembly is inserted into it).
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
  /**
   * Stores information on the assembly that is the target of insertion.
   * This information will quickly become outdated as the compound assembly
   * is mutated.
   */
  export interface Target {
    /** The original index of the assembly. */
    readonly index: number;
    /** The assembly instance. */
    readonly assembly: AssemblyLike;
    /** The source of the target. */
    readonly source: UndefOr<SourceLike>;
  }

  export interface BaseLocation {
    readonly insertionType: TrimType;
    readonly direction: IterDirection;
    readonly offset: number;
  }

  export interface EdgeLocation extends BaseLocation {
    readonly isKeyRelative: false;
  }

  export interface KeyedLocation extends BaseLocation {
    readonly isKeyRelative: true;
    readonly matchedKey: AssemblyResult;
  }

  /**
   * Stores information about the requested insertion position for reporting
   * to the user later.
   */
  export type Location = EdgeLocation | KeyedLocation;

  interface BaseResult {
    /** The type of the result. */
    readonly type: string;
    /** The difference in tokens after insertion. */
    readonly tokensUsed: number;
    /** The number of characters the entry was moved from its ideal position. */
    readonly shunted: number;
  }

  export interface RejectedResult extends BaseResult {
    readonly type: "rejected";
    /** May be any string, but NAI uses {@link ReportReasons}. */
    readonly reason: string;
    /** Can never use tokens. */
    readonly tokensUsed: 0;
    /** Can never be shunted. */
    readonly shunted: 0;
  }

  interface BaseSuccessResult extends BaseResult {
    /** The initially requested location. */
    readonly location: Location;
    /** The assembly at the state of insertion. */
    readonly assembly: TokenizedAssembly;
  }

  export interface InitResult extends BaseSuccessResult {
    readonly type: "initial";
    /** Can never be shunted. */
    readonly shunted: 0;
  }

  interface MainBase extends BaseSuccessResult {
    /** The target of insertion. */
    readonly target: Target;
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

  export type SuccessResult = InitResult | InsertResult | BeforeResult | AfterResult;
  export type Result = RejectedResult | SuccessResult;

  export namespace Iteration {
    export interface State extends InsertionPosition {
      /** The source of the entry being inserted. */
      source: SourceLike;
      /** The target of insertion. */
      target: Target;
      /** The initially requested location. */
      location: Location;
    }

    export interface Result extends Readonly<State> {
      readonly result: ActionableResult;
    }
  }
}

const isAdjacentResult = (result: ActionableResult): result is Position.InsertResult =>
  result.type !== "inside";

const isSuccessResult = (result: ActionableResult): result is Position.SuccessResult =>
  result.type === "inside";

const getInsertionData = (source: SourceLike) => {
  const { fieldConfig, contextConfig } = source.entry;
  const { insertionType, insertionPosition } = contextConfig;
  const direction = insertionPosition < 0 ? "toTop" : "toBottom";
  const remOffset = direction === "toTop" ? 1 : 0;
  const isKeyRelative = Boolean(fieldConfig?.keyRelative ?? false);
  const offset = Math.abs(insertionPosition + remOffset);

  return { insertionType, direction, offset, isKeyRelative } as const;
};

function toLocation(data: ReturnType<typeof getInsertionData>): Insertion.EdgeLocation;
function toLocation(data: ReturnType<typeof getInsertionData>, key: AssemblyResult): Insertion.KeyedLocation;
function toLocation(
  data: ReturnType<typeof getInsertionData>,
  matchedKey?: AssemblyResult
): Insertion.Location {
  if (!matchedKey) return Object.freeze({ ...data, isKeyRelative: false });
  return Object.freeze({ ...data, isKeyRelative: true, matchedKey });
}

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

  const toAssembly = async (
    codec: AugmentedTokenCodec,
    inserted: AssemblyLike
  ): Promise<TokenizedAssembly> => {
    if (inserted instanceof CompoundAssembly) return await inserted.toAssembly();
    if (tokenized.isInstance(inserted)) return inserted;
    return await tokenized.castTo(codec, inserted);
  };

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
      this.#groups = new Set();
      this.#knownSources = new Set();
      this.#textToSource = new Map();
    }

    #groups: Set<CompoundAssembly>;
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
      // Fast-path: No text, instant rejection (unless it's a group).
      if (source.entry.text === "")
        if (!(source instanceof CompoundAssembly))
          return NO_TEXT;
      
      // Ensure the budget works for the current state of the assembly.
      budget = this.validateBudget(budget);

      // Fast-path: No budget, instant rejection.
      if (!budget) return NO_SPACE;

      // Fast-path: no fancy stuff for the first thing inserted.
      if (!this.#assemblies.length) {
        const inserted = await this.#getAssembly(source.entry, budget);
        if (!inserted) return NO_SPACE;

        // We'll need at least one assembly to do anything key-relative.
        const data = getInsertionData(source);
        if (data.isKeyRelative) return NO_KEY;

        return await this.#doInsertInitial(source, inserted, toLocation(data));
      }

      // Can we locate a place to start our search for its insertion location?
      const startState = this.#findStart(source);
      if (!startState) return NO_KEY;

      // Can we fit it into the budget?
      const inserted = await this.#getAssembly(source.entry, budget);
      if (!inserted) return NO_SPACE;

      for (const iterResult of this.#iterateInsertion(startState)) {
        const { result } = iterResult;
        switch (result.type) {
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
      // The thing being split can hard veto the split.
      const canSplit = Boolean(toSplit.contextConfig.allowInsertionInside ?? false);
      if (!canSplit) return false;

      // Otherwise, the thing being inserted can explicitly choose to avoid
      // the split, but will insert if it has no opinion.
      return Boolean(toInsert.contextConfig.allowInnerInsertion ?? canSplit);
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
      if (!this.#groups.size) return this.#knownSources;

      return chain(this.#groups)
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

      // It's possible that it could be in a context-group.
      for (const asm of this.#groups) {
        const source = asm.findSource(assembly);
        if (source) return source;
      }

      return undefined;
    }

    /** Ensures that the provided budget works for the assembly. */
    protected validateBudget(budget: number): number {
      return Math.min(this.availableTokens, budget);
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
        this.#groups.add(inserted);

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

      // The assembly can adapt the cursor itself.  This is used by groups
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

      const data = getInsertionData(source);

      if (data.isKeyRelative) {
        // We want to find the match closest to the bottom of all content
        // currently in the assembly.
        const matches = chain(this.enumerateSources())
          .collect((origin: SourceLike) => {
            const activator = this.#getActivator(source, origin);
            if (!activator) return undefined;

            const latestMatch = findHighestIndex(activator);
            if (!latestMatch) return undefined;

            return [origin, latestMatch[1]];
          })
          .value((iter) => new Map(iter));

        if (matches.size === 0) return undefined;

        // To get the one closest to the bottom, iterate in reverse.
        const assemblies = chain(this.#assemblies)
          .thru(IterOps.iterPosition)
          .thru(IterOps.iterReverse)
          .value();

        for (const [index, asm] of assemblies) {
          const asmSource = this.findSource(asm);
          if (!asmSource) continue;

          const matchedKey = matches.get(asmSource);
          if (!matchedKey) continue;

          const cursor = this.#handleSelection(
            matchedKey.selection,
            data.direction,
            asm,
            asmSource.entry
          );
          if (!cursor) continue;

          const target = assertExists(
            `Expected assembly at ${index} to exist.`,
            this.#makeTarget(index)
          );

          return {
            cursor, source, target,
            direction: data.direction,
            offset: data.offset,
            location: toLocation(data, matchedKey)
          };
        }

        return undefined;
      }
      else {
        const index = data.direction === "toTop" ? this.#assemblies.length - 1 : 0;

        const target = assertExists(
          `Expected assembly at ${index} to exist.`,
          this.#makeTarget(index)
        );

        // We specifically want the position without the insertion type.
        // This places the cursor at the start/end of all the text.
        const cursor = target.assembly.entryPosition(data.direction);

        return {
          cursor, source, target,
          direction: data.direction,
          offset: data.offset,
          location: toLocation(data)
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
      inserted: AssemblyLike,
      location: Insertion.Location
    ): Promise<Insertion.InitResult> {
      assert("Expected to be empty.", this.#assemblies.length === 0);

      const tokensUsed = await this.updateState(
        [inserted], inserted.tokens, source, inserted
      );

      return {
        type: "initial",
        tokensUsed,
        shunted: 0,
        location,
        assembly: await toAssembly(this.#codec, inserted)
      };
    }

    /** Inserts adjacent to `index`, based on `iterState.result.type`. */
    async #doInsertAdjacent(
      iterState: Insertion.Iteration.Result,
      source: SourceLike,
      inserted: AssemblyLike,
      overrideType?: Position.InsertResult["type"]
    ): Promise<Insertion.AfterResult | Insertion.BeforeResult> {
      const { target, location } = iterState;
      const oldAsm = this.#assemblies;

      const type = overrideType ?? assertAs(
        "Expected `iterState.result` to be an `InsertResult`.",
        isAdjacentResult, iterState.result
      ).type;

      const index = target.index + (type === "insertAfter" ? 1 : 0);
      const asmBefore = oldAsm.slice(0, index);
      const asmAfter = oldAsm.slice(index);

      const newAsm = [...asmBefore, inserted, ...asmAfter];
      const tokens = await this.mendTokens(newAsm.map(toTokens));

      const tokensUsed = await this.updateState(newAsm, tokens, source, inserted);
      return {
        type, target, location, tokensUsed,
        shunted: 0,
        assembly: await toAssembly(this.#codec, inserted)
      };
    }

    async #doShuntOut(
      iterResult: Insertion.Iteration.Result,
      source: SourceLike,
      inserted: AssemblyLike,
      shuntRef: Cursor.Fragment | ActionableResult
    ): Promise<Insertion.SuccessResult> {
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
      if (!isAdjacentResult(result))
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
    ): Promise<Insertion.SuccessResult> {
      const { target, location, result } = iterResult;
      const oldAsm = this.#assemblies;

      const { cursor } = assertAs(
        "Expected `result.type` to be `\"inside\"`",
        isSuccessResult, result
      );

      // It's possible that the cursor is positioned before the prefix
      // or after the suffix.  In these cases, we don't need to do any
      // splitting and we can just convert them into the appropriate
      // adjacent insertion.
      const firstFrag = getFirstFragment(target.assembly) ?? target.assembly.prefix;
      if (cursor.offset <= ss.beforeFragment(firstFrag))
        return this.#doInsertAdjacent(iterResult, source, inserted, "insertBefore");
      const lastFrag = getLastFragment(target.assembly) ?? target.assembly.suffix;
      if (cursor.offset >= ss.afterFragment(lastFrag))
        return this.#doInsertAdjacent(iterResult, source, inserted, "insertAfter");

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
        return {
          type: "inside",
          target, location, tokensUsed,
          shunted: 0,
          assembly: await toAssembly(this.#codec, inserted)
        };
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
        const curAsm = state.target.assembly;

        // Check for emptiness; `ContextGroup` will report empty when it
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
              break;
          }
        }

        const idxOffset = state.direction === "toTop" ? -1 : 1;
        const nextIndex = state.target.index + idxOffset;
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