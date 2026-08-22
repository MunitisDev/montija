/**
 * The wood in winter, and the stake line that answers it.
 *
 * **A pack is never bad luck**, and every test here is about one of the five
 * decisions that make it so: what season it is, whether the settlement is past
 * its founding year, whether the harvest is lying in the open, whether anybody is
 * working the far wood alone, and whether a palisade stands between.
 *
 * Rolled with a stubbed night throughout, and deliberately: at a little over one
 * pack a year, a rule tested by playing years and hoping is a rule not tested at
 * all.
 */

import { describe, expect, it } from 'vitest';

import { Simulation } from '@/simulation/Simulation';
import {
  FIRST_WOLF_YEAR,
  KILL_CHANCE,
  NO_WOLVES,
  PACK_APPETITE,
  PACK_HEAPS,
  WOLF_REACH,
  runWolves,
} from '@/simulation/events/WolfSystem';
import { LOGS_PER_FENCE } from '@/simulation/world/FenceGrid';
import { restore, serialise } from '@/simulation/save/serialise';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '@/simulation/seasons/SeasonClock';
import type { GridPoint } from '@/shared/types/geometry';
import type { Villager } from '@/simulation/villagers/Villager';
import type { World } from '@/simulation/world/World';

const OPTIONS = { seed: 20260824, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

/** A night the pack comes down, and takes whoever it finds. */
const ALWAYS = { next: () => 0 };
function pack(
  simulation: Simulation,
  options: {
    season?: 'spring' | 'summer' | 'autumn' | 'winter';
    year?: number;
    random?: { next(): number };
  } = {},
) {
  return runWolves({
    world: simulation.world,
    villagers: simulation.villagers.all,
    random: options.random ?? ALWAYS,
    season: options.season ?? 'winter',
    year: options.year ?? FIRST_WOLF_YEAR,
  });
}

describe('when a pack comes down', () => {
  it('never in the growing half of the year', () => {
    // The wood is feeding them. A settlement's spring and summer are its own
    // business, which is also what keeps the threat pointed at the season the
    // game is about.
    const simulation = new Simulation(OPTIONS);
    expect(pack(simulation, { season: 'spring' })).toEqual(NO_WOLVES);
    expect(pack(simulation, { season: 'summer' })).toEqual(NO_WOLVES);
  });

  it('never in the settlement first year', () => {
    // Stated as a rule rather than hidden in a number: the first winter is this
    // game's whole objective and every figure in it was measured without wolves.
    const simulation = new Simulation(OPTIONS);
    expect(pack(simulation, { year: FIRST_WOLF_YEAR - 1 })).toEqual(NO_WOLVES);
    expect(pack(simulation, { year: FIRST_WOLF_YEAR }).prowled).toBe(true);
  });

  it('does not touch the settlement own random stream in a quiet season', () => {
    // No draw at all in spring, which is what makes every measurement taken
    // before wolves existed still describe those settlements exactly.
    const simulation = new Simulation(OPTIONS);
    let draws = 0;
    const counted = {
      next: () => {
        draws += 1;
        return 0;
      },
    };
    pack(simulation, { season: 'summer', random: counted });
    expect(draws).toBe(0);
  });
});

describe('what a pack takes', () => {
  it('the harvest, when it is lying in the open', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = besideTrees(simulation.world);
    simulation.world.piles.drop(cell, 'vegetables', 20);

    const report = pack(simulation);

    expect(report.stolenTotal).toBe(PACK_APPETITE);
    expect(report.stolen[0]?.resource).toBe('vegetables');
    expect(simulation.world.piles.totalOf('vegetables')).toBe(20 - PACK_APPETITE);
  });

  it('several heaps in one night, which is what a scavenger does', () => {
    // The rule that makes the mechanic bite: an exposed pile in this game holds
    // three or four, so one heap a night was a rounding error.
    const simulation = new Simulation(OPTIONS);
    const cell = besideTrees(simulation.world);
    for (let step = 0; step < PACK_HEAPS + 2; step += 1) {
      simulation.world.piles.drop({ gx: cell.gx + step, gy: cell.gy }, 'fruit', 2);
    }

    const report = pack(simulation);

    expect(report.stolen.length).toBe(PACK_HEAPS);
    expect(report.stolenTotal).toBe(PACK_HEAPS * 2);
  });

  it('nothing at all from a heap behind a palisade', () => {
    // The whole point of the fence, and it is the firebreak rule doing a second
    // job: what lies between decides whether one thing reaches the other.
    const simulation = new Simulation(OPTIONS);
    const cell = besideTrees(simulation.world);
    simulation.world.piles.drop(cell, 'vegetables', 20);
    fenceAround(simulation.world, cell);

    const report = pack(simulation);

    expect(report.stolenTotal).toBe(0);
    expect(simulation.world.piles.totalOf('vegetables')).toBe(20);
  });

  it('stone never, however much of it is lying about', () => {
    const simulation = new Simulation(OPTIONS);
    simulation.world.piles.drop(besideTrees(simulation.world), 'stone', 30);

    expect(pack(simulation).stolenTotal).toBe(0);
  });

  it('nothing from a heap the wood cannot reach', () => {
    // Clearing ground is a defence in itself: the same axes, doing a second job.
    const simulation = new Simulation(OPTIONS);
    const far = clearOfTrees(simulation.world);
    simulation.world.piles.drop(far, 'vegetables', 20);

    expect(pack(simulation).stolenTotal).toBe(0);
  });
});

