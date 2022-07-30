/**
 * This handles the assembly of category sub-contexts and the removal
 * of entries that ended up incorporated into a sub-context.
 * 
 * Configuration that affects this module:
 * - Becomes a noop when `subContext.groupedInsertion` is `true`.
 */

import _conforms from "lodash/conforms";
import usConfig from "@config";
import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { isUndefined } from "@utils/is";
import ContextBuilder from "@nai/ContextBuilder";
import $ContextContent from "../../ContextContent";
import $ContextSource from "../../ContextSource";
import { categories } from "../_shared";
import $SelectionPhase from "../4-selection";
import $AssemblyPhase from "../5-assembly";
import $ExportPhase from "../6-export";

import type { Categories } from "@nai/Lorebook";
import type { ContextRecorder } from "@nai/ContextBuilder";
import type { TypePredicate } from "@utils/is";
import type { ContextParams } from "../../ParamsService";
import type { SourcePhaseResult } from "../1-source";
import type { ActivatedSource, ActivationMap } from "../2-activation";
import type { CategorizedSource } from "../_shared";

type SubContextCategory = Categories.Category & Categories.WithSubcontext;

export interface SubContextSource extends ActivatedSource {
  subContext: ContextRecorder
};

export default usModule((require, exports) => {
  const { REASONS } = require(ContextBuilder);
  const { ContextContent } = $ContextContent(require);
  const contextSource = $ContextSource(require);

  const isSubContextCategory = _conforms({
    createSubcontext: (v) => v === true,
    subcontextSettings: (v) => !isUndefined(v)
  }) as TypePredicate<SubContextCategory>;

  const isCategorized = categories.isCategorized as TypePredicate<
    ActivatedSource & CategorizedSource,
    ActivatedSource
  >;

  const createStream = (
    /** The context params. */
    contextParams: ContextParams,
    /** The story's source. */
    storySource: SourcePhaseResult["storySource"]
  ) => {
    if (usConfig.subContext.groupedInsertion)
      return (sources: rx.Observable<ActivatedSource>) => sources;
    
    // We will need to reproduce the selection and assembly process,
    // but for each category with a sub-context configuration.
    const { phaseRunner: selectionRunner } = $SelectionPhase(require);
    const { phaseRunner: assemblyRunner } = $AssemblyPhase(require);
    const { phaseRunner: exportRunner } = $ExportPhase(require);

    return (sources: rx.Observable<ActivatedSource>) => {
      // First, we'll need to partition the categorized entries from
      // other entries.  We'll stream them back out toward the end.
      const [categorized, theRest] = rx.partition(sources, isCategorized);
      
      return categorized.pipe(
        rxop.groupBy((s) => s.entry.fieldConfig.category),
        rxop.connect((shared) => {
          // Create a map of the categories for look up.
          const categoryMap = new Map(
            contextParams.storyContent.lorebook.categories
              .filter(isSubContextCategory)
              .map((cat) => [cat.name, cat] as const)
          );

          const theSources = shared.pipe(
            rxop.mergeMap((group) => {
              const category = categoryMap.get(group.key);

              // If no category was found, we'll just pass them out.
              if (!category) return rx.of(group);

              const { contextConfig } = category.subcontextSettings;
              
              const subContextParams = Object.freeze({
                ...contextParams,
                contextName: group.key,
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
                    rx.defer(() => selected.totalReservedTokens),
                    selected.inFlight
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
                    rx.defer(() => selected.unselected).pipe(rxop.mergeAll()),
                    assembled.rejections,
                    assembled.insertions,
                    rx.defer(() => assembled.assembly)
                  );

                  return rx.from(exported.contextRecorder);
                },
                rxop.mergeMap(async (recorder): Promise<SubContextSource> => {
                  const theField = { text: recorder.output, contextConfig };
                  const theContent = await ContextContent.forField(theField, contextParams);
                  return Object.assign(
                    contextSource.create(theContent, "lore", `S:${group.key}`),
                    {
                      enabled: true as const,
                      activated: true as const,
                      activations: new Map([["forced", REASONS.Default]]) as ActivationMap,
                      subContext: recorder
                    }
                  );
                })
              );
            })
          );

          return rx.merge(theRest, theSources);
        })
      );
    };
  }

  return Object.assign(exports, { createStream });
});