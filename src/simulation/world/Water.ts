/**
 * Water within reach, which is comfort every day and the answer to a fire.
 *
 * **The river already decided where an orchard could go. This is what lets it
 * decide the rest of the settlement.** A household with water near it is not
 * carrying every bucket from the bank, and a settlement whose houses all stand
 * by water is a more contented one — collected, not owed: a village built up on
 * the dry side of the valley is not being punished, it simply has a comfort it
 * has not taken.
 *
 * The same reach answers the other question. When a hearth sets a roof alight,
 * water within {@link WATER_REACH} is the difference between a fire that is put
 * out and a building that is gone — see `events/FireSystem.ts`.
 *
 * A **Well** is how a settlement puts water where the river is not, which is the
 * whole reason it is a cheap building: it has to be affordable in the first year,
 * because the first year is when a settlement is most likely to have been founded
 * somewhere awkward.
 */

import { WET_TERRAIN } from '@/data/terrain';
import type { GridPoint } from '@/shared/types/geometry';
import type { World } from './World';

/**
 * How far water carries, in cells.
 *
 * Ten, which is the player's own figure and a good one: it is about half the
 * width of a comfortable settlement, so one well serves a neighbourhood rather
 * than a house, and a village that sprawls needs a second one. Measured as a
 * square rather than a circle, like every other reach in this game — the corners
 * are a rounding error next to the cost of pretending the grid is round.
 */
export const WATER_REACH = 10;

/**
 * `true` when there is water this cell can reach: the river, a dug channel, or a
 * standing well.
 *
 * The well's own radius is asked of its definition rather than assumed, so a
 * deeper well later is a row in a data file.
 */
export function waterWithinReach(world: World, cell: GridPoint): boolean {
  for (const building of world.buildings.all) {
    const water = building.definition.water;
    if (!water || !building.isComplete) {
      continue;
    }
    const at = building.accessCell;
    if (Math.abs(at.gx - cell.gx) <= water.radius && Math.abs(at.gy - cell.gy) <= water.radius) {
      return true;
    }
  }

  for (let dy = -WATER_REACH; dy <= WATER_REACH; dy += 1) {
    for (let dx = -WATER_REACH; dx <= WATER_REACH; dx += 1) {
      const gx = cell.gx + dx;
      const gy = cell.gy + dy;
      if (!world.terrain.contains(gx, gy)) {
        continue;
      }
      if (WET_TERRAIN.includes(world.terrain.get(gx, gy))) {
        return true;
      }
    }
  }

  return false;
}
