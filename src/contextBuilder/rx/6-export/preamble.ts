import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import $NaiInternals from "../../NaiInternals";
import $Helpers from "./_helpers";

import type { ContextStatus, ResolvedPreamble } from "@nai/ContextBuilder";
import type { ContextParams } from "../../ParamsService";

export default usModule((require, exports) => {
  const helpers = $Helpers(require);
  const { getPreamble } = $NaiInternals(require);

  function createStream(
    params: ContextParams,
    allIncluded: rx.Observable<ContextStatus>,
    isStoryTrimmed: rx.Observable<boolean>
  ): rx.Observable<ResolvedPreamble> {
    // Sub-contexts don't need to bother with this.
    if (params.forSubContext) return rx.from([{ str: "", tokens: [] }]);

    return rx.forkJoin([
      Promise.resolve(params.tokenCodec),
      Promise.resolve(params.storyContent.settings.model),
      Promise.resolve(params.storyContent.settings.prefix),
      Promise.resolve(params.prependPreamble),
      helpers.isContextEmpty(allIncluded),
      isStoryTrimmed.pipe(rxop.map((r) => !r))
    ]).pipe(
      rxop.mergeMap((args) => getPreamble(...args))
    );
  }

  return Object.assign(exports, {
    createStream
  });
});