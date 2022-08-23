import { assertExists } from "./assert";

import type { UndefOr } from "./utility-types";

/**
 * Class that can randomly select an item from a weighted selection.
 */
class Roulette<T> {
  constructor() {
    this.#entries = [];
    this.#totalWeight = 0;
    this.#count = 0;
  }

  readonly #entries: Array<UndefOr<{ weight: number, data: T }>>;
  #totalWeight: number;

  get count() { return this.#count; }
  #count: number;
  
  #spin() {
    if (this.#count === 0) return -1;
    
    const limit = this.#entries.length;
    const ball = Math.random() * this.#totalWeight;
    let curWeight = 0;
    
    for (let i = 0; i < limit; i++) {
      const curEntry = this.#entries[i];
      if (!curEntry) continue;
      curWeight += curEntry.weight;
      if (ball <= curWeight) return i;
    }
    
    return limit - 1;
  }
  
  /**
   * Adds a value to the pool.
   */
  push(weight: number, data: T) {
    this.#entries.push({ weight, data });
    this.#totalWeight += weight;
    this.#count += 1;
  }
  
  /**
   * Selects a value from the pool.
   */
  pick(): UndefOr<[T, number]> {
    const thePick = this.#spin();
    if (thePick === -1) return undefined;
    const { weight, data } = assertExists(
      "Expected picked entry to exist.",
      this.#entries[thePick]
    );
    return [data, weight];
  }
  
  /**
   * Selects and removes a value from the pool.
   */
  pickAndPop(): UndefOr<[T, number]> {
    const thePick = this.#spin();
    if (thePick === -1) return undefined;
    const { weight, data } = assertExists(
      "Expected picked entry to exist.",
      this.#entries[thePick]
    );

    this.#entries[thePick] = undefined;
    this.#totalWeight -= weight;
    this.#count -= 1;
    return [data, weight];
  }

  /**
   * Creates an iterable that picks values from the pool, removing them
   * as it goes.
   */
  *pickToExhaustion(): Iterable<[T, number]> {
    while (this.#count > 0) yield this.pickAndPop()!;
  }
}

export default Roulette;