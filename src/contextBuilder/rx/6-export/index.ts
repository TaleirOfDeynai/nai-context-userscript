/**
 * Takes the user-script data and converts it into NovelAI's containers.
 * 
 * Hopefully, this is one of the few places where we're directly interacting
 * with NovelAI's interfaces, just to minimize the problem space.
 */

import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import NaiContextBuilder from "@nai/ContextBuilder";
import $QueryOps from "../../assemblies/queryOps";
import $Helpers from "./_helpers";
import $Statuses from "./statuses";
import $StageReports from "./stageReports";
import $Preamble from "./preamble";

import type { ContextRecorder } from "@nai/ContextBuilder";
import type { ContextParams } from "../../ParamsService";
import type { SourcePhaseResult } from "../1-source";
import type { ActivationPhaseResult } from "../2-activation";
import type { BiasGroupPhaseResult } from "../3-biasGroups";
import type { SelectionPhaseResult } from "../4-selection";
import type { AssemblyPhaseResult } from "../5-assembly";

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
    /** The activated bias-groups. */
    biasGroups: BiasGroupPhaseResult["biasGroups"],
    /** The disabled sources. */
    disabledSources: ActivationPhaseResult["disabled"],
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
    const allDisabled = disabledSources.pipe(rxop.mergeAll(), statuses.forDisabled);
    const allRejected = rx.merge(
      inactiveSources.pipe(rxop.mergeAll(), statuses.forInactive),
      unselectedSources.pipe(rxop.mergeAll(), statuses.forUnselected),
      unbudgetedResults.pipe(statuses.forUnbudgeted)
    );
    const allExcluded = rx.merge(allDisabled, allRejected);
    const allIncluded = insertedResults.pipe(statuses.forInserted);

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
        rxop.last(),
        rxop.catchError(() => rx.of(undefined)),
        rxop.map((r) => r?.structuredOutput ?? [])
      ),
      stageReports: stageReports.createStream(insertedResults).pipe(rxop.toArray()),
      contextStatuses: allIncluded.pipe(rxop.toArray()),
      keyRejections: allRejected.pipe(rxop.toArray()),
      disabled: allDisabled.pipe(rxop.toArray()),
      biases: biasGroups.pipe(rxop.defaultIfEmpty([])),
      orderZeroPoint: helpers.orderZeroPoint(insertedResults),
      storyTrimmed: helpers.allStoryIncluded(allExcluded, allIncluded).pipe(
        rxop.map((b) => !b)
      ),
      preamble: preamble.createStream(contextParams, allExcluded, allIncluded)
    });

    const theRecorder = recorderProps.pipe(
      rxop.map((props) => Object.assign(new ContextRecorder(), props)),
      rxop.single(),
      rxop.shareReplay()
    );

    return {
      get contextRecorder() {
        return theRecorder;
      }
    };
  }

  return Object.assign(exports, { phaseRunner: exportPhase });
});