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
    excluded: rx.Observable<ContextStatus>,
    included: rx.Observable<ContextStatus>
  ): rx.Observable<ResolvedPreamble> {
    // Sub-contexts don't need to bother with this.
    if (params.forSubContext) return rx.from([{ str: "", tokens: [] }]);

    return rx.forkJoin([
      Promise.resolve(params.tokenCodec),
      Promise.resolve(params.storyContent.settings.model),
      Promise.resolve(params.storyContent.settings.prefix),
      Promise.resolve(params.prependPreamble),
      helpers.isContextEmpty(included),
      helpers.allStoryIncluded(excluded, included)
    ]).pipe(
      rxop.mergeMap((args) => getPreamble(...args))
    );
  }

  return Object.assign(exports, {
    createStream
  });
});