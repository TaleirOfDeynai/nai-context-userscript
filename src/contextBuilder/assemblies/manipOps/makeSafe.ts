import usConfig from "@config";
import { assert } from "@utils/assert";
import { isPojo } from "@utils/is";
import { toImmutable } from "@utils/iterables";
import { isSource } from "../queryOps/theBasics";

import type { TextFragment } from "../../TextSplitterService";
import type { IFragmentAssembly } from "../Fragment";

export interface ISafeAssembly extends IFragmentAssembly {
  content: readonly TextFragment[];
};

/**
 * For classes that are going to wrap a {@link IFragmentAssembly}, this
 * function will ensure that the instance is stabilized.  This is to
 * prevent deep getter/setter recursion and ensure that the `content`
 * property is a materialized iterable.
 * 
 * Asserts that the given assembly satisfies the following:
 * - Its `prefix` has an offset of `0`.
 * - Its `content` does not contain any empty fragments.
 *   - Many assembly operators expect the content to contain only
 *     non-empty fragments.
 *   - Only checked during testing or when debug mode is enabled as it can
 *     get expensive to run this check.
 * 
 * If either of these assertions fail, an error is thrown.
 * 
 * Additionally, it runs these checks on the given assembly:
 * - Ensures that the assembly is a plain object.
 * - Ensures that the assembly's content is a readonly array.
 * 
 * If either of these checks fail, it returns a new object instance that
 * has the minimum number of properties to fit the {@link IFragmentAssembly}
 * interface.
 */
export default function makeSafe(assembly: IFragmentAssembly): ISafeAssembly {
  // We make assumptions that the prefix fragment is always at offset 0.
  assert(
    "Expected prefix's offset to be 0.",
    assembly.prefix.offset === 0
  );

  const content = toImmutable(assembly.content);

  if (usConfig.debugLogging || usConfig.inTestEnv) {
    // Because I'm tired of coding around this possibility.
    // Note: this does allow `content` to be empty, but if it contains
    // fragments, they must all be non-empty.
    assert(
      "Expected content to contain only non-empty fragments.",
      content.every((f) => Boolean(f.content))
    );
  }

  checks: {
    // This may be a wrapped assembly; we'll want to recompose it.
    if (!isPojo(assembly)) break checks;
    // Do not trust mutable assemblies.
    if (!Object.isFrozen(assembly)) break checks;
    // It was not readonly, so we'll want a new instance.
    if (content !== assembly.content) break checks;
    return assembly as ISafeAssembly;
  }

  // Recompose the object with the new content.  We want to do this
  // on a per-property basis, in case this instance is not a POJO.

  // We'll drop the `source` if it's a source.
  if (isSource(assembly)) {
    const { prefix, suffix } = assembly;
    return Object.freeze({ prefix, content, suffix });
  }
  else {
    const { prefix, suffix, source } = assembly;
    return Object.freeze({ prefix, content, suffix, source });
  }
};