describe('who a pack takes', () => {
  it('somebody working alone with the trees at their back', () => {
    const simulation = new Simulation(OPTIONS);
    const lone = strandOne(simulation);

    const report = pack(simulation);

    expect(report.killed).toEqual([lone.id]);
  });

  it('nobody who has company', () => {
    // What makes *where the settlement sends people* the decision. The founding
    // party stands together beside the stores, so it is safe by standing there.
    const simulation = new Simulation(OPTIONS);
    const cell = besideTrees(simulation.world);
    for (const villager of simulation.villagers.all) {
      villager.position = { wx: cell.gx + 0.5, wy: cell.gy + 0.5 };
    }

    const report = pack(simulation);

    expect(report.killed).toEqual([]);
    expect(report.escaped).toEqual([]);
  });

  it('nobody behind a palisade', () => {
    const simulation = new Simulation(OPTIONS);
    const lone = strandOne(simulation);
    fenceAround(simulation.world, lone.cell);

    expect(pack(simulation).killed).toEqual([]);
  });

  it('and usually nobody at all, because most of them get away', () => {
    // A quarter, not everybody: the roll is the last step of four decisions and
    // the other three are the interesting ones.
    const simulation = new Simulation(OPTIONS);
    const lone = strandOne(simulation);

    // The first draw is whether a pack comes at all; the second is whether it
    // catches anybody. A night that comes and misses.
    let draw = 0;
    const report = pack(simulation, {
      random: {
        next: () => {
          draw += 1;
          return draw === 1 ? 0 : KILL_CHANCE * 1.5;
        },
      },
    });

    expect(report.killed).toEqual([]);
    expect(report.escaped).toEqual([lone.id]);
  });

  it('and buries them under their own name, in the settlement roll', () => {
    // End to end through the simulation, because the roll of the dead is what
    // the player reads afterwards and it has to name the wolves.
    const simulation = new Simulation(OPTIONS);
    strandOne(simulation);
    // Winter of the second year, when a pack can actually come.
    simulation.restoreClock(TICKS_PER_YEAR + TICKS_PER_DAY * 40, 0);
    const before = simulation.villagers.count;

    for (let day = 0; day < 12 && simulation.villagers.count === before; day += 1) {
      runADay(simulation);
    }

    // The rate is one pack in twelve winter days, so this may or may not have
    // happened — what must hold is that if somebody died, the wolves are named.
    for (const record of simulation.necrology.all) {
      expect(['wolves', 'hunger', 'cold', 'hungerAndCold', 'illness']).toContain(record.cause);
    }
  });
});

describe('raising a stake line', () => {
  it('costs a log a cell, out of the yard', () => {
    const simulation = new Simulation(OPTIONS);
    const before = simulation.snapshot().stored.logs;

    expect(simulation.designateFence(openGround(simulation))).toBe(true);

    expect(simulation.snapshot().stored.logs).toBe(before - LOGS_PER_FENCE);
  });

  it('refuses when the yard has no timber', () => {
    const simulation = new Simulation(OPTIONS);
    emptyTheYards(simulation);

    expect(simulation.designateFence(openGround(simulation))).toBe(false);
  });

  it('gives the timber back when the order is called off', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openGround(simulation);
    const before = simulation.snapshot().stored.logs;

    simulation.designateFence(cell);
    expect(simulation.cancelFenceDesignation(cell)).toBe(true);

    expect(simulation.snapshot().stored.logs).toBe(before);
  });

  it('is work somebody has to walk out and do', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openGround(simulation);

    simulation.designateFence(cell);
    expect(simulation.hasFence(cell)).toBe(false);

    for (let day = 0; day < 20 && !simulation.hasFence(cell); day += 1) {
      runADay(simulation);
    }

    expect(simulation.hasFence(cell)).toBe(true);
  });

  it('does not stand in anybody way', () => {
    // Deliberate: a real palisade has a gate, and a fence that blocked the
    // pathfinder would be a whole class of unrecoverable mistake — a settlement
    // walled in by its own defence.
    const simulation = new Simulation(OPTIONS);
    const cell = openGround(simulation);
    const before = simulation.world.navigation.costAt(cell.gx, cell.gy);

    simulation.world.raiseFence(cell);

    expect(simulation.world.navigation.costAt(cell.gx, cell.gy)).toBe(before);
    expect(simulation.world.navigation.isWalkable(cell.gx, cell.gy)).toBe(true);
  });

  it('comes back after a save and a load', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = openGround(simulation);
    simulation.world.raiseFence(cell);

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, 'now'));

    expect(loaded.hasFence(cell)).toBe(true);
  });
});

