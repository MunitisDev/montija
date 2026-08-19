/**
 * Who felled it, and whether it grows back.
 *
 * Every felled tree used to be the same felled tree: grass, and maybe the wild
 * spread creeping in years later. That made the two things a player fells for —
 * **clearing a site** and **cutting timber** — indistinguishable, and it left the
 * player marking trees one at a time, every winter, to keep a Woodcutter fed.
 *
 * Two rules replace it, and this file is about the seam between them:
 *
 * - a workshop's own felling leaves a **sapling standing on the cell**, which
 *   grows back over three years where the player can see it;
 * - the player's own felling clears the ground for good.
 *
 * The ledger of stumps that used to hold the first half is gone, along with the
 * Forester's Lodge: a felled cell that owed a tree in five years was a fact only
 * the save file knew, and a sapling standing on it is a fact the player can act
 * on. How a single tree grows is `tree-growth.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingId } from '@/data/buildings';
import { buildingDefinition } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';
import { Simulation } from '@/simulation/Simulation';
import { restore, serialise } from '@/simulation/save/serialise';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { Woodland } from '@/simulation/world/Woodland';
import { HALF_GROWN_DAYS, MATURE_DAYS } from '@/simulation/world/TreeGrowth';

const OPTIONS = { seed: 20260816, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

describe('the ledger of cleared ground', () => {
  it('remembers ground cleared for good', () => {
    const woodland = new Woodland();
    woodland.clear({ gx: 2, gy: 3 });
    expect(woodland.isBarren({ gx: 2, gy: 3 })).toBe(true);
  });

  it('lets woodland reclaim a clearing', () => {
    // The last thing done to a cell is what it remembers. A workshop cutting
    // timber on ground the player once cleared is that ground being worked as a
    // wood again, so it stops being a permanent clearing.
    const woodland = new Woodland();
    woodland.clear({ gx: 4, gy: 4 });
    woodland.reclaim({ gx: 4, gy: 4 });
    expect(woodland.isBarren({ gx: 4, gy: 4 })).toBe(false);
  });

  it('keeps its cells apart', () => {
    const woodland = new Woodland();
    woodland.clear({ gx: 1, gy: 2 });
    expect(woodland.isBarren({ gx: 2, gy: 1 })).toBe(false);
  });
});

describe('a settlement felling trees', () => {
  /**
   * Cleared ground a settlement has before anybody fells anything.
   *
   * The founding camp's own plot. It is a store rather than a building, so the
   * rule that keeps the woods two cells from every building never applied to it —
   * measured over four simulated years, one camp in four grew a tree on itself —
   * and it is now remembered as ground cleared on purpose, which is what it is.
   * See `tests/ground-under-buildings.test.ts`.
   *
   * So these counts are read as differences rather than as absolutes.
   */
  function barrenBefore(): number {
    return new Simulation(OPTIONS).woodland.barrenCount;
  }

  it('leaves a sapling standing where a workshop cropped', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = firstTree(simulation);
    fellNow(simulation, cell, false);

    // A tree on the cell again the same afternoon, and a small one: this is the
    // whole of what replaced the ledger of stumps.
    const sapling = simulation.world.trees.getAt(cell);
    expect(sapling).not.toBeNull();
    expect(simulation.world.trees.stage(sapling!)).toBe('sapling');
    expect(simulation.woodland.barrenCount).toBe(barrenBefore());
  });

  it('clears the ground for good where the player marked', () => {
    const simulation = new Simulation(OPTIONS);
    const tree = firstTree(simulation);
    fellNow(simulation, tree, true);

    expect(simulation.woodland.barrenCount).toBe(barrenBefore() + 1);
    expect(simulation.woodland.isBarren(tree)).toBe(true);
    // Nothing standing there: the player marked it to make room, and a sapling
    // turning up where they meant to put a house is the game undoing their work.
    expect(simulation.world.trees.has(tree)).toBe(false);
  });

  it('gives timber for a grown tree and nothing for a young one', () => {
    // What makes "leave it another year" a decision rather than a rounding
    // error: cutting a tree early is not a smaller harvest, it is no harvest.
    const simulation = new Simulation(OPTIONS);
    const cell = firstTree(simulation);
    fellNow(simulation, cell, false);
    const afterTheTree = looseLogs(simulation);
    expect(afterTheTree).toBeGreaterThan(0);

    // Now fell the sapling that took its place.
    fellNow(simulation, cell, false);
    expect(looseLogs(simulation)).toBe(afterTheTree);
  });
});

describe('the woodland growing back', () => {
  it('grows a cropped cell back to full timber in three years', () => {
    // Driven through the simulation's own daily pass, so the clock, the tree and
    // the felling all have to agree.
    const simulation = new Simulation(OPTIONS);
    const cell = firstTree(simulation);
    fellNow(simulation, cell, false);

    const tree = () => simulation.world.trees.getAt(cell)!;
    expect(simulation.world.trees.stage(tree())).toBe('sapling');

    runDays(simulation, HALF_GROWN_DAYS + 1);
    expect(simulation.world.trees.stage(tree())).toBe('young');

    runDays(simulation, MATURE_DAYS - HALF_GROWN_DAYS);
    expect(simulation.world.trees.stage(tree())).toBe('mature');
  });

  it('leaves cleared ground bare for as long as anybody watches', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = firstTree(simulation);
    fellNow(simulation, cell, true);

    runDays(simulation, MATURE_DAYS + 2);
    expect(simulation.world.trees.has(cell)).toBe(false);
    expect(simulation.woodland.isBarren(cell)).toBe(true);
  });
});

