import _conforms from "lodash/conforms";
import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import ContextBuilder from "@nai/ContextBuilder";
import $ContextContent from "../../ContextContent";
import $ContextSource from "../../ContextSource";
import $Common from "../_common";
import $SelectionPhase from "../30-selection";
import $AssemblyPhase from "../40-assembly";
import $ExportPhase from "../50-export";

import type { ContextParams } from "../../ParamsService";
import type { ActivatedSource, ActivationMap } from "../_common/activation";
import type { CategorizedSource, SubContextCategory } from "../_common/categories";
import type { SubContextSource } from "../_common/subContexts";
import type { SourcePhaseResult } from "../10-source";

type ACSource = ActivatedSource & CategorizedSource;

export default usModule((require, exports) => {
  const { REASONS } = require(ContextBuilder);
  const { categories } = $Common(require);
  const { ContextContent } = $ContextContent(require);
  const contextSource = $ContextSource(require);

  const createSource = (
    contextParams: ContextParams,
    storySource: SourcePhaseResult["storySource"],
    categoryMap: Map<string, SubContextCategory>
  ) => {
    // We will need to reproduce the selection and assembly process,
    // but for each category with a sub-context configuration.
    const { phaseRunner: selectionRunner } = $SelectionPhase(require);
    const { phaseRunner: assemblyRunner } = $AssemblyPhase(require);
    const { phaseRunner: exportRunner } = $ExportPhase(require);

    return (group: rx.GroupedObservable<string, ACSource>) => {
      const category = categoryMap.get(group.key);

      // If no category was found, we'll just pass them out.
      if (!category) return rx.from(group);

      const { contextConfig } = category.subcontextSettings;
      
      const subContextParams = Object.freeze({
        ...contextParams,
        contextName: category.name,
        // Constrain the context size to the context's token budget.
        contextSize: Math.min(contextConfig.tokenBudget, contextParams.contextSize),
        // Let everything know we're doing a sub-context.
        forSubContext: true
      });

      return group.pipe(
        rxop.toArray(),
        // Yeah, this is a bit unnecessary, considering `selectionRunner`
        // is just going to flatten it out again, but whatever.
        rxop.map((activated) => new Set(activated)),
        // Run through the remaining phases with these limited entries,
        // producing a new source from the assembled context.
        (activatedSet) => {
          const selected = selectionRunner(
            subContextParams,
            storySource,
            activatedSet
          );

          const assembled = assemblyRunner(
            subContextParams,
            selected.totalReservedTokens,
            selected.inFlight,
            // No context-groups are in use here.
            rx.EMPTY
          );

          const exported = exportRunner(
            subContextParams,
            // These would be rejections from the pre-selection phases.
            // We don't have any of those for a sub-context.
            rx.EMPTY,
            rx.EMPTY,
            rx.EMPTY,
            rx.EMPTY,
            // Now we're back to it.
            selected.unselected,
            assembled.rejections,
            assembled.insertions,
            assembled.assembly
          );

          return exported.contextRecorder;
        },
        rxop.mergeMap(async (recorder): Promise<SubContextSource> => {
          const theField = { text: recorder.output, contextConfig };
          const theContent = await ContextContent.forField(theField, contextParams);
          return Object.assign(
            contextSource.create(theContent, "lore", `S:${category.name}`),
            {
              enabled: true as const,
              activated: true as const,
              activations: new Map([["forced", REASONS.Default]]) as ActivationMap,
              subContext: recorder
            }
          );
        })
      );
    };
  }

  const createStream = (
    /** The context params. */
    contextParams: ContextParams,
    /** The story's source. */
    storySource: SourcePhaseResult["storySource"]
  ) => {
    // Create a map of the categories for look up.
    const categoryMap = new Map(
      contextParams.storyContent.lorebook.categories
        .filter(categories.isSubContextCategory)
        .map((cat) => [cat.id ?? cat.name, cat] as const)
    );

    return (sources: rx.Observable<ActivatedSource>) => {
      // First, we'll need to partition the categorized entries from
      // other entries.  We'll stream them back out toward the end.
      const [categorized, theRest] = rx.partition(sources, categories.isCategorized);

      return rx.merge(
        theRest,
        categorized.pipe(
          rxop.groupBy((s) => s.entry.fieldConfig.category),
          rxop.mergeMap(createSource(contextParams, storySource, categoryMap))
        )
      );
    };
  }

  return Object.assign(exports, { createStream });
});