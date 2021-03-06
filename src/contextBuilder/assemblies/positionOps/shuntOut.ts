import { usModule } from "@utils/usModule";
import $QueryOps from "../queryOps";
import $CursorOps from "../cursorOps";

import type { Cursor } from "../../cursors";
import type { IFragmentAssembly } from "../_interfaces";
import type { IterDirection } from "./cursorForDir";
import type { Position } from "./locateInsertion";

export default usModule((require, exports) => {
  const queryOps = $QueryOps(require);
  const cursorOps = $CursorOps(require);

  /**
   * When we have a cursor inside this assembly, but we can't split it
   * due to the entry's configuration, this will tell us the nearest side
   * to insert it adjacent to this assembly.
   * 
   * If the cursor could go either way, it will favor toward the top.
   */
  const shuntOut = (
    /** The assembly to work with. */
    assembly: IFragmentAssembly,
    /** The cursor defining the location we're being shunt from. */
    cursor: Cursor.Fragment,
    /** The shunt mode to use. */
    mode: IterDirection | "nearest" = "nearest"
  ): Position.InsertResult => {
    // We actually want to convert this to a full-text cursor, as it
    // simplifies a lot of this.
    const { offset } = cursorOps.toFullText(assembly, cursor);
    const fullLength = queryOps.getText(assembly).length;

    const type
      = mode === "toTop" ? "insertBefore"
      : mode === "toBottom" ? "insertAfter"
      : offset <= fullLength / 2 ? "insertBefore" : "insertAfter";

    const shunted = type === "insertBefore" ? offset : fullLength - offset;
    return { type, shunted };
  };

  return Object.assign(exports, {
    shuntOut
  });
});