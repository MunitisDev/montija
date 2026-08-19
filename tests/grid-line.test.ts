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

import { cellLine } from '@/shared/math/gridLine';
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

function distance(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy);
}
