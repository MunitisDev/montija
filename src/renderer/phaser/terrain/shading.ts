/**
 * How light behaves in this settlement.
 *
 * One module for the handful of rules every drawn object obeys, because the
 * fastest way to make a scene look wrong — without anybody being able to say
 * why — is two objects lit from different directions or casting shadows that
 * fall different ways.
 *
 * The rules, in full:
 *
 * - **The key light comes from the upper left.** Every lit face is the one
 *   facing up-left; every shaded face is the one facing down-right.
 * - **Everything casts down and to the right**, by {@link SUN_OFFSET} of its
 *   own footprint.
 * - **Contact shadows have a penumbra.** A hard-edged shadow is the loudest
 *   remaining tell that these are flat polygons rather than objects.
 * - **Corners collect gloom.** Light does not reach into the join between two
 *   surfaces, and approximating that is most of what separates a rendered
 *   object from a flat one.
 * - **Seams catch light.** Timber and stone have a rounded arris; one bright
 *   line along a seam is the difference between a corner and a fold in paper.
 *
 * All of it is cheap because every object here is drawn into its texture once,
 * at load, and never again — none of this is per-frame work.
 */

import type Phaser from 'phaser';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * How far a shadow falls from directly beneath, as a fraction of a footprint.
 *
 * One constant rather than a number per caller: the sun is in one place.
 */
export const SUN_OFFSET = 0.18;

/**
 * How far the faintest, widest ring of a shadow reaches past what it is given.
 *
 * Exported because a caller that must keep its shadow inside something — a
 * building inside its own plot — cannot work that out without it.
 */
export const SHADOW_SPREAD = 1.24;

/** Widest and faintest first, so the rings darken towards the object. */
const SHADOW_RINGS: readonly { spread: number; alpha: number }[] = [
  { spread: SHADOW_SPREAD, alpha: 0.07 },
  { spread: 1.1, alpha: 0.09 },
  { spread: 1.0, alpha: 0.13 },
];

/**
 * A contact shadow with a penumbra, cast on the ground plane.
 *
 * Three rings rather than one flat shape: a real contact shadow is dark and
 * tight where the object meets the ground and fades from there, and the eye
 * reads that gradient as *sitting on* rather than *drawn over*.
 *
 * `halfW` and `halfH` are the half-diagonals of the isometric rhombus it casts
 * onto, so a shadow always lies in the ground plane rather than facing the
 * camera.
 */
export function contactShadow(
  graphics: Phaser.GameObjects.Graphics,
  centre: Point,
  halfW: number,
  halfH: number,
): void {
  const offsetX = halfW * SUN_OFFSET;
  const offsetY = halfH * SUN_OFFSET;
  for (const ring of SHADOW_RINGS) {
    graphics.fillStyle(0x000000, ring.alpha);
    const w = halfW * ring.spread;
    const h = halfH * ring.spread;
    polygon(graphics, [
      { x: centre.x + offsetX, y: centre.y + offsetY - h },
      { x: centre.x + offsetX + w, y: centre.y + offsetY },
      { x: centre.x + offsetX, y: centre.y + offsetY + h },
      { x: centre.x + offsetX - w, y: centre.y + offsetY },
    ]);
  }
}

/**
 * Darkens a strip along one edge of a surface, the way a corner collects gloom.
 *
 * `from` and `to` are the edge; `depth` is how far the gloom reaches down the
 * surface. Two bands of decreasing strength approximate the falloff well
 * enough at this size.
 *
 * Keep it light. The first version of this stacked with the roof fascia below
 * it and turned a wall into a band of gloom with a stripe of stone showing.
 */
export function occlude(
  graphics: Phaser.GameObjects.Graphics,
  from: Point,
  to: Point,
  depth: number,
  strength = 0.22,
): void {
  for (const step of [1, 0.45]) {
    const reach = depth * step;
    graphics.fillStyle(0x000000, strength * (step === 1 ? 0.45 : 1));
    polygon(graphics, [from, to, { x: to.x, y: to.y + reach }, { x: from.x, y: from.y + reach }]);
  }
}

/** A lit edge along a seam, which is what a bevel looks like from here. */
export function bevel(
  graphics: Phaser.GameObjects.Graphics,
  from: Point,
  to: Point,
  colour: number,
  thickness = 1.5,
): void {
  graphics.fillStyle(colour, 0.85);
  polygon(graphics, [
    from,
    to,
    { x: to.x, y: to.y + thickness },
    { x: from.x, y: from.y + thickness },
  ]);
}

/** Fills a closed path through the given points. */
export function polygon(graphics: Phaser.GameObjects.Graphics, points: readonly Point[]): void {
  graphics.beginPath();
  const [first, ...rest] = points;
  if (!first) {
    return;
  }
  graphics.moveTo(first.x, first.y);
  for (const point of rest) {
    graphics.lineTo(point.x, point.y);
  }
  graphics.closePath();
  graphics.fillPath();
}

/** Multiplies a colour's brightness, clamped per channel. */
export function shade(colour: number, factor: number): number {
  const r = Math.min(255, Math.round(((colour >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((colour >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((colour & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}
