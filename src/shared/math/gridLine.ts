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

/**
 * How far outside the two ends a route may wander, in cells.
 *
 * A road that bends round a house is what the player asked for. A road that
 * leaves the box between its two ends and comes back from the far side of a lake
 * is not a road they drew — it is the game inventing a different plan and
 * charging them for it. Twelve cells is room to get round any building in the
 * game, a rock outcrop or a spur of the river, and not room to go somewhere else.
 */
const DETOUR_MARGIN = 12;

/**
 * What one turn costs, against a straight step's 1.
 *
 * Both routes are the same length in cells, so without this the search is free to
 * return any of the thousands of equally-long staircases between two corners and
 * the preview wobbles as the player re-aims. A small penalty makes it prefer the
 * one with the fewest bends, which is both prettier and what a person laying a
 * track would do — and it is small enough that it never buys a longer road.
 */
const TURN_COST = 0.25;

/** The four orthogonal steps, in a fixed order so a route is reproducible. */
const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/**
 * The shortest orthogonal run from `from` to `to` that keeps to ground the caller
 * accepts, or `null` when there is no such run.
 *
 * **Asked for: a drawn road should bend round a building rather than through
 * it.** The straight line is honest but useless where the settlement is dense —
 * exactly where roads are worth laying — because the cells it wants are the ones
 * with houses on them.
 *
 * `takes` decides what the run may cross, so nothing here knows what a building
 * or a rock face is: the caller asks about pavability and gets a route over
 * pavable ground. Both ends must be acceptable; a run to a cell no road can
 * reach is not a shorter run, it is a different question, and the caller should
 * fall back to {@link cellLine} so the player can see the refusal on the map.
 *
 * Bounded by {@link DETOUR_MARGIN} around the two ends, and biased towards fewer
 * bends by {@link TURN_COST}. Deterministic: the same two ends over the same
 * ground give the same road, which matters because the preview is redrawn on
 * every tap.
 */
export function cellRoute(
  from: GridPoint,
  to: GridPoint,
  takes: (cell: GridPoint) => boolean,
): readonly GridPoint[] | null {
  if (!takes(from) || !takes(to)) {
    return null;
  }
  if (from.gx === to.gx && from.gy === to.gy) {
    return [{ gx: from.gx, gy: from.gy }];
  }

  const minX = Math.min(from.gx, to.gx) - DETOUR_MARGIN;
  const maxX = Math.max(from.gx, to.gx) + DETOUR_MARGIN;
  const minY = Math.min(from.gy, to.gy) - DETOUR_MARGIN;
  const maxY = Math.max(from.gy, to.gy) + DETOUR_MARGIN;
  const width = maxX - minX + 1;

  /** A cell reached from a direction, which is the state a turn penalty needs. */
  interface Step {
    readonly gx: number;
    readonly gy: number;
    /** Index into {@link STEPS} of the move that arrived here; `-1` at the start. */
    readonly facing: number;
    readonly cost: number;
    readonly estimate: number;
    readonly cameFrom: Step | null;
  }

  const best = new Map<number, number>();
  const stateKey = (gx: number, gy: number, facing: number): number =>
    ((gy - minY) * width + (gx - minX)) * 5 + facing + 1;

  const distance = (gx: number, gy: number): number => Math.abs(gx - to.gx) + Math.abs(gy - to.gy);

  const open: Step[] = [
    {
      gx: from.gx,
      gy: from.gy,
      facing: -1,
      cost: 0,
      estimate: distance(from.gx, from.gy),
      cameFrom: null,
    },
  ];

  while (open.length > 0) {
    // A linear scan rather than a heap: the frontier of a bounded, mostly-open
    // grid is small, and this runs once when the player re-aims rather than once
    // a frame. A heap here would be code nobody could check for a cost nobody
    // could measure.
    let pick = 0;
    for (let index = 1; index < open.length; index += 1) {
      const candidate = open[index]!;
      const leader = open[pick]!;
      if (
        candidate.estimate < leader.estimate ||
        (candidate.estimate === leader.estimate && candidate.cost < leader.cost)
      ) {
        pick = index;
      }
    }
    const step = open.splice(pick, 1)[0]!;

    if (step.gx === to.gx && step.gy === to.gy) {
      const route: GridPoint[] = [];
      for (let node: Step | null = step; node !== null; node = node.cameFrom) {
        route.push({ gx: node.gx, gy: node.gy });
      }
      return route.reverse();
    }

    for (const [index, [dx, dy]] of STEPS.entries()) {
      const gx = step.gx + dx;
      const gy = step.gy + dy;
      if (gx < minX || gx > maxX || gy < minY || gy > maxY) {
        continue;
      }
      if (!takes({ gx, gy })) {
        continue;
      }

      const cost = step.cost + 1 + (step.facing === -1 || step.facing === index ? 0 : TURN_COST);
      const key = stateKey(gx, gy, index);
      const known = best.get(key);
      if (known !== undefined && known <= cost) {
        continue;
      }
      best.set(key, cost);
      open.push({
        gx,
        gy,
        facing: index,
        cost,
        estimate: cost + distance(gx, gy),
        cameFrom: step,
      });
    }
  }

  return null;
}
