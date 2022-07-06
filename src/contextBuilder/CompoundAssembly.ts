import userScriptConfig from "@config";
import { usModule } from "@utils/usModule";
import { isFunction } from "@utils/is";
import { assert, assertExists } from "@utils/assert";
import * as IterOps from "@utils/iterables";
import { chain } from "@utils/iterables";
import $SearchService from "./SearchService";

import type { UndefOr } from "@utils/utility-types";
import type { IContextField } from "@nai/ContextModule";
import type { LoreEntry } from "@nai/Lorebook";
import type { BudgetedSource } from "./rx/3-selection/_shared";
import type { ContextContent } from "./ContextContent";
import type { FragmentAssembly, FragmentCursor, InsertionPosition, IterDirection, PositionResult } from "./FragmentAssembly";
import type { TokenizedAssembly } from "./TokenizedAssembly";
import type { AssemblyResultMap } from "./SearchService";
import type { AugmentedTokenCodec, Tokens } from "./TokenizerService";

type InsertableField = Pick<
  LoreEntry,
  keyof IContextField | "allowInnerInsertion" | "allowInsertionInside"
>;

/** The bare minimum needed for an assembly. */
interface AssemblyLike {
  readonly fullText: TokenizedAssembly["fullText"];
  readonly tokens: TokenizedAssembly["tokens"];
  readonly source: FragmentAssembly["source"];

  isFoundIn: FragmentAssembly["isFoundIn"];
  entryPosition: FragmentAssembly["entryPosition"];
  locateInsertion: FragmentAssembly["locateInsertion"];
  shuntOut: FragmentAssembly["shuntOut"];
  splitAt?: TokenizedAssembly["splitAt"];
}

export type ShuntingMode = "nearest" | "inDirection";

export interface InsertionIterationState extends InsertionPosition {
  index: number;
}

namespace Insertion {
  export interface Target {
    readonly index: number;
    readonly assembly: AssemblyLike;
    readonly source: UndefOr<BudgetedSource>;
  }

  interface RejectedResult {
    readonly type: "rejected";
    readonly tokensUsed: 0;
    readonly shunted: 0;
  }

  interface InitResult {
    readonly type: "initial";
    readonly tokensUsed: number;
    readonly shunted: 0;
  }
  
  interface MainResult {
    readonly type: Exclude<PositionResult["type"], IterDirection>;
    readonly target: Target;
    readonly tokensUsed: number;
    readonly shunted: number;
  }

  export type Result = RejectedResult | InitResult | MainResult;
}

export type InsertionResult = Insertion.Result;

const { shuntingMode } = userScriptConfig.assembly;

const REJECTED_INSERT: InsertionResult = Object.freeze({
  type: "rejected", tokensUsed: 0, shunted: 0
});

