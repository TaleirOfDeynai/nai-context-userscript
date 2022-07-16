import { usModule } from "@utils/usModule";
import { assertExists } from "@utils/assert";
import { protoExtend } from "@utils/object";
import { isEmpty, first, last } from "@utils/iterables";
import $TextSplitterService from "../../TextSplitterService";
import makeCursor from "../../cursors/Fragment";
import $ManipOps from "../manipOps";
import $QueryOps from "../queryOps";
import $SplitAt from "./splitAt";

import type { AugmentedTokenCodec } from "../../TokenizerService";
import type { ITokenizedAssembly } from "../_interfaces";

const NO_TOKENS: Pick<ITokenizedAssembly, "tokens">
  = Object.freeze({ tokens: Object.freeze([]) });

export default usModule((require, exports) => {
  const ss = $TextSplitterService(require);
  const manipOps = $ManipOps(require);
  const queryOps = $QueryOps(require);
  const { splitAt } = $SplitAt(require);

  const removePrefix = async (
    assembly: ITokenizedAssembly,
    tokenCodec: AugmentedTokenCodec
  ): Promise<ITokenizedAssembly> => {
    if (!assembly.prefix.content) return assembly;

    // This needs to be a cursor on the content, so the position
    // after the prefix is the one before the first content fragment.
    const offset = ss.beforeFragment(first(assembly.content) as any);
    const cursor = makeCursor(assembly, offset);
    const { assemblies } = assertExists(
      "Expected to split after the prefix.",
      await splitAt(assembly, tokenCodec, cursor)
    );

    // We want the part after the cursor.
    return assemblies[1];
  };

  const removeSuffix = async (
    assembly: ITokenizedAssembly,
    tokenCodec: AugmentedTokenCodec
  ): Promise<ITokenizedAssembly> => {
    if (!assembly.suffix.content) return assembly;

    // This needs to be a cursor on the content, so the position
    // before the suffix is the one after the last content fragment.
    const offset = ss.afterFragment(last(assembly.content) as any);
    const cursor = makeCursor(assembly, offset);
    const { assemblies } = assertExists(
      "Expected to split before the suffix.",
      await splitAt(assembly, tokenCodec, cursor)
    );

    // We want the part before the cursor.
    return assemblies[0];
  };

  /**
   * Generates a version of the given assembly that has no prefix or suffix.
   * 
   * It still has the same source, so cursors for that source will still
   * work as expected.
   * 
   * This version handles the `tokens` of the assembly as well.
   */
  const removeAffix = async (
    /** The assembly to manipulate. */
    assembly: ITokenizedAssembly,
    /** The token codec to use. */
    tokenCodec: AugmentedTokenCodec,
  ): Promise<ITokenizedAssembly> => {
    // No need if we don't have a prefix or suffix.
    if (!queryOps.isAffixed(assembly)) return assembly;

    // If we have no content, we'll end up with an empty assembly.
    if (isEmpty(assembly.content)) return protoExtend(
      manipOps.removeAffix(assembly),
      NO_TOKENS
    );

    // This can basically be considered two splits: one after the prefix,
    // and one before the suffix.  We'll isolate these into their own helpers.
    assembly = await removePrefix(assembly, tokenCodec);
    return await removeSuffix(assembly, tokenCodec);
  };
 
  return Object.assign(exports, {
    removeAffix
  });
});