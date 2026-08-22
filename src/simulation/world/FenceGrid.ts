/**
 * The palisade: a line of driven stakes, and the settlement's only defence.
 *
 * **What it is for.** Wolves come down in the hungry season and take what is
 * easiest — food left lying in the open, or somebody working alone with the trees
 * at their back. A palisade is the answer, and it is deliberately the same *kind*
 * of answer the game already has for fire: not a wall around everything, but a
 * **screen** between what matters and where the danger comes from. A road breaks
 * a fire's line; a fence breaks a wolf's.
 *
 * So the rule is one sentence: **a pack will not cross a fence.** Anything with a
 * stake line between it and the wood the pack came out of is not worth attacking,
 * and the pack goes and finds something that has not been screened.
 *
 * **What it deliberately is not.** It does not block villagers. A real palisade
 * has a gate, and gates are where people go through; modelling every gate would
 * be a great deal of interface — placement, pathing, a door per opening — for a
 * rule the player already understands from every fenced field they have ever
 * seen. It also means the fence can never seal the settlement in, which is a
 * whole class of unrecoverable mistake the player cannot make.
 *
 * Drawn like a road, in a line, and paid for like nothing else in the game: see
 * `Simulation.designateFence` for why the timber is set aside when the order is
 * given rather than carried out to the line.
 */

import { cellLine } from '@/shared/math/gridLine';
import type { GridPoint } from '@/shared/types/geometry';
import { CellFlagGrid } from './CellFlagGrid';

/**
 * Logs per cell of fence.
 *
 * One, which for a settlement of any size is the cheapest building decision in
 * the game and for a settlement in its first autumn is a real one: twenty cells
 * of stake line is two and a half houses' worth of timber, and the first winter
 * does not have that to spare. Enclosing the whole settlement is not the plan the
 * numbers reward — screening the larder and the yard is.
 */
export const LOGS_PER_FENCE = 1;

export class FenceGrid extends CellFlagGrid {
  /**
   * `true` when a stake line lies between these two cells.
   *
   * The same test the fire system uses for a firebreak, and on purpose: the
   * player has already learned that what lies *between* two things decides
   * whether one reaches the other, and this is that rule doing a second job.
   *
   * Both ends are tested too, so standing on the fence line counts as behind it.
   */
  public screens(from: GridPoint, to: GridPoint): boolean {
    for (const cell of cellLine(from, to)) {
      if (this.hasAt(cell)) {
        return true;
      }
    }
    return false;
  }
}
