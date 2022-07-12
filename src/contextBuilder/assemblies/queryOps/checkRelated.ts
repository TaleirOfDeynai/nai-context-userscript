import type { IFragmentAssembly } from "../Fragment";

/** Checks if two assemblies have the same source, and thus, comparable content. */
export default function checkRelated(a: IFragmentAssembly, b: IFragmentAssembly) {
  return a.source === b.source;
}