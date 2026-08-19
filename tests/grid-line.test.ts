/**
 * The cells a run of road covers.
 *
 * Paving was one cell per tap, which for a track from the stores to the quarry
 * is fifteen taps and two menus. The line is what makes it one gesture — and
 * the property that matters is not that it looks straight but that it is
 * **walkable**: the pathfinder refuses to cut a corner, so a run joined only at
 * corners would be paving the player got nothing for.
 */

import { describe, expect, it } from 'vitest';

import { cellLine, cellRoute } from '@/shared/math/gridLine';
import type { GridPoint } from '@/shared/types/geometry';

describe('a line of cells', () => {
  it('is the single cell when both ends are the same', () => {
    // Literally the asked-for behaviour: tap the cell you started on and only
    // that cell is paved.
    expect(cellLine({ gx: 5, gy: 7 }, { gx: 5, gy: 7 })).toEqual([{ gx: 5, gy: 7 }]);
  });

  it('runs straight along a row, both ends included', () => {
    expect(cellLine({ gx: 2, gy: 4 }, { gx: 5, gy: 4 })).toEqual([
      { gx: 2, gy: 4 },
      { gx: 3, gy: 4 },
      { gx: 4, gy: 4 },
      { gx: 5, gy: 4 },
    ]);
  });

  it('runs straight along a column, in either direction', () => {
    expect(cellLine({ gx: 3, gy: 9 }, { gx: 3, gy: 6 })).toEqual([
      { gx: 3, gy: 9 },
      { gx: 3, gy: 8 },
      { gx: 3, gy: 7 },
      { gx: 3, gy: 6 },
    ]);
  });

  it('never takes a diagonal step, however diagonal the line', () => {
    // The property the road depends on. Two cells joined at a corner are not a
    // road: `NavigationGrid` will not step between them, so half of a diagonal
    // run would have been paving that bought nothing.
    for (const end of [
      { gx: 14, gy: 20 },
      { gx: 3, gy: 19 },
      { gx: 21, gy: 4 },
      { gx: 0, gy: 0 },
    ]) {
      const cells = cellLine({ gx: 10, gy: 10 }, end);
      for (let index = 1; index < cells.length; index += 1) {
        const step = distance(cells[index - 1]!, cells[index]!);
        expect(
          step,
          `${JSON.stringify(cells[index])} after ${JSON.stringify(cells[index - 1])}`,
        ).toBe(1);
      }
    }
  });

  it('arrives where it was aimed and starts where it was begun', () => {
    const from = { gx: 8, gy: 31 };
    const to = { gx: 19, gy: 12 };
    const cells = cellLine(from, to);
    expect(cells[0]).toEqual(from);
    expect(cells[cells.length - 1]).toEqual(to);
  });

  it('visits no cell twice', () => {
    const cells = cellLine({ gx: 0, gy: 0 }, { gx: 17, gy: 11 });
    const seen = new Set(cells.map((cell) => `${cell.gx},${cell.gy}`));
    expect(seen.size).toBe(cells.length);
  });

  it('costs the corners a diagonal needs, and says so in its length', () => {
    // A diagonal run is longer than the distance suggests, because each diagonal
    // step is two cells. That is the honest cost of a diagonal road, not a bug.
    const cells = cellLine({ gx: 0, gy: 0 }, { gx: 4, gy: 4 });
    expect(cells).toHaveLength(9);
  });

  it('is the same line whichever way it is re-aimed', () => {
    // The preview redraws on every tap. A line that flipped its corners between
    // two identical aims would look like a bug in the preview.
    const once = cellLine({ gx: 4, gy: 4 }, { gx: 11, gy: 8 });
    const again = cellLine({ gx: 4, gy: 4 }, { gx: 11, gy: 8 });
    expect(again).toEqual(once);
  });
});

/**
 * A run that bends round what is in the way.
 *
 * **Asked for after the straight line proved useless where it matters.** Roads
 * are worth laying in a dense settlement, and in a dense settlement the cells
 * between two points have houses on them.
 */
