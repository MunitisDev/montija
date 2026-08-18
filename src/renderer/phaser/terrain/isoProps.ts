/**
 * The small things that stand on the ground: crates, barrels, logs, sacks.
 *
 * Shared between the storage yard, which piles them on its deck, and the
 * identifying features every other building keeps on its plot. Flat-shaded like
 * everything else in the settlement — a facet takes one tone from how far it
 * turns away from the light, and the eye assembles the curve.
 *
 * Renderer-only: these run once at startup to fill a texture, never per frame.
 */

import type Phaser from 'phaser';

import { bevel, polygon, shade, type Point } from './shading';

/** Sawn boards, still pale. */
export const CRATE = 0x8a6b45;
/** Coopered oak, darker than a crate and hooped in iron. */
export const BARREL = 0x6b5334;
export const BARREL_HOOP = 0x4e4a44;
/** Undyed sackcloth. */
export const SACK = 0x9c8f6f;
/** Bark, and the pale cut face of a log seen end-on. */
export const LOG_BARK = 0x5a4a34;
export const LOG_END = 0xa08a63;

/** A flat-shaded isometric box: three faces, boarded, lit from the upper left. */
export function isoCrate(
  graphics: Phaser.GameObjects.Graphics,
  base: Point,
  width: number,
  height: number,
  colour: number,
): void {
  const hw = width / 2;
  const hh = width / 4;
  const topY = base.y - height;

  graphics.fillStyle(shade(colour, 1.16), 1);
  polygon(graphics, [
    { x: base.x, y: topY - hh },
    { x: base.x + hw, y: topY },
    { x: base.x, y: topY + hh },
    { x: base.x - hw, y: topY },
  ]);

  graphics.fillStyle(colour, 1);
  polygon(graphics, [
    { x: base.x - hw, y: topY },
    { x: base.x, y: topY + hh },
    { x: base.x, y: base.y + hh },
    { x: base.x - hw, y: base.y },
  ]);

  graphics.fillStyle(shade(colour, 0.72), 1);
  polygon(graphics, [
    { x: base.x, y: topY + hh },
    { x: base.x + hw, y: topY },
    { x: base.x + hw, y: base.y },
    { x: base.x, y: base.y + hh },
  ]);

  // Two boards per face. A crate with no seams is a die.
  for (const depth of [height * 0.36, height * 0.7]) {
    graphics.fillStyle(shade(colour, 0.6), 1);
    polygon(graphics, [
      { x: base.x - hw, y: topY + depth },
      { x: base.x, y: topY + hh + depth },
      { x: base.x, y: topY + hh + depth + 1.1 },
      { x: base.x - hw, y: topY + depth + 1.1 },
    ]);
    graphics.fillStyle(shade(colour, 0.5), 1);
    polygon(graphics, [
      { x: base.x, y: topY + hh + depth },
      { x: base.x + hw, y: topY + depth },
      { x: base.x + hw, y: topY + depth + 1.1 },
      { x: base.x, y: topY + hh + depth + 1.1 },
    ]);
  }

  // The lit arris along the near-left top edge, and gloom in the inside corner.
  bevel(
    graphics,
    { x: base.x - hw, y: topY },
    { x: base.x, y: topY + hh },
    shade(colour, 1.34),
    1.1,
  );
}

/**
 * A barrel, as a ten-sided prism.
 *
 * Facets rather than an ellipse with a gradient, because the settlement is
 * flat-shaded throughout: each facet takes one tone from how far it turns away
 * from the light, and the eye assembles the curve. Drawn back to front, so the
 * far facets are simply covered rather than needing to be culled.
 */
export function isoBarrel(
  graphics: Phaser.GameObjects.Graphics,
  base: Point,
  width: number,
  height: number,
): void {
  const facets = 10;
  const hw = width / 2;
  const hh = width / 4;
  const topY = base.y - height;

  const rim = (index: number, y: number): Point => {
    const angle = (Math.PI * 2 * index) / facets;
    return { x: base.x + Math.cos(angle) * hw, y: y + Math.sin(angle) * hh };
  };

  // Back to front: a facet's screen depth is the sine of its angle.
  const order = Array.from({ length: facets }, (_, index) => index).sort(
    (a, b) =>
      Math.sin((Math.PI * 2 * a) / facets) +
      Math.sin((Math.PI * 2 * (a + 1)) / facets) -
      (Math.sin((Math.PI * 2 * b) / facets) + Math.sin((Math.PI * 2 * (b + 1)) / facets)),
  );

  for (const index of order) {
    const mid = (Math.PI * 2 * (index + 0.5)) / facets;
    // Facing the light is facing up and to the left, which in this projection is
    // negative in both screen axes.
    const towards = (-Math.cos(mid) - Math.sin(mid)) / Math.SQRT2;
    graphics.fillStyle(shade(BARREL, 0.66 + 0.5 * Math.max(0, towards)), 1);
    polygon(graphics, [
      rim(index, topY),
      rim(index + 1, topY),
      rim(index + 1, base.y),
      rim(index, base.y),
    ]);
    // Two iron hoops, following the same facets so they wrap rather than float.
    for (const band of [height * 0.24, height * 0.7]) {
      graphics.fillStyle(shade(BARREL_HOOP, 0.85 + 0.4 * Math.max(0, towards)), 1);
      polygon(graphics, [
        { x: rim(index, topY).x, y: rim(index, topY).y + band },
        { x: rim(index + 1, topY).x, y: rim(index + 1, topY).y + band },
        { x: rim(index + 1, topY).x, y: rim(index + 1, topY).y + band + 1.6 },
        { x: rim(index, topY).x, y: rim(index, topY).y + band + 1.6 },
      ]);
    }
  }

  // The lid, and a board across it.
  graphics.fillStyle(shade(BARREL, 1.24), 1);
  polygon(
    graphics,
    Array.from({ length: facets }, (_, index) => rim(index, topY)),
  );
  graphics.fillStyle(shade(BARREL, 1.05), 1);
  polygon(graphics, [
    { x: base.x - hw * 0.86, y: topY - hh * 0.1 },
    { x: base.x + hw * 0.86, y: topY - hh * 0.1 },
    { x: base.x + hw * 0.86, y: topY + hh * 0.1 },
    { x: base.x - hw * 0.86, y: topY + hh * 0.1 },
  ]);
}

