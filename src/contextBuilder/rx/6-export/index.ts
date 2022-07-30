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

import type { ResolvedBiasGroup, StructuredOutput, ContextRecorder } from "@nai/ContextBuilder";
import type { CompoundAssembly } from "../../assemblies/Compound";
import type { ContextParams } from "../../ParamsService";
import type { DisabledSource, SourcePhaseResult } from "../1-source";
import type { RejectedSource } from "../2-activation";
import type { BudgetedSource } from "../4-selection";
import type { Assembler } from "../5-assembly";

export interface ExportPhaseResult {
  readonly contextRecorder: Promise<ContextRecorder>;
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
    biasGroups: rx.Observable<ResolvedBiasGroup>,
    /** The disabled sources. */
    disabledSources: rx.Observable<DisabledSource>,
    /** The sources that failed activation. */
    inactiveSources: rx.Observable<RejectedSource>,
    /** The sources that were discarded during selection. */
    unselectedSources: rx.Observable<BudgetedSource>,
    /** The rejected insertions. */
    unbudgetedResults: rx.Observable<Assembler.Rejected>,
    /** The successful insertions. */
    insertedResults: rx.Observable<Assembler.Inserted>,
    /** The final assembly. */
    finalAssembly: rx.Observable<CompoundAssembly>
  ): ExportPhaseResult {
    const allDisabled = disabledSources.pipe(statuses.forDisabled);
    const allRejected = rx.merge(
      inactiveSources.pipe(statuses.forInactive),
      unselectedSources.pipe(statuses.forUnselected),
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
        rxop.map((r) => r.structuredOutput),
        rxop.defaultIfEmpty([] as StructuredOutput[])
      ),
      stageReports: stageReports.createStream(insertedResults).pipe(rxop.toArray()),
      contextStatuses: allIncluded.pipe(rxop.toArray()),
      keyRejections: allRejected.pipe(rxop.toArray()),
      disabled: allDisabled.pipe(rxop.toArray()),
      biases: biasGroups.pipe(rxop.toArray()),
      orderZeroPoint: helpers.orderZeroPoint(insertedResults),
      allStoryIncluded: helpers.allStoryIncluded(allExcluded, allIncluded),
      preamble: preamble.createStream(contextParams, allExcluded, allIncluded)
    });

    const theRecorder = recorderProps.pipe(
      rxop.map((props) => Object.assign(new ContextRecorder(), props)),
      rxop.single(),
      rxop.shareReplay()
    );

    return {
      get contextRecorder() {
        return rx.firstValueFrom(theRecorder);
      }
    };
  }

  return Object.assign(exports, { phaseRunner: exportPhase });
});