describe('a route round obstacles', () => {
  it('is the straight run when nothing is in the way', () => {
    const route = cellRoute({ gx: 2, gy: 5 }, { gx: 7, gy: 5 }, () => true)!;
    expect(route).toEqual(cellLine({ gx: 2, gy: 5 }, { gx: 7, gy: 5 }));
  });

  it('goes round a wall instead of stopping at it', () => {
    // A wall across the direct line with one way past it. The straight line would
    // have put four of its seven cells inside a building.
    const wall = (cell: GridPoint): boolean => !(cell.gx === 5 && cell.gy <= 8);
    const route = cellRoute({ gx: 2, gy: 5 }, { gx: 8, gy: 5 }, wall)!;

    expect(route[0]).toEqual({ gx: 2, gy: 5 });
    expect(route[route.length - 1]).toEqual({ gx: 8, gy: 5 });
    for (const cell of route) {
      expect(wall(cell), `${cell.gx},${cell.gy} is in the wall`).toBe(true);
    }
    // It had to go round, so it is longer than the straight run would have been.
    expect(route.length).toBeGreaterThan(7);
  });

  it('never takes a diagonal step, so the road it lays is walkable', () => {
    const blocked = new Set(['4,4', '4,5', '4,6', '5,6', '6,6']);
    const route = cellRoute(
      { gx: 2, gy: 5 },
      { gx: 8, gy: 7 },
      (cell) => !blocked.has(`${cell.gx},${cell.gy}`),
    )!;
    for (let index = 1; index < route.length; index += 1) {
      expect(distance(route[index - 1]!, route[index]!)).toBe(1);
    }
  });

  it('prefers the run with fewest bends among equally long ones', () => {
    // Thousands of staircases between two corners are the same length. Without a
    // turn penalty the search returns any of them and the preview wobbles as the
    // player re-aims; with one it returns the shape a person would lay.
    const route = cellRoute({ gx: 0, gy: 0 }, { gx: 6, gy: 4 }, () => true)!;
    let bends = 0;
    for (let index = 2; index < route.length; index += 1) {
      const before = route[index - 1]!;
      const first = route[index - 2]!;
      const next = route[index]!;
      if (next.gx - before.gx !== before.gx - first.gx) {
        bends += 1;
      }
    }
    expect(bends).toBe(1);
  });

  it('refuses when there is no way through at all', () => {
    // `null` rather than a best effort: the caller shows the straight line so the
    // player can see what is in the way on the map.
    const walled = (cell: GridPoint): boolean => cell.gx !== 5;
    expect(cellRoute({ gx: 2, gy: 5 }, { gx: 8, gy: 5 }, walled)).toBeNull();
  });

  it('refuses when either end is ground no road can take', () => {
    const notThere = (cell: GridPoint): boolean => !(cell.gx === 8 && cell.gy === 5);
    expect(cellRoute({ gx: 2, gy: 5 }, { gx: 8, gy: 5 }, notThere)).toBeNull();
    expect(cellRoute({ gx: 8, gy: 5 }, { gx: 2, gy: 5 }, notThere)).toBeNull();
  });

  it('will not wander far outside the two ends to find a way round', () => {
    // A road that leaves the box between its ends and comes back from the far
    // side of a lake is not the road the player drew. Beyond the margin it gives
    // up and the straight line is shown instead.
    const gap = (cell: GridPoint): boolean => cell.gx !== 5 || cell.gy === 40;
    expect(cellRoute({ gx: 2, gy: 5 }, { gx: 8, gy: 5 }, gap)).toBeNull();
  });

  it('is the same route every time it is asked', () => {
    const blocked = new Set(['4,4', '4,5', '4,6', '5,6']);
    const takes = (cell: GridPoint): boolean => !blocked.has(`${cell.gx},${cell.gy}`);
    const once = cellRoute({ gx: 1, gy: 5 }, { gx: 9, gy: 8 }, takes);
    expect(cellRoute({ gx: 1, gy: 5 }, { gx: 9, gy: 8 }, takes)).toEqual(once);
  });

  it('is a single cell when both ends are the same', () => {
    expect(cellRoute({ gx: 3, gy: 3 }, { gx: 3, gy: 3 }, () => true)).toEqual([{ gx: 3, gy: 3 }]);
  });
});

function distance(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy);
}