/**
 * Cut timber stacked on the deck: three logs and two on top of them.
 *
 * Lying down rather than stood on end, because that is how a settlement stacks
 * timber and because a lying log gives the eye a cylinder to read — a
 * parallelogram of bark with a pale sawn round at the near end.
 */
export function isoLogStack(
  graphics: Phaser.GameObjects.Graphics,
  base: Point,
  width: number,
): void {
  const span = width * 0.9;
  const rise = span / 2;
  const bore = Math.max(4, width * 0.26);

  const log = (offsetX: number, offsetY: number): void => {
    const nearX = base.x + offsetX;
    const nearY = base.y + offsetY;
    const farX = nearX - span;
    const farY = nearY - rise;

    graphics.fillStyle(LOG_BARK, 1);
    polygon(graphics, [
      { x: farX, y: farY - bore },
      { x: nearX, y: nearY - bore },
      { x: nearX, y: nearY },
      { x: farX, y: farY },
    ]);
    // A lit strip along the top of the barrel of the log.
    graphics.fillStyle(shade(LOG_BARK, 1.3), 1);
    polygon(graphics, [
      { x: farX, y: farY - bore },
      { x: nearX, y: nearY - bore },
      { x: nearX, y: nearY - bore + 1.4 },
      { x: farX, y: farY - bore + 1.4 },
    ]);
    // The sawn end, pale against the bark: the whole reason a woodpile reads.
    graphics.fillStyle(LOG_END, 1);
    polygon(graphics, [
      { x: nearX, y: nearY - bore * 0.96 },
      { x: nearX + bore * 0.34, y: nearY - bore * 0.74 },
      { x: nearX + bore * 0.34, y: nearY - bore * 0.24 },
      { x: nearX, y: nearY - bore * 0.04 },
      { x: nearX - bore * 0.34, y: nearY - bore * 0.24 },
      { x: nearX - bore * 0.34, y: nearY - bore * 0.74 },
    ]);
    // Heartwood, a shade darker than the sapwood round it.
    graphics.fillStyle(shade(LOG_END, 0.82), 1);
    graphics.fillRect(nearX - bore * 0.12, nearY - bore * 0.62, bore * 0.24, bore * 0.26);
  };

  // Two courses of two, cross-stacked. Five rounds at this size turned into a
  // spray of pale dots rather than a woodpile.
  for (let i = 0; i < 2; i += 1) {
    log(i * bore * 1.05, -i * bore * 0.52);
  }
  log(bore * 0.52, -bore * 1.2);
}

/** A sack: a prism that narrows towards a tied throat. */
export function isoSack(
  graphics: Phaser.GameObjects.Graphics,
  base: Point,
  width: number,
  height: number,
): void {
  const hw = width / 2;
  const hh = width / 4;
  const topY = base.y - height;
  const neck = hw * 0.42;

  graphics.fillStyle(SACK, 1);
  polygon(graphics, [
    { x: base.x - neck, y: topY },
    { x: base.x, y: topY + neck / 2 },
    { x: base.x, y: base.y + hh },
    { x: base.x - hw, y: base.y },
  ]);
  graphics.fillStyle(shade(SACK, 0.76), 1);
  polygon(graphics, [
    { x: base.x, y: topY + neck / 2 },
    { x: base.x + neck, y: topY },
    { x: base.x + hw, y: base.y },
    { x: base.x, y: base.y + hh },
  ]);
  // The tied throat, and a lit crease down the near edge.
  graphics.fillStyle(shade(SACK, 1.06), 1);
  polygon(graphics, [
    { x: base.x, y: topY - neck / 2 },
    { x: base.x + neck, y: topY },
    { x: base.x, y: topY + neck / 2 },
    { x: base.x - neck, y: topY },
  ]);
  graphics.fillStyle(shade(SACK, 0.6), 1);
  graphics.fillRect(base.x - neck * 0.6, topY + neck * 0.5, neck * 1.2, 1.4);
}
