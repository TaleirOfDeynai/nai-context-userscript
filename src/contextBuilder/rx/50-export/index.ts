/**
 * Takes the user-script data and converts it into NovelAI's containers.
 * 
 * Hopefully, this is one of the few places where we're directly interacting
 * with NovelAI's interfaces, just to minimize the problem space.
 */

import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import { lazyObject } from "@utils/object";
import NaiContextBuilder from "@nai/ContextBuilder";
import $QueryOps from "../../assemblies/queryOps";
import $Helpers from "./_helpers";
import $Statuses from "./statuses";
import $StageReports from "./stageReports";
import $Preamble from "./preamble";

import type { ContextRecorder, StructuredOutput } from "@nai/ContextBuilder";
import type { ContextParams } from "../../ParamsService";
import type { SourcePhaseResult } from "../10-source";
import type { ActivationPhaseResult } from "../20-activation";
import type { BiasGroupPhaseResult } from "../30-biasGroups";
import type { SelectionPhaseResult } from "../30-selection";
import type { AssemblyPhaseResult } from "../40-assembly";

export interface ExportPhaseResult {
  readonly contextRecorder: rx.Observable<ContextRecorder>;
}

export default usModule((require, exports) => {
  const { ContextRecorder } = require(NaiContextBuilder);

  const queryOps = $QueryOps(require);
  const helpers = $Helpers(require);
  const statuses = $Statuses(require);
  const stageReports = $StageReports(require);
  const preamble = $Preamble(require);

  function exportPhase(
    /** The context builder parameters. */
    contextParams: ContextParams,
    /** The story's source. */
    storySource: SourcePhaseResult["storySource"],
    /** The disabled sources. */
    disabledSources: SourcePhaseResult["disabledSources"],
    /** The activated bias-groups. */
    biasGroups: BiasGroupPhaseResult["biasGroups"],
    /** The sources that failed activation. */
    inactiveSources: ActivationPhaseResult["rejected"],
    /** The sources that were discarded during selection. */
    unselectedSources: SelectionPhaseResult["unselected"],
    /** The rejected insertions. */
    unbudgetedResults: AssemblyPhaseResult["rejections"],
    /** The successful insertions. */
    insertedResults: AssemblyPhaseResult["insertions"],
    /** The final assembly. */
    finalAssembly: AssemblyPhaseResult["assembly"]
  ): ExportPhaseResult {
    const allDisabled = disabledSources.pipe(statuses.forDisabled, rxop.share());
    const allRejected = rx.merge(
      inactiveSources.pipe(rxop.mergeAll(), statuses.forInactive),
      unselectedSources.pipe(rxop.mergeAll(), statuses.forUnselected)
    ).pipe(rxop.share());
    const allIncluded = insertedResults.pipe(statuses.forInserted, rxop.share());
    const allStatuses = rx.merge(
      unbudgetedResults.pipe(statuses.forUnbudgeted),
      allDisabled,
      allRejected,
      allIncluded
    ).pipe(rxop.share());

    // The name implies there's shenanigans afoot.
    const isStoryTrimmed = helpers.isStoryTrimmedSortOfIDK(allStatuses);

    // This ended up being oddly elegant.  Just convert streams directly
    // into properties to be assigned.
    const recorderProps = rx.forkJoin({
      maxTokens: Promise.resolve(contextParams.contextSize),
      tokenizerType: Promise.resolve(contextParams.tokenizerType),
      preContextText: storySource.pipe(
        rxop.map((s) => s.entry.insertedText),
        rxop.map((s) => queryOps.getText(s)),
        rxop.defaultIfEmpty("")
      ),
      output: finalAssembly.pipe(
        rxop.map((a) => a.text),
        rxop.defaultIfEmpty("")
      ),
      tokens: finalAssembly.pipe(
        rxop.map((a) => [...a.tokens]),
        rxop.defaultIfEmpty([] as number[])
      ),
      structuredOutput: insertedResults.pipe(
        rxop.lastOrEmpty(),
        rxop.map((r) => r.structuredOutput),
        rxop.defaultIfEmpty([] as StructuredOutput[])
      ),
      stageReports: stageReports.createStream(insertedResults).pipe(rxop.toArray()),
      contextStatuses: allStatuses.pipe(rxop.toArray()),
      keyRejections: allRejected.pipe(rxop.toArray()),
      disabled: allDisabled.pipe(rxop.toArray()),
      biases: biasGroups.pipe(rxop.defaultIfEmpty([])),
      orderZeroPoint: helpers.orderZeroPoint(insertedResults),
      storyTrimmed: isStoryTrimmed,
      preamble: preamble.createStream(contextParams, allIncluded, isStoryTrimmed)
    });

    return lazyObject({
      contextRecorder: () => recorderProps.pipe(
        rxop.map((props) => Object.assign(new ContextRecorder(), props)),
        rxop.single(),
        rxop.shareReplay(1)
      )
    });
  }

  return Object.assign(exports, { phaseRunner: exportPhase });
});