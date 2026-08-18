/**
 * Things that run from cell to cell: roads, bridges and ditches.
 *
 * **Why this exists.** A road was one flat tile, drawn the same whatever stood
 * beside it, so a road that turned a corner was two overlapping lozenges and a
 * crossroads was four. It read as a scatter of patches rather than as a line the
 * settlement had beaten, and the same would be true of a channel — worse, since
 * a channel that does not visibly join the river is not obviously carrying
 * water at all.
 *
 * The fix is the oldest trick in tile rendering: draw a *centre* and an *arm*
 * towards each neighbour that carries the same thing. Four neighbours give
 * sixteen shapes, and those sixteen cover every end, straight, corner,
 * T-junction and crossing without anybody having to draw them.
 *
 * **Everything here is measured in cells, not pixels.** An arm is a rectangle
 * half a cell long in the grid, and its corners are projected on the way out.
 * Laying bands out in screen pixels instead gives a road whose corners are the
 * wrong shape — the two grid axes are not the same length on screen, and a band
 * of constant screen thickness is not a band of constant width on the ground.
 */

import type Phaser from 'phaser';
import { TILE_HEIGHT, TILE_WIDTH } from '@/shared/math/isometric';

/**
 * Which neighbour each bit of a connector mask stands for.
 *
 * Grid directions, deliberately: `+x` is down-and-right on screen and `+y` is
 * down-and-left, and no caller should have to know that.
 */
export const CONNECTOR_DIRECTIONS = [
  { bit: 1, dx: 1, dy: 0 },
  { bit: 2, dx: 0, dy: 1 },
  { bit: 4, dx: -1, dy: 0 },
  { bit: 8, dx: 0, dy: -1 },
] as const;

/** How many distinct shapes a connector has. Four neighbours, so sixteen. */
export const CONNECTOR_MASKS = 16;

/** Builds a mask from a test of each of the four neighbours. */
export function connectorMask(
  gx: number,
  gy: number,
  joins: (gx: number, gy: number) => boolean,
): number {
  let mask = 0;
  for (const direction of CONNECTOR_DIRECTIONS) {
    if (joins(gx + direction.dx, gy + direction.dy)) {
      mask |= direction.bit;
    }
  }
  return mask;
}

/** A band of something, described in cells. */
interface Band {
  /** Half the band's width, in cells. */
  readonly half: number;
  readonly colour: number;
  readonly alpha: number;
}

const HALF_WIDTH = TILE_WIDTH / 2;
const HALF_HEIGHT = TILE_HEIGHT / 2;

/**
 * Projects a world offset from the cell centre into texture pixels.
 *
 * The same projection the rest of the game uses, applied to a tile-sized canvas:
 * that is what keeps a drawn road lying exactly along the cells it occupies.
 */
function project(ox: number, oy: number): [number, number] {
  return [HALF_WIDTH + (ox - oy) * HALF_WIDTH, HALF_HEIGHT + (ox + oy) * HALF_HEIGHT];
}

/** Fills a grid-aligned rectangle, given in cell offsets from the centre. */
function fillCellRect(
  graphics: Phaser.GameObjects.Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const corners = [project(x0, y0), project(x1, y0), project(x1, y1), project(x0, y1)];
  graphics.beginPath();
  graphics.moveTo(corners[0]![0], corners[0]![1]);
  for (const [x, y] of corners.slice(1)) {
    graphics.lineTo(x, y);
  }
  graphics.closePath();
  graphics.fillPath();
}

/**
 * Draws one band of a connector: a square at the centre and an arm per
 * neighbour.
 *
 * The centre is always drawn, so a lone cell is a patch rather than nothing —
 * a road ordered in the middle of a field should be visible the moment it is
 * beaten, and a one-cell ditch is a pond.
 *
 * Arms run a whisker past the cell edge (`REACH`), because two adjacent tiles
 * that each stop exactly at the boundary leave a hairline of ground between
 * them at some zooms, and a road with gaps in it reads as a dotted line.
 */
const REACH = 0.52;