const theModule = usModule((require, exports) => {
  const { findHighestIndex } = $SearchService(require);

  const toTokens = (f: AssemblyLike) => f.tokens;

  /**
   * This class tracks and assists the context assembly process, tracking
   * consumed tokens and handling the insertion of {@link ContextContent}
   * into the location it needs to be.
   * 
   * This is essentially a collection of {@link TokenizedAssembly}.
   */
  class CompoundAssembly {
    constructor(codec: AugmentedTokenCodec, tokenBudget: number) {
      this.#codec = codec;
      this.#tokenBudget = tokenBudget;

      this.#fragments = [];
      this.#tokens = [];
      this.#knownSources = new Set();
      this.#textToSource = new Map();
    }

    #codec: AugmentedTokenCodec;
    #fragments: AssemblyLike[];
    #knownSources: Set<BudgetedSource>;
    #textToSource: Map<FragmentAssembly, BudgetedSource>;

    /** The full, concatenated text of the assembly. */
    get fullText(): string {
      return this.#fragments.map((a) => a.fullText).join("");
    }

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

    #updateState(
      newFrags: AssemblyLike[],
      tokens: Tokens,
      source: BudgetedSource,
      inserted: AssemblyLike
    ) {
      const diffLength = tokens.length - this.#tokens.length;

      this.#fragments = newFrags;
      this.#tokens = tokens;
      this.#knownSources.add(source);
      this.#textToSource.set(inserted.source, source);

      return diffLength;
    }

    #getActivator(source: BudgetedSource, target: BudgetedSource): UndefOr<AssemblyResultMap> {
      const { activations } = source;
      if (target.type === "story") return activations.get("keyed");
      return activations.get("cascade")?.matches.get(target.entry.field);
    }

    #findStart(source: BudgetedSource): UndefOr<InsertionIterationState> {
      assert(
        "Must have at least one text to find a starting location.",
        this.#fragments.length > 0
      );

      const { insertionPosition } = source.entry.contextConfig;
      const direction = insertionPosition < 0 ? "toTop" : "toBottom";
      const remOffset = direction === "toTop" ? 1 : 0;
      const fieldConfig = source.entry.fieldConfig as any;

      if (fieldConfig.keyRelative === true) {
        // We want to find the match closest to the bottom of all content
        // currently in the assembly.
        const matches = chain(this.#knownSources)
          .collect((origin: BudgetedSource) => {
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
        const fragments = chain(this.#fragments)
          .thru(IterOps.iterPosition)
          .thru(IterOps.iterReverse)
          .value();

        for (const [index, location] of fragments) {
          // TODO: If `location` is composite, we should search inside it.
          const source = this.findSource(location);
          if (!source) continue;

          const selection = matches.get(source);
          if (!selection) continue;

          const position = direction === "toTop" ? selection[0] : selection[1];
          if (!location.isFoundIn(position)) continue;

          return {
            direction, index, position,
            offset: Math.abs(insertionPosition + remOffset)
          };
        }

        return undefined;
      }
      else {
        const index = direction === "toTop" ? this.#fragments.length - 1 : 0;
        const position = this.#fragments[index].entryPosition(direction);

        return {
          direction, index, position,
          offset: Math.abs(insertionPosition + remOffset)
        };
      }
    }

    /** Assumes that token reservations should be adhered to. */
    #determineBudget(source: BudgetedSource): number {
      const { actualReservedTokens, reservedTokens, tokenBudget } = source.budgetStats;
      if (actualReservedTokens > 0) {
        // Use at least our reserved tokens, more if we have the room.
        const maxBudget = Math.max(reservedTokens, this.availableTokens);
        return Math.min(tokenBudget, maxBudget);
      }

      return Math.min(tokenBudget, this.availableTokens);
    }

    #makeTarget(iterState: InsertionIterationState): Insertion.Target {
      const { index } = iterState;
      const assembly = assertExists(
        `Expected to find an assembly at index ${index}`,
        this.#fragments.at(index)
      );
      const source = this.findSource(assembly);
      return Object.freeze({ index, assembly, source });
    }

    #doInsertInitial(
      source: BudgetedSource,
      inserted: AssemblyLike
    ): InsertionResult {
      assert("Expected to be empty.", this.#fragments.length === 0);
      const tokensUsed = this.#updateState([inserted], inserted.tokens, source, inserted);
      return { type: "initial", tokensUsed, shunted: 0 };
    }

    /** Inserts before `index`. */
    async #doInsertBefore(
      iterState: InsertionIterationState,
      source: BudgetedSource,
      inserted: AssemblyLike
    ): Promise<InsertionResult> {
      const { index } = iterState;
      const oldFrags = this.#fragments;

      assert("Expected `index` to be in range.", index >= 0);
      assert("Expected `index` to be in range.", index <= oldFrags.length);

      const fragsBefore = oldFrags.slice(0, index);
      const fragsAfter = oldFrags.slice(index);

      const newFrags = [...fragsBefore, inserted, ...fragsAfter];
      const tokens = await this.#codec.mendTokens(newFrags.map(toTokens));

      const target = this.#makeTarget(iterState);
      const tokensUsed = this.#updateState(newFrags, tokens, source, inserted);

      return { type: "insertBefore", target, tokensUsed, shunted: 0 };
    }

    /** Inserts after `index`. */
    async #doInsertAfter(
      iterState: InsertionIterationState,
      source: BudgetedSource,
      inserted: AssemblyLike
    ): Promise<InsertionResult> {
      const target = this.#makeTarget(iterState);

      // Yeah, just insert it before the next one.  Don't have to do
      // two separate implementations this way.  :P
      const { tokensUsed } = await this.#doInsertBefore(
        { ...iterState, index: iterState.index + 1 },
        source,
        inserted
      );

      // We do need to sort out the target, though.
      return { type: "insertAfter", target, tokensUsed, shunted: 0 };
    }

    async #doShuntOut(
      iterState: InsertionIterationState,
      cursor: FragmentCursor,
      source: BudgetedSource,
      inserted: AssemblyLike
    ): Promise<InsertionResult> {
      const { index } = iterState;

      assert("Expected `index` to be in range.", index >= 0);
      assert("Expected `index` to be in range.", index < this.#fragments.length);

      // TODO: add shunting to all this shit.
      const direction = shuntingMode === "inDirection" ? iterState.direction : "nearest";
      const result = this.#fragments[index].shuntOut(cursor, direction);

      switch (result.type) {
        case "insertBefore": return await this.#doInsertBefore(iterState, source, inserted);
        case "insertAfter": return await this.#doInsertAfter(iterState, source, inserted);
        // This should not be possible unless the implementation of `shuntOut`
        // changes to allow it...  In which case, this error will hopefully
        // let us know something needs to change here.
        default: throw new Error(`Unexpected shunt direction: ${result.type}`);
      }
    }

    /** Inserts into the fragment at `index`. */
    async #doInsertInside(
      iterState: InsertionIterationState,
      cursor: FragmentCursor,
      source: BudgetedSource,
      inserted: AssemblyLike
    ): Promise<InsertionResult> {
      const { index } = iterState;
      const oldFrags = this.#fragments;

      assert("Expected `index` to be in range.", index >= 0);
      assert("Expected `index` to be in range.", index < oldFrags.length);

      const fragsBefore = oldFrags.slice(0, index);
      const fragsAfter = oldFrags.slice(index + 1);

      const target = this.#makeTarget(iterState);

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

        const [splitBefore, splitAfter] = splitResult;
        const newFrags = [...fragsBefore, splitBefore, inserted, splitAfter, ...fragsAfter];
        const tokens = await this.#codec.mendTokens(newFrags.map(toTokens));

        const tokensUsed = this.#updateState(newFrags, tokens, source, inserted);
        return { type: "inside", target, tokensUsed, shunted: 0 };
      }

      // If we got kicked out of the `checks` block, we must do a shunt.
      return await this.#doShuntOut(iterState, cursor, source, inserted);
    }

    async insert(
      source: BudgetedSource,
      budget: number = this.#determineBudget(source)
    ): Promise<InsertionResult> {
      // Fast-path: no budget, instant rejection.
      if (!budget) return REJECTED_INSERT;

      // Fast-path: no fancy stuff for the first thing inserted.
      if (!this.#fragments.length) {
        const inserted = await source.entry.rebudget(budget);
        if (!inserted) return REJECTED_INSERT;

        return this.#doInsertInitial(source, inserted);
      }

      // Can we locate a place to start our search for its insertion location?
      const iterState = this.#findStart(source);
      if (!iterState) return REJECTED_INSERT;

      // Can we fit it into the budget?
      const inserted = await source.entry.rebudget(budget);
      if (!inserted) return REJECTED_INSERT;

      const { insertionType } = source.entry.contextConfig;

      while (true) {
        const { index } = iterState;
        const frag = this.#fragments[index];
        const result = frag.locateInsertion(insertionType, iterState);
        switch (result.type) {
          case "insertBefore":
            return await this.#doInsertBefore(iterState, source, inserted);
          case "insertAfter":
            return await this.#doInsertAfter(iterState, source, inserted);
          case "inside":
            return await this.#doInsertInside(iterState, result.cursor, source, inserted);
          case "toTop":
          case "toBottom": {
            const offset = result.type === "toTop" ? -1 : 1;
            const nextIndex = index + offset;
            const nextFrag = this.#fragments.at(nextIndex);

            if (!nextFrag) {
              if (result.type === "toBottom")
                return await this.#doInsertAfter(iterState, source, inserted);
              return await this.#doInsertBefore(iterState, source, inserted);
            }

            iterState.index = nextIndex;
            iterState.position = nextFrag.entryPosition(result.type);
            iterState.offset = result.remainder;
            continue;
          }
        }
      }
    }

    /**
     * Maps an assembly back to its {@link BudgetedSource}.
     */
    findSource(text: AssemblyLike): UndefOr<BudgetedSource> {
      return this.#textToSource.get(text.source);
    }

    /**
     * Lorebook entries can configure when they can split other entries
     * apart and if they themselves may be split apart.  This function
     * runs those checks.
     */
    canSplitInto(
      toInsert: ContextContent<InsertableField>,
      toSplit: ContextContent<InsertableField>
    ): boolean {
      const canInsert = toInsert.fieldConfig?.allowInnerInsertion ?? true;
      const canSplit = toSplit.fieldConfig?.allowInsertionInside ?? false;
      return canInsert && canSplit;
    }
  }

  return Object.assign(exports, {
    CompoundAssembly
  });
});

export default theModule;
export type CompoundAssembly = InstanceType<ReturnType<typeof theModule>["CompoundAssembly"]>;