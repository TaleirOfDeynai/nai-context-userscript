import { usModule } from "@utils/usModule";
import $Common from "../../_common";

import type { ContextStatus } from "@nai/ContextBuilder";
import type { Assembler } from "../../40-assembly";
import type { BudgetedSource } from "../../_common/selection";

export default usModule((require, exports) => {
  const { subContexts } = $Common(require);

  /** Just type-checks the ContextStatus interface. */
  const checkThis = <T extends Partial<ContextStatus>>(obj: T): T => obj;

  const getSubContextPart = (value: Assembler.Report | BudgetedSource) => {
    const source = "source" in value ? value.source : value;
    if (!source || !subContexts.isSubContextSource(source)) return undefined;
    return { subContext: source.subContext };
  };

  return Object.assign(exports, {
    checkThis,
    getSubContextPart
  });
});