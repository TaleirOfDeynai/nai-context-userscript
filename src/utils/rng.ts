import seedRandom from "seedrandom";

/**
 * Creates a random number generator using the given seed.
 */
export const createSeededRng = (seed: string): () => number =>
  seedRandom(seed, { global: false });