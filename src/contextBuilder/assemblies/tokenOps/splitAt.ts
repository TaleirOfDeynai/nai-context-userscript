import { usModule } from "@utils/usModule";
import { protoExtend } from "@utils/object";
import { getText } from "../queryOps/theBasics";
import $CursorOps from "../cursorOps";
import $ManipOps from "../manipOps";
import getTokensForSplit from "./getTokensForSplit";

import type { AugmentedTokenCodec } from "../../TokenizerService";
import type { Cursor } from "../../cursors";
import type { ITokenizedAssembly } from "../_interfaces";
import type { UndefOr } from "@utils/utility-types";

export interface TokenizedSplitResult {
  /** The split assemblies. */
  assemblies: [ITokenizedAssembly, ITokenizedAssembly];
  /**
   * The cursor indicating the position of the split in the parent assembly.
   * This can change when using `loose` mode.
   */
  cursor: Cursor.Fragment;
};

export default usModule((require, exports) => {
  const cursorOps = $CursorOps(require);
  const manipOps = $ManipOps(require);

  /**
   * Given a cursor placed within this assembly's content, splits this
   * assembly into two assemblies.  The result is a tuple where the
   * first element is the text before the cut and the second element
   * is the text after the cut.
   * 
   * The `suffix` of the first assembly and the `prefix` of the second
   * assembly will be empty, and so may differ from their shared source.
   * 
   * If a cut cannot be made, `undefined` is returned.
   * 
   * This version handles the `tokens` of the assembly as well.
   */
  const splitAt = async(
    /** The assembly to split. */
    assembly: ITokenizedAssembly,
    /** The token codec to use. */
    tokenCodec: AugmentedTokenCodec,
    /**
     * The cursor demarking the position of the cut.
     * 
     * Must be a cursor within the assembly's content.
     */
    cursor: Cursor.Fragment
  ): Promise<UndefOr<TokenizedSplitResult>> => {
    const result = manipOps.splitAt(assembly, cursor);
    if (!result) return undefined;

    const [beforeTokens, afterTokens] = await getTokensForSplit(
      tokenCodec,
      cursorOps.toFullText(assembly, result.cursor).offset,
      assembly.tokens,
      getText(assembly)
    );

    return {
      assemblies: [
        protoExtend(result.assemblies[0], { tokens: beforeTokens }),
        protoExtend(result.assemblies[1], { tokens: afterTokens })
      ],
      cursor: result.cursor
    };
  }
 
  return Object.assign(exports, {
    splitAt
  });
});