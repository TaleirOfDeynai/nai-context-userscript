import * as rx from "@utils/rx";
import * as rxop from "@utils/rxop";
import { usModule } from "@utils/usModule";
import NaiContextBuilder from "@nai/ContextBuilder";

import type { StageReport } from "@nai/ContextBuilder";
import type { Assembler } from "../40-assembly";

export default usModule((require, exports) => {
  const { StageReport } = require(NaiContextBuilder);

  /** Basically a type-checking assertion. */
  const checkThis = <T extends Partial<StageReport>>(obj: T) => obj;

  function createStream(
    /** The successful insertions. */
    insertedResults: rx.Observable<Assembler.Inserted>
  ): rx.Observable<StageReport> {
    return insertedResults.pipe(
      rxop.map((inserted): StageReport => Object.assign(
        new StageReport(),
        checkThis({
          structuredOutput: inserted.structuredOutput,
          reservedTokens: inserted.reservedTokens,
          remainingTokens: inserted.availableTokens,
          usedTokens: inserted.consumedTokens,
          description: inserted.description
        })
      ))
    );
  }

  return Object.assign(exports, {
    createStream
  });
});