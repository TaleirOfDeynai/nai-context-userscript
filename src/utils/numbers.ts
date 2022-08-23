export { default as clamp } from "lodash/clamp";

/**
 * Remaps a number from one range to another.  The result is not
 * clamped to that range.
 */
export const remap = (
  value: number,
  inMin: number, inMax: number,
  outMin: number, outMax: number
) => (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;