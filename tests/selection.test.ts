/**
 * What a tap selects, and what the game is allowed to say about it.
 *
 * All three of these were reported from play rather than found in code, and they
 * are the same complaint from three angles: the game answered about the *cell*
 * when the player had asked about the *thing standing on it*. Tapping the corner
 * of a quarry marked the corner; the tile panel underneath went on describing
 * the grass beneath the floorboards and offering to lay a road across it.
 *
 * Tested through the pure helpers rather than through Phaser or the DOM, which
 * is the whole reason they are pure helpers.
 */

import { describe, expect, it } from 'vitest';

import type { Selection } from '@/game/Game';
import { hidesGroundPanel, selectedCells } from '@/game/selection';

describe('what a tap covers', () => {
  it('marks one cell of bare ground', () => {
    expect(selectedCells(ground({ gx: 4, gy: 9 }))).toEqual([{ gx: 4, gy: 9 }]);
  });

  it('marks every cell of a building, whichever one was tapped', () => {
    // The report: tapping any square of a building's base should mark the
    // building. A 3x3 quarry tapped at its far corner is still the quarry.
    const corner = building({ gx: 10, gy: 10 }, 3, 3, { gx: 12, gy: 12 });
    const cells = selectedCells(corner);

    expect(cells).toHaveLength(9);
    expect(cells).toContainEqual({ gx: 10, gy: 10 });
    expect(cells).toContainEqual({ gx: 12, gy: 12 });
    expect(cells).toContainEqual({ gx: 11, gy: 11 });
  });

  it('covers a footprint that is not square', () => {
    // Scaling one diamond marker would have been enough for 2x2 and 3x3 and
    // silently wrong here, which is why the markers are per-cell.
    const cells = selectedCells(building({ gx: 2, gy: 5 }, 3, 1, { gx: 3, gy: 5 }));

    expect(cells).toEqual([
      { gx: 2, gy: 5 },
      { gx: 3, gy: 5 },
      { gx: 4, gy: 5 },
    ]);
  });

  it('marks only the villager when somebody is standing on a building', () => {
    // Tapping a person is almost always what was meant, and outlining the
    // workshop behind them would answer a question nobody asked.
    const selection: Selection = {
      ...building({ gx: 10, gy: 10 }, 3, 3, { gx: 11, gy: 11 }),
      villager: { id: 1, name: 'Ilde', age: 30, activity: 'walking', employer: null },
    };

    expect(selectedCells(selection)).toEqual([{ gx: 11, gy: 11 }]);
  });
});

describe('what the tile panel is allowed to say', () => {
  it('says nothing at all under a selected building', () => {
    expect(hidesGroundPanel(building({ gx: 1, gy: 1 }, 2, 2, { gx: 2, gy: 2 }))).toBe(true);
  });

  it('still describes bare ground', () => {
    expect(hidesGroundPanel(ground({ gx: 7, gy: 7 }))).toBe(false);
  });

  it('still describes a villager standing on a building', () => {
    const selection: Selection = {
      ...building({ gx: 1, gy: 1 }, 2, 2, { gx: 1, gy: 1 }),
      villager: { id: 2, name: 'Bede', age: 41, activity: 'idle', employer: null },
    };

    expect(hidesGroundPanel(selection)).toBe(false);
  });
});

function ground(cell: { gx: number; gy: number }): Selection {
  return {
    cell,
    terrain: 'grass',
    walkable: true,
    buildable: true,
    villager: null,
    treeId: null,
    isStoneDeposit: false,
    designated: false,
    building: null,
    hasRoad: false,
    roadDesignated: false,
    canPave: true,
  };
}

function building(
  origin: { gx: number; gy: number },
  width: number,
  height: number,
  tapped: { gx: number; gy: number },
): Selection {
  return {
    ...ground(tapped),
    building: {
      id: 3,
      buildingId: 'quarry',
      origin,
      footprint: { width, height },
      complete: true,
      progress: 1,
      missingMaterials: [],
      workers: 2,
      workerSlots: 3,
      desiredWorkers: 3,
      contents: [],
      housing: 0,
      residents: 0,
      demolitionOrdered: false,
    },
  };
}