export function drawConnectorBand(
  graphics: Phaser.GameObjects.Graphics,
  mask: number,
  band: Band,
): void {
  graphics.fillStyle(band.colour, band.alpha);
  fillCellRect(graphics, -band.half, -band.half, band.half, band.half);

  for (const direction of CONNECTOR_DIRECTIONS) {
    if ((mask & direction.bit) === 0) {
      continue;
    }
    if (direction.dx !== 0) {
      const far = direction.dx * REACH;
      fillCellRect(graphics, Math.min(0, far), -band.half, Math.max(0, far), band.half);
    } else {
      const far = direction.dy * REACH;
      fillCellRect(graphics, -band.half, Math.min(0, far), band.half, Math.max(0, far));
    }
  }
}

/**
 * A stretch of beaten track.
 *
 * Three passes: a damp margin, the trodden bed, and a worn crown down the
 * middle. Trodden earth rather than paving — a diamond filling the cell exactly
 * would read as a floor tile and make the grid, which the brief wants hidden,
 * the most obvious thing on screen.
 */
export function drawRoadConnector(graphics: Phaser.GameObjects.Graphics, mask: number): void {
  drawConnectorBand(graphics, mask, { half: 0.34, colour: 0x4a4034, alpha: 0.75 });
  drawConnectorBand(graphics, mask, { half: 0.26, colour: 0x6a5a45, alpha: 0.92 });
  drawConnectorBand(graphics, mask, { half: 0.13, colour: 0x7b6a51, alpha: 0.8 });
}

/**
 * A dug channel: two earth banks with water running between them.
 *
 * Drawn over a tile of wet mud rather than over water, which is what makes a
 * ditch read as something the settlement *made*. The channel is narrow on
 * purpose — a cell of ditch is a cell of ground with water through the middle of
 * it, not a cell of river.
 */
export function drawDitchConnector(graphics: Phaser.GameObjects.Graphics, mask: number): void {
  // Wet, dark earth thrown up either side of the cut.
  drawConnectorBand(graphics, mask, { half: 0.3, colour: 0x4b4134, alpha: 0.9 });
  drawConnectorBand(graphics, mask, { half: 0.2, colour: 0x3c4a4f, alpha: 0.95 });
  // The water itself, with a lit ripple down its middle.
  drawConnectorBand(graphics, mask, { half: 0.13, colour: 0x2f4650, alpha: 1 });
  drawConnectorBand(graphics, mask, { half: 0.05, colour: 0x4a6a75, alpha: 0.55 });
}

/**
 * A timber crossing.
 *
 * Boards along the way the traffic goes, with the beams under them showing at
 * the sides. Nothing rises above the deck: a parapet drawn on a 32px-tall tile
 * is three pixels of noise, and the deck's own value against the dark water is
 * what makes it read as a bridge.
 */
export function drawBridgeConnector(graphics: Phaser.GameObjects.Graphics, mask: number): void {
  // The beams: a shade darker, and a little wider than the deck.
  drawConnectorBand(graphics, mask, { half: 0.4, colour: 0x3a2f22, alpha: 0.95 });
  drawConnectorBand(graphics, mask, { half: 0.34, colour: 0x6b5a41, alpha: 1 });
  drawConnectorBand(graphics, mask, { half: 0.3, colour: 0x7d6a4c, alpha: 1 });

  // Cross-planks, so the deck reads as boards rather than as a painted strip.
  graphics.fillStyle(0x4a3d2c, 0.55);
  for (const direction of CONNECTOR_DIRECTIONS) {
    if ((mask & direction.bit) === 0) {
      continue;
    }
    for (const along of [0.18, 0.34, 0.5]) {
      if (direction.dx !== 0) {
        const at = direction.dx * along;
        fillCellRect(graphics, at - 0.02, -0.3, at + 0.02, 0.3);
      } else {
        const at = direction.dy * along;
        fillCellRect(graphics, -0.3, at - 0.02, 0.3, at + 0.02);
      }
    }
  }

  // A lone bridge — one cell, nothing joined to it yet — still needs boards.
  if (mask === 0) {
    graphics.fillStyle(0x4a3d2c, 0.55);
    for (const at of [-0.16, 0, 0.16]) {
      fillCellRect(graphics, at - 0.02, -0.3, at + 0.02, 0.3);
    }
  }
}
