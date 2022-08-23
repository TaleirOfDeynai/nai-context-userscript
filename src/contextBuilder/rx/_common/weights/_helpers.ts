import { assert } from "@utils/assert";
import { remap, clamp } from "@utils/numbers";

import type { Weight } from "./index";

interface RemapRange {
  readonly min: number;
  readonly max: number;
}

interface ScalarOptions {
  readonly input?: RemapRange;
  readonly output?: RemapRange;
  readonly clamp?: boolean;
}

const DEFAULT_RANGE = Object.freeze({ min: 0, max: 1 });

/** Creates an additive weight. */
export function add(value: number): Weight {
  assert("Expected value to be greater than or equal to 0.", value >= 0);
  return Object.freeze({ type: "additive", value });
};

/** Creates an multiplicative weight. */
export function scalar(value: number, options?: ScalarOptions): Weight {
  if (options) {
    const { input = DEFAULT_RANGE, output = DEFAULT_RANGE, clamp: doClamp } = options;
    value = remap(
      value,
      input.min, input.max,
      output.min, output.max
    );
    if (doClamp === true) value = clamp(value, output.min, output.max);
  }

  assert("Expected value to be greater than or equal to 0.", value >= 0);
  return Object.freeze({ type: "scalar", value });
};

/** A weight that applies no change. */
export const nil: Weight = scalar(1);