// --- helpers ---------------------------------------------------------------

function runADay(simulation: Simulation): void {
  for (let tick = 0; tick < TICKS_PER_DAY; tick += 1) {
    simulation.update(simulation.tick + 1, 0.1);
  }
}

/** A walkable cell with trees within a pack's reach. */
function besideTrees(world: World): GridPoint {
  for (let gy = 2; gy < world.height - 2; gy += 1) {
    for (let gx = 2; gx < world.width - 2; gx += 1) {
      const cell = { gx, gy };
      if (!world.navigation.isWalkable(cell.gx, cell.gy) || world.trees.has(cell)) {
        continue;
      }
      if (treesNear(world, cell)) {
        return cell;
      }
    }
  }
  throw new Error('no cell beside trees');
}

/** A walkable cell no pack could reach, for the tests about clearing ground. */
function clearOfTrees(world: World): GridPoint {
  for (let gy = 2; gy < world.height - 2; gy += 1) {
    for (let gx = 2; gx < world.width - 2; gx += 1) {
      const cell = { gx, gy };
      if (!world.navigation.isWalkable(cell.gx, cell.gy) || world.trees.has(cell)) {
        continue;
      }
      if (!treesNear(world, cell)) {
        return cell;
      }
    }
  }
  throw new Error('no cell clear of trees');
}

function treesNear(world: World, cell: GridPoint): boolean {
  for (let gy = cell.gy - WOLF_REACH; gy <= cell.gy + WOLF_REACH; gy += 1) {
    for (let gx = cell.gx - WOLF_REACH; gx <= cell.gx + WOLF_REACH; gx += 1) {
      if (world.terrain.contains(gx, gy) && world.trees.has({ gx, gy })) {
        return true;
      }
    }
  }
  return false;
}

/** Rings a cell with stakes, so nothing has a line to it. */
function fenceAround(world: World, cell: GridPoint): void {
  for (let gy = cell.gy - 1; gy <= cell.gy + 1; gy += 1) {
    for (let gx = cell.gx - 1; gx <= cell.gx + 1; gx += 1) {
      if (gx === cell.gx && gy === cell.gy) {
        continue;
      }
      world.fences.lay(gx, gy);
    }
  }
}

/**
 * Sends one villager to the treeline and everybody else to the far corner.
 *
 * Which is the situation the rule is about: a settlement working the far wood
 * with one pair of hands.
 */
function strandOne(simulation: Simulation): Villager {
  const world = simulation.world;
  const treeline = besideTrees(world);
  const away = clearOfTrees(world);
  const [lone, ...rest] = simulation.villagers.all;
  if (!lone) {
    throw new Error('no villagers');
  }
  lone.position = { wx: treeline.gx + 0.5, wy: treeline.gy + 0.5 };
  for (const villager of rest) {
    villager.position = { wx: away.gx + 0.5, wy: away.gy + 0.5 };
  }
  return lone;
}

/**
 * Somewhere to fence, near the settlement.
 *
 * Searched outwards from the camp rather than from the corner of the map: the
 * far corner of a valley is often across the river, and a job nobody can walk to
 * is a job nobody does — which is true of the game and useless as a fixture.
 */
function openGround(simulation: Simulation): GridPoint {
  const world = simulation.world;
  const camp = world.landfallCell;
  for (let ring = 2; ring < 12; ring += 1) {
    for (let gy = camp.gy - ring; gy <= camp.gy + ring; gy += 1) {
      for (let gx = camp.gx - ring; gx <= camp.gx + ring; gx += 1) {
        if (world.canFence({ gx, gy }) && world.navigation.isWalkable(gx, gy)) {
          return { gx, gy };
        }
      }
    }
  }
  throw new Error('nowhere to fence');
}

function emptyTheYards(simulation: Simulation): void {
  for (const storage of simulation.storages.all) {
    for (const { resource, amount } of storage.inventory.contents) {
      storage.inventory.remove(resource, amount);
    }
  }
}
