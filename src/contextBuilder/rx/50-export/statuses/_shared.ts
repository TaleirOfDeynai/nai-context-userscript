import { dew } from "@utils/dew";
import { subContext } from "../../_shared";

import type { UndefOr } from "@utils/utility-types";
import type { ContextStatus, ContextRecorder } from "@nai/ContextBuilder";
import type { Assembler } from "../../40-assembly";
import type { BudgetedSource, SubContextSource } from "../../_shared";

/** Just type-checks the ContextStatus interface. */
export const checkThis = <T extends Partial<ContextStatus>>(obj: T): T => obj;

export const getSubContextPart = (value: Assembler.Report | BudgetedSource) => {
  const source = "source" in value ? value.source : value;
  if (!source || !subContext.isSubContextSource(source)) return undefined;
  return { subContext: source.subContext };
};