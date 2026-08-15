/** Small numeric helpers shared by simulation and presentation code. */

/** Constrains `value` to the inclusive `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/** Linear interpolation between `a` and `b`. `t` is not clamped. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent approach of `current` towards `target`.
 *
 * `smoothing` is the fraction of the remaining distance still left after one
 * second, so the result is identical at 30fps and 144fps.
 */
export function damp(current: number, target: number, smoothing: number, deltaSeconds: number) {
  return lerp(current, target, 1 - Math.pow(smoothing, deltaSeconds));
}

/** `true` when the two values differ by less than `epsilon`. */
export function approximately(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) < epsilon;
}
