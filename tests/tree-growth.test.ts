/**
 * A tree, growing where the player can see it.
 *
 * **What this replaced was invisible.** A felled cell used to owe a tree five
 * years later out of a ledger only the save file knew about, and the difference
 * between a wood being cropped sustainably and a wood being emptied was two
 * numbers nobody could look at. A stand of saplings says the same thing, on the
 * map, at a glance.
 *
 * The properties worth holding are the ones a player will feel:
 *
 * - a tree the map was generated with is fellable on the first morning;
 * - a sapling is not, and cutting it gives **nothing** rather than less;
 * - three years takes it back to full timber, through a size at eighteen months;
 * - the sapling that follows a workshop's felling appears **on the cell it cut**,
 *   under the logs that just fell there;
 * - the renderer is told a tree grew, and told nothing on the thousands of days
 *   when none did.
 */

import { describe, expect, it } from 'vitest';

import { buildingDefinition } from '@/data/buildings';
import { LOGS_PER_TREE } from '@/data/resources';
import { Simulation } from '@/simulation/Simulation';
import { JOB_WORK_TICKS } from '@/simulation/jobs/Job';
import { DAYS_PER_YEAR, TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import {
  HALF_GROWN_DAYS,
  MATURE_DAYS,
  MATURE_YEARS,
  treeStage,
} from '@/simulation/world/TreeGrowth';
import { TreeRegistry } from '@/simulation/world/TreeRegistry';
import { World } from '@/simulation/world/World';
import type { GridPoint } from '@/shared/types/geometry';

const OPTIONS = { seed: 20260816, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

describe('how far along a tree is', () => {
  it('counts three years to timber, in the game’s own years', () => {
    expect(MATURE_DAYS).toBe(MATURE_YEARS * DAYS_PER_YEAR);
    expect(HALF_GROWN_DAYS).toBe(MATURE_DAYS / 2);
  });

  it('goes sapling, young, mature and stays there', () => {
    expect(treeStage(0, 0)).toBe('sapling');
    expect(treeStage(0, HALF_GROWN_DAYS - 1)).toBe('sapling');
    expect(treeStage(0, HALF_GROWN_DAYS)).toBe('young');
    expect(treeStage(0, MATURE_DAYS - 1)).toBe('young');
    expect(treeStage(0, MATURE_DAYS)).toBe('mature');
    expect(treeStage(0, MATURE_DAYS * 10)).toBe('mature');
  });

  it('has the wood the settlers walk into already grown', () => {
    // The valley was there before them, so its trees are planted before day one.
    // A first morning spent looking at a map of saplings would be a different
    // game, and a much worse one.
    const world = new World({ width: 48, height: 48, seed: 20260816 });
    const trees = [...world.trees.all];
    expect(trees.length).toBeGreaterThan(0);
    expect(trees.every((tree) => world.trees.isMature(tree))).toBe(true);
  });
});

describe('the registry as a calendar', () => {
  it('tells the renderer when a tree changes size, and only then', () => {
    // Every renderer in this game syncs off a version counter, and two thousand
    // sprites must not be rescaled on the thousands of days when nothing grew.
    const registry = new TreeRegistry(48, []);
    registry.plant(4, 4, 0, 1, 0);
    const start = registry.version;

    registry.setDay(HALF_GROWN_DAYS - 1);
    expect(registry.version).toBe(start);

    registry.setDay(HALF_GROWN_DAYS);
    expect(registry.version).toBe(start + 1);

    const grown = registry.version;
    registry.setDay(HALF_GROWN_DAYS + 5);
    expect(registry.version).toBe(grown);

    registry.setDay(MATURE_DAYS);
    expect(registry.version).toBe(grown + 1);
  });

  it('bumps once for a day that grew a hundred trees', () => {
    // The counter is a "something changed" flag, not a count of what did.
    const registry = new TreeRegistry(48, []);
    for (let index = 0; index < 100; index += 1) {
      registry.plant(index % 40, Math.floor(index / 40), 0, 1, 0);
    }
    const start = registry.version;
    registry.setDay(MATURE_DAYS);
    expect(registry.version).toBe(start + 1);
  });

  it('plants at today unless told otherwise', () => {
    const registry = new TreeRegistry(48, []);
    registry.setDay(300);
    const sapling = registry.plant(2, 2, 0, 1)!;
    expect(registry.stage(sapling)).toBe('sapling');
  });
});

describe('felling a tree that has not grown', () => {
  it('gives no timber at all', () => {
    // Not a smaller harvest — no harvest. That is what makes "leave it another
    // year" a decision rather than a rounding error.
    const world = new World({ width: 48, height: 48, seed: 20260816 });
    const cell = openGround(world);
    const sapling = world.trees.plant(cell.gx, cell.gy, 0, 1, 0)!;

    expect(world.fellTree(sapling.id)).toBe(true);
    expect(world.piles.totalOf('logs')).toBe(0);
  });

  it('gives a full load once the same tree is grown', () => {
    const world = new World({ width: 48, height: 48, seed: 20260816 });
    const cell = openGround(world);
    const tree = world.trees.plant(cell.gx, cell.gy, 0, 1, 0)!;
    world.trees.setDay(MATURE_DAYS);

    expect(world.fellTree(tree.id)).toBe(true);
    expect(world.piles.totalOf('logs')).toBe(LOGS_PER_TREE);
  });

  it('is quicker work than felling a grown one', () => {
    // An axe and a wedge against a spade. Charging the same for both would make
    // clearing ground for a house cost what harvesting the timber to build it
    // does, which is the wrong way round.
    const simulation = new Simulation(OPTIONS);
    const grown = someTree(simulation);
    simulation.designateTreeForFelling(grown);
    const felling = simulation.jobs.findByTarget(
      'chop-tree',
      simulation.world.trees.getAt(grown)!.id,
    )!;
    expect(felling.workRemaining).toBe(JOB_WORK_TICKS['chop-tree']);

    // Now a sapling, planted where there was open ground.
    const bare = openGround(simulation.world);
    const sapling = simulation.world.trees.plant(bare.gx, bare.gy, 0, 1, 0)!;
    simulation.designateTreeForFelling(bare);
    const clearing = simulation.jobs.findByTarget('chop-tree', sapling.id)!;
    expect(clearing.workRemaining).toBeLessThan(felling.workRemaining);
  });
});

describe('the sapling that follows a workshop', () => {
  it('takes root under the logs that have just fallen', () => {
    // The one planting that goes ahead over a heap: the timber from this very
    // tree is on the cell by definition, and a wood that could only come back
    // where nobody had left anything would not come back at all.
    const world = new World({ width: 48, height: 48, seed: 20260816 });
    const cell = openGround(world);
    world.piles.drop(cell, 'logs', LOGS_PER_TREE);

    expect(world.canGrowTree(cell)).toBe(false);
    expect(world.regrowTree(cell, 0, 1)).toBe(true);
    expect(world.trees.has(cell)).toBe(true);
  });

  it('still refuses a road, a building and a tree already there', () => {
    const world = new World({ width: 48, height: 48, seed: 20260816 });
    const paved = openGround(world);
    world.paveRoad(paved);
    expect(world.regrowTree(paved, 0, 1)).toBe(false);

    const taken = openGround(world, paved);
    world.trees.plant(taken.gx, taken.gy, 0, 1, 0);
    expect(world.regrowTree(taken, 0, 1)).toBe(false);
  });
});

describe("a feller's hut and the wood around it", () => {
  it('marks grown trees and leaves the nursery alone', () => {
    // A hut that cut its own saplings would be spending its people's day to make
    // its own wood poorer. A hut whose ground is all young trees posts nothing
    // and waits, which is the pressure the whole cycle is for.
    const simulation = new Simulation(OPTIONS);
    const hut = raiseFeller(simulation);
    simulation.storages.all[0]!.inventory.clear();
    simulation.storages.markChanged();

    // Turn every tree in its range into a sapling planted this morning.
    const radius = buildingDefinition('feller').felling!.radius;
    const centre = hut.accessCell;
    const nursery = new Set<number>();
    for (const tree of [...simulation.world.trees.all]) {
      if (Math.abs(tree.gx - centre.gx) <= radius && Math.abs(tree.gy - centre.gy) <= radius) {
        simulation.world.trees.remove(tree.id);
        const sapling = simulation.world.trees.plant(tree.gx, tree.gy, tree.variant, tree.scale, 0);
        if (sapling) {
          nursery.add(sapling.id);
        }
      }
    }
    expect(nursery.size).toBeGreaterThan(0);

    for (let tick = 0; tick < TICKS_PER_DAY * 2; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
    }

    const marked = [...simulation.jobs.all].filter((job) => job.type === 'chop-tree');
    for (const job of marked) {
      expect(nursery.has(job.targetEntityId ?? -1), `${job.target.gx},${job.target.gy}`).toBe(
        false,
      );
    }
  });
});

// --- helpers ---------------------------------------------------------------

/** A cell a tree could take, skipping any the caller has already used. */
function openGround(world: World, ...skip: readonly GridPoint[]): GridPoint {
  for (let gy = 0; gy < world.height; gy += 1) {
    for (let gx = 0; gx < world.width; gx += 1) {
      const cell = { gx, gy };
      if (!world.canGrowTree(cell)) {
        continue;
      }
      if (skip.some((used) => used.gx === gx && used.gy === gy)) {
        continue;
      }
      return cell;
    }
  }
  throw new Error('nowhere in this world will take a tree');
}

/** Any standing tree's cell. */
function someTree(simulation: Simulation): GridPoint {
  for (const tree of simulation.world.trees.all) {
    return { gx: tree.gx, gy: tree.gy };
  }
  throw new Error('a generated world with no trees at all');
}

function raiseFeller(simulation: Simulation) {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      if (!simulation.canPlaceBuilding('feller', { gx, gy }).ok) {
        continue;
      }
      const hut = simulation.placeBuilding('feller', { gx, gy });
      if (hut) {
        simulation.world.buildings.complete(simulation.world, hut);
        return hut;
      }
    }
  }
  throw new Error("nowhere to put a feller's hut");
}
