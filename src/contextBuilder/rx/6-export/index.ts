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

export default usModule((require, exports) => {
  const naiBuilder = require(NaiContextBuilder);
  const { ContextStatus } = naiBuilder;
  const { StageReport } = naiBuilder;
  const { ContextRecorder } = naiBuilder;

  return Object.assign(exports, { });
});