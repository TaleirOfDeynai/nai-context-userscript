import type { ContextStatus } from "@nai/ContextBuilder";

/** Just type-checks the ContextStatus interface. */
export const checkThis = <T extends Partial<ContextStatus>>(obj: T): T => obj;