/**
 * Woodland that grows back.
 *
 * Until this existed the map could only ever shrink. A felled tree was gone for
 * good and a worked-out deposit became grass, so a settlement of forty people in
 * its sixth year would run out of everything with no move left to make — the
 * failure state was arithmetic rather than a decision. That is the wrong kind of
 * hard.
 *
 * The design this project takes is the one deep settlement sims settled on
 * decades ago, and it is an **asymmetry**:
 *
 * - **Timber is renewable, and rewards management.** Woods spread on their own
 *   into open ground, slowly. A settlement that fells everything within reach
 *   waits years for it back; one that leaves stands standing, or runs a
 *   forester, has wood forever.
 * - **Minerals are not.** Surface deposits are consumed for good, and the only
 *   permanent supply is a quarry or a mine — which costs a large piece of land
 *   you never get back.
 *
 * One resource you tend, one you pay for. Everything here implements the first
 * half; `data/buildings.ts` holds the second.
 *
 * Runs once a day, not once a tick. A forest that visibly creeps every tenth of
 * a second is a lawn, and the daily boundary is where every other slow process
 * in this game already lives.
 */

import type { SeededRandom } from '@/shared/math/random';
import type { GridPoint } from '@/shared/types/geometry';
import type { World } from './World';

/**
 * Chance per standing tree, per day, of seeding a neighbour.
 *
 * Low on purpose, and lower than it looks: most rolls land on ground that
 * refuses a sapling anyway. A mature wood of a thousand trees makes ten
 * attempts a day and plants a fraction of them — visible over a season, useless
 * as a way to outrun a woodcutter, which is exactly the intended relationship
 * between the two.
 */
export const SEED_CHANCE_PER_DAY = 0.01;

/**
 * Tree neighbours a cell needs before a sapling will take there.
 *
 * **This is what makes it a wood rather than a weed.** Without it every tree
 * seeds freely into open ground, the growth compounds, and a hundred days turns
 * five hundred trees into eight hundred — a map slowly swallowed whole. With
 * it, woodland thickens and creeps at its own edge: clearings fill back in from
 * the trees around them, and open meadow a long way from any wood stays
 * meadow, which is both the behaviour a player expects and the behaviour that
 * makes clear-felling a decision with a cost.
 *
 * Two, of eight. The seeding tree is one of them by construction, so a cell
 * needs at least one *other* tree beside it.
 */
export const MIN_TREE_NEIGHBOURS = 2;

/** The eight cells around one, in a fixed order so the spread is reproducible. */
const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/**
 * How far from a finished building the woods stay away, in cells.
 *
 * Cleared land stays cleared. A settlement that has to re-fell its own square
 * every spring is not being asked to make a decision, it is being given a
 * chore — and the player would rightly read a sapling appearing between their
 * houses as the game undoing their work.
 */
export const BUILDING_CLEARANCE = 2;

/**
 * The fraction of the map woodland will cover before it stops spreading.
 *
 * **There has to be a ceiling, and it has to be this crude.** Measured over
 * twelve simulated years of neglect, the neighbour rule alone slowed the spread
 * without ever stopping it — a wood's edge advances one cell at a time and the
 * map fills eventually. And no *local* rule can fix that, because a clearing
 * inside a wood and the outer edge of a wood are geometrically the same thing:
 * anything that refuses one refuses the other, and the refilling of felled land
 * is the entire point of the feature.
 *
 * So the distinction is made globally instead. A generated map starts around a
 * fifth woodland; letting it reach a third leaves generous room for a
 * clear-felled settlement to recover, and guarantees the spread terminates
 * rather than merely slowing down. Measured: a neglected map reaches the
 * ceiling in about four years and then holds there indefinitely.
 *
 * The ceiling binds *natural* spread only. A forester's lodge plants past it,
 * which is the whole asymmetry in one line: the wilderness will only give you
 * so much back, and anything more is something you did on purpose.
 */
export const WOODLAND_CAP_FRACTION = 0.3;

/** Trees the renderer can draw. Kept in step with the generator's own count. */
const TREE_VARIANTS = 6;

export interface ForestReport {
  /** Saplings that took root today. */
  readonly grown: number;
}

export const NO_FOREST_CHANGE: ForestReport = { grown: 0 };

/**
 * Spreads the woods by one day.
 *
 * Deterministic given the same world and the same random stream, like every
 * other daily process — a settlement replayed from its seed must grow the same
 * forest.
 */
export function runForestRegrowth(
  world: World,
  random: SeededRandom,
  /**
   * Ground the wild spread may not take, whatever the neighbours say.
   *
   * The player's own clearings. A wood creeping back into the square somebody
   * levelled for a house is the game undoing their work — see `Woodland.ts`.
   * Optional, so the system still runs on its own in a test.
   */
  isCleared: (cell: GridPoint) => boolean = () => false,
): ForestReport {
  // Checked once, up front. A map already at its ceiling does no work at all,
  // which also makes the whole system free on an old, heavily wooded save.
  const ceiling = Math.floor(world.width * world.height * WOODLAND_CAP_FRACTION);
  if (world.trees.count >= ceiling) {
    return NO_FOREST_CHANGE;
  }

  // Snapshotted before planting, or today's saplings would immediately get a
  // roll of their own and the wood would spread geometrically within one day.
  const standing = [...world.trees.all];
  let grown = 0;

  for (const tree of standing) {
    if (world.trees.count >= ceiling) {
      break;
    }
    if (random.next() >= SEED_CHANCE_PER_DAY) {
      continue;
    }

    // One attempt, at one neighbouring cell. A tree that happens to be
    // surrounded simply misses its turn, which is the correct behaviour: a
    // wood grows at its edges.
    const offset = NEIGHBOUR_OFFSETS[random.int(0, NEIGHBOUR_OFFSETS.length)];
    if (!offset) {
      continue;
    }

    const cell: GridPoint = { gx: tree.gx + offset[0], gy: tree.gy + offset[1] };
    if (!world.canGrowTree(cell) || nearBuilding(world, cell) || isCleared(cell)) {
      continue;
    }
    if (treeNeighbours(world, cell) < MIN_TREE_NEIGHBOURS) {
      continue;
    }

    // Drawn even though the sapling might still fail, so the number of rolls
    // per successful plant stays fixed. Determinism is only worth claiming if
    // it does not depend on how the map happens to be laid out.
    const variant = random.int(0, TREE_VARIANTS);
    const scale = random.float(0.6, 0.9);
    if (world.plantTree(cell, variant, scale)) {
      grown += 1;
    }
  }

  return { grown };
}

/** How many of a cell's eight neighbours have a tree on them. */
function treeNeighbours(world: World, cell: GridPoint): number {
  let count = 0;
  for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
    if (world.trees.has({ gx: cell.gx + dx, gy: cell.gy + dy })) {
      count += 1;
    }
  }
  return count;
}

/** `true` when a finished building stands within the clearance of this cell. */
function nearBuilding(world: World, cell: GridPoint): boolean {
  for (let dy = -BUILDING_CLEARANCE; dy <= BUILDING_CLEARANCE; dy += 1) {
    for (let dx = -BUILDING_CLEARANCE; dx <= BUILDING_CLEARANCE; dx += 1) {
      if (world.buildings.getAt({ gx: cell.gx + dx, gy: cell.gy + dy }) !== null) {
        return true;
      }
    }
  }
  return false;
}
