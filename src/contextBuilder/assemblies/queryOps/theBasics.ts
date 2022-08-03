import { isString } from "@utils/is";
import * as IterOps from "@utils/iterables";

import type { IFragmentAssembly } from "../_interfaces";

/** Iterates through any `assembly`.  May be `reversed`. */
export function* iterateOn(
  assembly: IFragmentAssembly,
  reversed: boolean = false
) {
  const { prefix, content, suffix } = assembly;

  if (reversed) {
    if (suffix.content) yield suffix;
    for (const value of IterOps.iterReverse(content)) yield value;
    if (prefix.content) yield prefix;
  }
  else {
    if (prefix.content) yield prefix;
    for (const value of content) yield value;
    if (suffix.content) yield suffix;
  }
}

/**
 * Gets the first non-empty fragment of an assembly, if one exists.
 */
export const getFirstFragment = (assembly: IFragmentAssembly) =>
  IterOps.first(iterateOn(assembly));

/** Gets the last non-empty fragment of an assembly, if one exists. */
export const getLastFragment = (assembly: IFragmentAssembly) =>
  IterOps.last(iterateOn(assembly));

/**
 * Gets the source assembly of an assembly.
 * 
 * This returns the given assembly if it has a nullish `source` property.
 */
export const getSource = (assembly: IFragmentAssembly) =>
  assembly.source ?? assembly;

/**
 * Gets the text for an assembly.
 * 
 * Will attempt to use the `text` property unless `force` is true.
 */
export const getText = (assembly: IFragmentAssembly, force = false) => {
  if (!force && isString(assembly.text)) return assembly.text;
  return [...iterateOn(assembly)].map((f) => f.content).join("");
};

/** Checks if two assemblies have the same source, and thus, comparable content. */
export const checkRelated = (a: IFragmentAssembly, b: IFragmentAssembly) =>
  getSource(a) === getSource(b);

/** Checks if the given assembly has a prefix or suffix. */
export const isAffixed = (assembly: IFragmentAssembly) => {
  if (assembly.prefix.content) return true;
  if (assembly.suffix.content) return true;
  return false;
};

/** Checks if the given assembly is entirely empty. */
export const isEmpty = (assembly: IFragmentAssembly) =>
  !isAffixed(assembly) && IterOps.isEmpty(assembly.content);

/** Determines if the given assembly is a source assembly. */
export const isSource = (assembly: IFragmentAssembly) =>
  getSource(assembly) === assembly;