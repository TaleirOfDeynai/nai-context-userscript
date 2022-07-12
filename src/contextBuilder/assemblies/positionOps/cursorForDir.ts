import { isArray } from "@utils/is";

import type { Cursor, Selection } from "../Cursors";

export type IterDirection = "toTop" | "toBottom";

/**
 * Given a {@link Cursor.Fragment} or a {@link Selection}, produces
 * the cursor suited for the given `direction`.
 */
export default function cursorForDir(
  /** A cursor or selection marking the position of the iteration. */
  position: Cursor.Fragment | Selection,
  /** Which direction to iterate. */
  direction: IterDirection
): Cursor.Fragment {
  if (!isArray(position)) return position as Cursor.Fragment;
  return direction === "toTop" ? position[0] : position[1];
}