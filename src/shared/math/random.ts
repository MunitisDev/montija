/**
 * Seeded pseudo-random number generation.
 *
 * The simulation must be reproducible from a stored seed, so `Math.random()` is
 * forbidden inside `src/simulation` (enforced by ESLint). Every system that
 * needs randomness takes a `RandomSource` instead.
 *
 * The generator is `mulberry32`: a small, fast, well-distributed 32-bit PRNG
 * whose entire state is a single unsigned integer. That matters for saves — the
 * RNG can be serialised as one number and restored exactly.
 */

/** A deterministic source of randomness. */
export interface RandomSource {
  /** Uniform float in `[0, 1)`. */
  next(): number;
  /** Uniform float in `[min, max)`. */
  float(min: number, max: number): number;
  /** Uniform integer in `[minInclusive, maxExclusive)`. */
  int(minInclusive: number, maxExclusive: number): number;
  /** `true` with the given probability (default `0.5`). */
  bool(probability?: number): boolean;
  /** A uniformly chosen element, or `undefined` when the list is empty. */
  pick<T>(items: readonly T[]): T | undefined;
}

/** The serialisable state of a {@link SeededRandom}. */
export interface RandomState {
  readonly seed: number;
  readonly cursor: number;
}

const UINT32 = 0x1_0000_0000;

/**
 * Deterministic {@link RandomSource}.
 *
 * Two instances created with the same seed produce identical sequences, and
 * {@link SeededRandom.getState} / {@link SeededRandom.setState} round-trip
 * exactly, which is what makes save/load and bug reproduction possible.
 */
export class SeededRandom implements RandomSource {
  private readonly seed: number;
  private cursor: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.cursor = this.seed;
  }

  public next(): number {
    this.cursor = (this.cursor + 0x6d2b79f5) >>> 0;
    let t = this.cursor;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  }

  public float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  public int(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) {
      return minInclusive;
    }
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  public bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  public pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) {
      return undefined;
    }
    return items[this.int(0, items.length)];
  }

  /** Captures the exact position in the sequence, for saving. */
  public getState(): RandomState {
    return { seed: this.seed, cursor: this.cursor };
  }

  /** Restores a previously captured position. */
  public setState(state: RandomState): void {
    this.cursor = state.cursor >>> 0;
  }

  /** Rewinds to the very start of the seeded sequence. */
  public reset(): void {
    this.cursor = this.seed;
  }
}

/**
 * Derives a stable child seed from a parent seed and a label.
 *
 * Independent systems (world generation, villager names, weather) should each
 * own a stream so that adding a call in one system does not shift the sequence
 * observed by the others.
 */
export function deriveSeed(parentSeed: number, label: string): number {
  let hash = parentSeed >>> 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = Math.imul(hash ^ label.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
