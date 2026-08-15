/**
 * Seeded value noise, for world generation.
 *
 * Deliberately value noise rather than Perlin or simplex: it is a few lines,
 * has no patent history, and is far more than good enough for the "simple map
 * generation" this project calls for. Terrain quality is not what makes this
 * game interesting — the settlement simulation is.
 *
 * Determinism comes from the {@link RandomSource} handed to the constructor;
 * the same seed always yields the same field.
 */

import type { RandomSource } from './random';

/** Smoothstep: eases the 0..1 interpolant so lattice edges are not visible. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * A tileable lattice of random values, sampled with smoothed bilinear
 * interpolation.
 */
export class ValueNoise2D {
  private readonly size: number;
  private readonly values: Float64Array;

  /**
   * @param random deterministic source; consumed `size * size` times
   * @param size lattice resolution — smaller means larger, smoother features
   */
  constructor(random: RandomSource, size: number) {
    this.size = Math.max(2, Math.floor(size));
    this.values = new Float64Array(this.size * this.size);
    for (let i = 0; i < this.values.length; i += 1) {
      this.values[i] = random.next();
    }
  }

  /** Lattice lookup, wrapping at the edges so the field never runs out. */
  private at(ix: number, iy: number): number {
    const x = ((ix % this.size) + this.size) % this.size;
    const y = ((iy % this.size) + this.size) % this.size;
    return this.values[y * this.size + x] ?? 0;
  }

  /**
   * Samples the field at lattice coordinates.
   *
   * @returns a value in `[0, 1]`
   */
  public sample(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);

    const top = lerp(this.at(x0, y0), this.at(x0 + 1, y0), tx);
    const bottom = lerp(this.at(x0, y0 + 1), this.at(x0 + 1, y0 + 1), tx);
    return lerp(top, bottom, ty);
  }

  /**
   * Sums several octaves, each doubling in frequency and halving in amplitude.
   *
   * Gives large landmasses their overall shape while keeping the edges from
   * looking artificially smooth.
   *
   * @returns a value in `[0, 1]`
   */
  public fractal(x: number, y: number, octaves = 3, persistence = 0.5): number {
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxAmplitude = 0;

    for (let octave = 0; octave < octaves; octave += 1) {
      total += this.sample(x * frequency, y * frequency) * amplitude;
      maxAmplitude += amplitude;
      amplitude *= persistence;
      frequency *= 2;
    }

    return maxAmplitude === 0 ? 0 : total / maxAmplitude;
  }
}