describe("a feller's hut", () => {
  it('marks trees near it without being asked', () => {
    // The whole point: splitting logs into firewood is useless without logs, and
    // the only way to get them was to mark trees by hand, every winter, for ever.
    //
    // Felling used to be the Woodcutter's second trade, which is a workshop
    // doing two unrelated jobs where the player can see neither. It is the
    // Feller's Hut now, and the Woodcutter only splits.
    const simulation = new Simulation(OPTIONS);
    const shop = raise(simulation, 'feller');
    expect(shop).not.toBeNull();
    simulation.storages.all[0]!.inventory.clear();
    simulation.storages.markChanged();

    runDays(simulation, 2);

    const felling = simulation.jobs.all.filter((job) => job.type === 'chop-tree');
    expect(felling.length).toBeGreaterThan(0);
    // And nothing it ordered is the player's, so the wood grows back.
    expect(felling.every((job) => job.playerOrdered !== true)).toBe(true);
    // Its own people's work, not everybody's chore: posted as open work at
    // ordinary priority it lost to the day's hauling for ever and no timber
    // ever came in. See `Job.employerId`.
    expect(felling.every((job) => job.employerId === shop!.id)).toBe(true);
  });

  it('is the only building that fells — a Woodcutter splits and nothing else', () => {
    expect(buildingDefinition('woodcutter').felling).toBeUndefined();
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'woodcutter');
    simulation.storages.all[0]!.inventory.clear();
    simulation.storages.markChanged();

    runDays(simulation, 2);

    expect(simulation.jobs.all.filter((job) => job.type === 'chop-tree')).toHaveLength(0);
  });

  it('stops once the yard has logs enough', () => {
    // A workshop with a full yard has no business emptying the wood. This is
    // what stops an automatic woodcutter stripping the map.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'feller');
    const target = buildingDefinition('feller').felling!.logTarget;
    simulation.storages.all[0]!.inventory.add('logs', target * 2);
    simulation.storages.markChanged();

    runDays(simulation, 2);

    expect(simulation.jobs.all.filter((job) => job.type === 'chop-tree')).toHaveLength(0);
  });

  it('never keeps more orders standing than it can work through', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'feller');
    simulation.storages.all[0]!.inventory.clear();
    simulation.storages.markChanged();

    const cap = buildingDefinition('feller').felling!.outstanding;
    for (let day = 0; day < 6; day += 1) {
      runDays(simulation, 1);
      const unworked = simulation.jobs.all.filter(
        (job) => job.type === 'chop-tree' && job.state === 'available',
      );
      expect(unworked.length).toBeLessThanOrEqual(cap);
    }
  });
});

describe('a settlement that remembers', () => {
  it('carries its clearings and the age of its trees through a save', () => {
    const simulation = new Simulation(OPTIONS);
    const cropped = firstTree(simulation);
    fellNow(simulation, cropped, false);
    const cleared = firstTree(simulation);
    fellNow(simulation, cleared, true);

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, 'now'));

    expect(loaded.woodland.isBarren(cleared)).toBe(true);
    expect(loaded.woodland.isBarren(cropped)).toBe(false);
    // And the sapling comes back a sapling rather than a full tree, which is the
    // difference between a wood that was spent and one that was not.
    expect(loaded.world.trees.stage(loaded.world.trees.getAt(cropped)!)).toBe('sapling');
  });

  it('reads an older save as a settlement that never cleared anything', () => {
    const simulation = new Simulation(OPTIONS);
    const save = serialise(simulation, 'now');
    const { woodland: _dropped, ...older } = save;

    const loaded = new Simulation(OPTIONS);
    restore(loaded, older as typeof save);
    expect(loaded.woodland.barrenCount).toBe(0);
  });
});

/** Fells a tree this instant, as if the job had just been completed. */
function fellNow(
  simulation: Simulation,
  cell: { gx: number; gy: number },
  byPlayer: boolean,
): void {
  const tree = simulation.world.trees.getAt(cell);
  if (!tree) {
    throw new Error(`No tree at ${cell.gx},${cell.gy}`);
  }
  if (byPlayer) {
    simulation.designateTreeForFelling(cell);
  } else {
    simulation.jobs.create({
      type: 'chop-tree',
      target: cell,
      priority: 20,
      targetEntityId: tree.id,
    });
  }

  const job = simulation.jobs.findByTarget('chop-tree', tree.id);
  if (!job) {
    throw new Error('The felling order went missing');
  }
  // Straight to the outcome: this file is about what the ground remembers, not
  // about how long somebody takes to walk there.
  simulation.world.fellTree(tree.id);
  simulation.villagers.onTreeFelled?.(cell, job.playerOrdered === true);
  simulation.jobs.cancel(job.id);
}

/** Logs lying on the ground, which is where felled timber lands. */
function looseLogs(simulation: Simulation): number {
  return simulation.world.piles.totalOf('logs');
}

function firstTree(simulation: Simulation): { gx: number; gy: number } {
  for (const tree of simulation.world.trees.all) {
    return { gx: tree.gx, gy: tree.gy };
  }
  throw new Error('A generated world with no trees at all');
}

function runDays(simulation: Simulation, days: number): void {
  for (let tick = 0; tick < TICKS_PER_DAY * days; tick += 1) {
    simulation.update(simulation.tick + 1, 0.1);
  }
}

function raise(simulation: Simulation, id: BuildingId): Building | null {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      const cell = { gx, gy };
      if (simulation.canPlaceBuilding(id, cell).ok) {
        const building = simulation.placeBuilding(id, cell);
        if (building) {
          simulation.world.buildings.complete(simulation.world, building);
        }
        return building;
      }
    }
  }
  return null;
}
