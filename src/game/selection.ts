/**
 * Which cells a selection covers.
 *
 * Pure, and separate from the scene that draws the markers, because "what did I
 * just select?" is a question about game state rather than about Phaser — and
 * because it is the kind of small geometry that is worth a test rather than an
 * eyeball.
 *
 * The rule is one sentence: **a building answers for every cell it stands on.**
 * Tapping the corner of a three-by-three quarry selects the quarry, and the
 * outline should agree with that rather than marking the corner and leaving the
 * player to guess what they hit.
 */

import type { GridPoint } from '@/shared/types/geometry';
import type { Selection } from './Game';

/**
 * The cells a selection should be drawn over, nearest-first order irrelevant.
 *
 * A villager wins over the ground they stand on — including a building's ground,
 * since tapping a person is almost always what was meant — so a selected
 * villager marks the single cell they are standing on rather than the workshop
 * behind them.
 */
export function selectedCells(selection: Selection): readonly GridPoint[] {
  const building = selection.building;
  if (!building || selection.villager) {
    return [selection.cell];
  }

  const cells: GridPoint[] = [];
  for (let dy = 0; dy < building.footprint.height; dy += 1) {
    for (let dx = 0; dx < building.footprint.width; dx += 1) {
      cells.push({ gx: building.origin.gx + dx, gy: building.origin.gy + dy });
    }
  }
  return cells;
}

/**
 * `true` when the tile panel should stay shut.
 *
 * A selected building says everything through its own panel, and the tile panel
 * beneath it was still reporting the ground under the floorboards: "grass",
 * cell coordinates, and a *Lay road* button for a cell with a warehouse on it.
 * None of that is answerable, so none of it is offered.
 */
export function hidesGroundPanel(selection: Selection): boolean {
  return selection.building !== null && selection.villager === null;
}
