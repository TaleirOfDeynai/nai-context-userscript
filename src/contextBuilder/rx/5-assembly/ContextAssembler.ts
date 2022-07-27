import * as rx from "@utils/rx";
import { usModule } from "@utils/usModule";
import { dew } from "@utils/dew";
import { createLogger } from "@utils/logging";
import $CompoundAssembly from "../../assemblies/Compound";

import type { ContextParams } from "../../ParamsService";
import type { BudgetedSource } from "../4-selection/_shared";
import type { SelectionObservable } from "../4-selection";

export default usModule((require, exports) => {
  const { CompoundAssembly } = $CompoundAssembly(require);

  const contextAssembler = (
    contextParams: ContextParams,
    reservedTokens: number
  ) => {
    const logger = createLogger("ContextAssembler");

    const assembled = new CompoundAssembly(
      contextParams.tokenCodec,
      contextParams.contextSize
    );
  
    const state = {
      reservedTokens,

      get consumedTokens() {
        return assembled.tokens.length;
      },
  
      /** Amount of tokens available, reservations not taken into account. */
      get availableTokens() {
        return Math.max(0, assembled.tokenBudget - state.consumedTokens);
      },
  
      /** Amount of tokens available for entries without reservations. */
      get currentBudget() {
        return Math.max(0, state.availableTokens - state.reservedTokens);
      }
    };
  
    const updateReservations = (source: BudgetedSource) => {
      const { actualReservedTokens } = source.budgetStats;
      if (actualReservedTokens <= 0) return;
  
      state.reservedTokens -= actualReservedTokens;
      state.reservedTokens = Math.max(0, state.reservedTokens);
    };
  
    const determineBudget = (source: BudgetedSource) => {
      const { actualReservedTokens, reservedTokens, tokenBudget } = source.budgetStats;
      if (actualReservedTokens > 0) {
        // Use at least our reserved tokens, more if we have the room.
        const maxBudget = Math.max(reservedTokens, state.currentBudget);
        return Math.min(tokenBudget, maxBudget);
      }
  
      return Math.min(tokenBudget, state.currentBudget);
    };
  
    // We're going to process these sequentially using `eachValueFrom`.
    // It would be tricky (but not impossible) to get parallelism going
    // in this phase.
    return async function*(selected: SelectionObservable): AsyncIterable<void> {
      for await (const source of rx.eachValueFrom(selected)) {
        const currentTokens = state.availableTokens;
        // If we actually hit 0 tokens remaining, we're just straight done.
        if (!currentTokens) return;

        updateReservations(source);
        const budget = determineBudget(source);
        const result = await assembled.insert(source, budget);
        if (result.type === "rejected") continue;

        const nextTokens = state.availableTokens;
        logger.info([
          `Inserted "${source.identifier}"`,
          dew(() => {
            if (result.type === "initial") return undefined;
            const ident = result.target.source?.identifier;
            if (!ident) return undefined;

            switch (result.type) {
              case "insertBefore": return `before "${ident}"`;
              case "insertAfter": return `after "${ident}"`;
              case "inside": return `into "${ident}"`;
            }
          }),
          result.shunted ? `(shunted ${result.shunted} characters)` : undefined,
          `; ${currentTokens} => ${nextTokens}`
        ].filter(Boolean).join(" "));
      }

      logger.dir({ finalText: assembled.text });
    };
  };

  return Object.assign(exports, {
    contextAssembler
  });
});