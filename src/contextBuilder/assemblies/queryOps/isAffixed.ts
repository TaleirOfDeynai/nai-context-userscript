import type { IFragmentAssembly } from "../Fragment";

/** Checks if the given assembly has a prefix or suffix. */
const isAffixed = (assembly: IFragmentAssembly) => {
  if (assembly.prefix.content) return true;
  if (assembly.suffix.content) return true;
  return false;
};

export default isAffixed;