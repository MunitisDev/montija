/**
 * The cells a straight line crosses, for drawing a run of something.
 *
 * **Asked for so that a road could be drawn in one gesture.** Paving used to be
 * one cell per tap: choose a cell, press Road, choose the next cell, press Road.
 * A track from the stores to the quarry is fifteen of those, which is not an
 * interaction, it is data entry.
 *
 * Two properties matter and neither is obvious.
 *
 * **The run is orthogonally continuous.** A plain Bresenham line takes diagonal
 * steps, and two cells joined only at a corner are not a road: the pathfinder
 * refuses to cut a corner between them (see `NavigationGrid`), so half the
 * player's paving would have bought nothing. Every diagonal step therefore gets
 * the corner cell between its two ends, which is why a diagonal run is longer
 * than the distance suggests. It is the honest cost of a diagonal road.
 *
 * **It is pure grid geometry.** Nothing here knows what is being laid, whether
 * the ground allows it, or that a renderer exists — which is what lets the same
 * function serve the preview, the order and the test.
 */

import type { GridPoint } from '@/shared/types/geometry';

/**
 * How many cells one line may contain before it stops.
 *
 * A guard rather than a rule: the map is a few hundred cells across, so a line
 * that reaches this has come from a bad argument rather than a long road, and
 * looping for ever would take the frame with it.
 */
const MAX_CELLS = 4096;

/**
 * Every cell from `from` to `to`, in order, both ends included.
 *
 * Consecutive cells always differ by one step in exactly one axis, so the result
 * reads as a walkable staircase rather than a chain of corners. `[from]` alone
 * when the two ends are the same cell — which is the whole of "tap the cell you
 * started on and only that cell is paved".
 */
export function cellLine(from: GridPoint, to: GridPoint): readonly GridPoint[] {
  const cells: GridPoint[] = [{ gx: from.gx, gy: from.gy }];

  let gx = from.gx;
  let gy = from.gy;
  const dx = Math.abs(to.gx - gx);
  const dy = Math.abs(to.gy - gy);
  const stepX = Math.sign(to.gx - gx);
  const stepY = Math.sign(to.gy - gy);
  let error = dx - dy;

  while ((gx !== to.gx || gy !== to.gy) && cells.length < MAX_CELLS) {
    const doubled = error * 2;
    const goesX = doubled > -dy && gx !== to.gx;
    const goesY = doubled < dx && gy !== to.gy;

    if (goesX) {
      error -= dy;
      gx += stepX;
    }
    if (goesY) {
      error += dx;
      gy += stepY;
    }

    // A diagonal step: put the corner in. Across first, then down — an
    // arbitrary choice, but a consistent one, so the same two ends always give
    // the same road rather than one that flips as the player re-aims.
    if (goesX && goesY) {
      cells.push({ gx, gy: gy - stepY });
    }
    cells.push({ gx, gy });
  }

  return cells;
}
