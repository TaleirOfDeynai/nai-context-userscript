import { usModule } from "@utils/usModule";
import { isArray } from "@utils/is";
import $CursorOps from "../cursorOps";
import $SequenceOps from "../sequenceOps";
import $AffixForSplit from "./getAffixForSplit";
import { getSource } from "../queryOps/theBasics";

import type { UndefOr } from "@utils/utility-types";
import type { Cursor } from "../../cursors";
import type { IFragmentAssembly } from "../_interfaces";

export default usModule((require, exports) => {
  const cursorOps = $CursorOps(require);
  const seqOps = $SequenceOps(require);
  const { getAffixForSplit } = $AffixForSplit(require);

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
   */
  const splitAt = (
    /** The assembly to split. */
    assembly: IFragmentAssembly,
    /**
     * The cursor demarking the position of the cut.
     * 
     * Must be a cursor within the assembly's content.
     */
    cursor: Cursor.Fragment,
    /**
     * If `true` and no fragment exists in the assembly's content for
     * the cursor, the next best cursor will be used instead as a
     * fallback.
     */
    loose: boolean = false
  ): UndefOr<[IFragmentAssembly, IFragmentAssembly]> => {
    const usedCursor = cursorOps.contentCursorOf(assembly, cursor, loose);
    if (!usedCursor) return undefined;

    const content = isArray(assembly.content) ? assembly.content : [...assembly.content];
    const [beforeCut, afterCut] = seqOps.splitAt(content, usedCursor);
    const [beforeAffix, afterAffix] = getAffixForSplit(assembly);

    return [
      Object.freeze({
        ...beforeAffix,
        content: beforeCut,
        source: getSource(assembly)
      }),
      Object.freeze({
        ...afterAffix,
        content: afterCut,
        source: getSource(assembly)
      })
    ];
  };
 
  return Object.assign(exports, {
    splitAt
  });
});