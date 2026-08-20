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

import { Game, type Selection } from '@/game/Game';
import { hidesGroundPanel, isAlreadySelected, selectedCells } from '@/game/selection';
import type { GridPoint } from '@/shared/types/geometry';

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
    treeStage: null,
    isStoneDeposit: false,
    designated: false,
    building: null,
    hasRoad: false,
    roadDesignated: false,
    canPave: true,
    hasDitch: false,
    ditchDesignated: false,
    canDig: false,
    canBridge: false,
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
      atLimit: null,
      upgrade: null,
      upgrading: false,
      improved: false,
    },
  };
}

describe('tapping the same thing twice', () => {
  it('closes a tile that is already open', () => {
    // The only gesture a player has for "never mind" was tapping somewhere
    // else, which selects something else. Toggling is the missing half.
    const current = tile({ gx: 4, gy: 7 });
    expect(isAlreadySelected(current, { gx: 4, gy: 7 }, null)).toBe(true);
  });

  it('leaves a different tile alone', () => {
    expect(isAlreadySelected(tile({ gx: 4, gy: 7 }), { gx: 4, gy: 8 }, null)).toBe(false);
  });

  it('closes a building tapped anywhere on its footprint', () => {
    // The far corner of a quarry is the same quarry. The toggle has to agree
    // with the outline, which already treats every cell as the building.
    const current = onBuilding({ gx: 10, gy: 10 }, 3);
    expect(isAlreadySelected(current, { gx: 12, gy: 12 }, 3)).toBe(true);
  });

  it('leaves a different building alone', () => {
    expect(isAlreadySelected(onBuilding({ gx: 10, gy: 10 }, 3), { gx: 20, gy: 20 }, 9)).toBe(false);
  });

  it('does not confuse a building with the ground beside it', () => {
    expect(isAlreadySelected(onBuilding({ gx: 10, gy: 10 }, 3), { gx: 10, gy: 10 }, null)).toBe(
      false,
    );
    expect(isAlreadySelected(tile({ gx: 10, gy: 10 }), { gx: 10, gy: 10 }, 3)).toBe(false);
  });

  it('has nothing to close when nothing is selected', () => {
    expect(isAlreadySelected(null, { gx: 1, gy: 1 }, null)).toBe(false);
  });
});

function tile(cell: GridPoint): Selection {
  return base(cell, null);
}

function onBuilding(cell: GridPoint, id: number): Selection {
  return base(cell, {
    id,
    buildingId: 'quarry',
    origin: cell,
    footprint: { width: 3, height: 3 },
    complete: true,
    progress: 1,
    missingMaterials: [],
    workers: 0,
    workerSlots: 3,
    desiredWorkers: 3,
    contents: [],
    housing: 0,
    residents: 0,
    demolitionOrdered: false,
    upgrade: null,
    atLimit: null,
    upgrading: false,
    improved: false,
  });
}

function base(cell: GridPoint, building: Selection['building']): Selection {
  return {
    cell,
    terrain: 'grass',
    walkable: true,
    buildable: true,
    villager: null,
    treeId: null,
    treeStage: null,
    isStoneDeposit: false,
    designated: false,
    building,
    hasRoad: false,
    roadDesignated: false,
    canPave: true,
    hasDitch: false,
    ditchDesignated: false,
    canDig: false,
    canBridge: false,
  };
}

describe('a tap while placing a building', () => {
  it('cancels the placement instead of selecting anything', () => {
    // The ghost is framed with the camera, so a tap has no other job during
    // placement — and tapping the map is what a player reaches for before they
    // find the Cancel button. A drag is not a tap and still pans.
    const game = new Game({ seed: 20260816 });
    game.onSelect({ sx: 100, sy: 100 });
    const chosen = game.selection;
    expect(chosen).not.toBeNull();

    game.beginPlacement('house');
    expect(game.placement).not.toBeNull();
    game.onSelect({ sx: 300, sy: 200 });

    expect(game.placement).toBeNull();
    // And it selected nothing new: the tap was spent on the ghost. Whatever was
    // already open stays open, because cancelling a build is not a reason to
    // close an unrelated panel.
    expect(game.selection).toBe(chosen);
  });

  it('selects normally once there is no ghost', () => {
    const game = new Game({ seed: 20260816 });
    game.beginPlacement('house');
    game.onSelect({ sx: 100, sy: 100 });
    game.onSelect({ sx: 100, sy: 100 });

    expect(game.selection).not.toBeNull();
  });
});
