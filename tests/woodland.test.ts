/**
 * Who felled it, and whether it grows back.
 *
 * Every felled tree used to be the same felled tree: grass, and maybe the wild
 * spread creeping in years later. That made the two things a player fells for —
 * **clearing a site** and **cutting timber** — indistinguishable, and it left the
 * player marking trees one at a time, every winter, to keep a Woodcutter fed.
 *
 * Three rules replace it, and this file is about the seam between them:
 *
 * - a workshop's own felling leaves a stump, back in five years;
 * - the player's felling clears the ground for good;
 * - unless a forester's lodge stands within reach, which reprieves everything
 *   around it.
 *
 * The stump clock is long — 240 days — so most of what follows drives the
 * `Woodland` ledger directly rather than simulating five years of a settlement.
 * The end-to-end tests are the ones that matter and the ones that are slow; both
 * kinds are here.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingId } from '@/data/buildings';
import { buildingDefinition } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';
import { Simulation } from '@/simulation/Simulation';
import { restore, serialise } from '@/simulation/save/serialise';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { REGROWTH_DAYS, REGROWTH_YEARS, Woodland } from '@/simulation/world/Woodland';

const OPTIONS = { seed: 20260816, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

describe('the ledger of what was felled', () => {
  it('brings a cropped tree back after five years and not before', () => {
    const woodland = new Woodland();
    woodland.stump({ gx: 5, gy: 5 }, 100);

    expect(woodland.due(100 + REGROWTH_DAYS - 1)).toEqual([]);
    expect(woodland.due(100 + REGROWTH_DAYS)).toEqual([{ gx: 5, gy: 5, day: 100 + REGROWTH_DAYS }]);
  });

  it('counts five years in the game’s own years', () => {
    expect(REGROWTH_DAYS).toBe(REGROWTH_YEARS * 48);
  });

  it('hands a stump over once and then forgets it', () => {
    const woodland = new Woodland();
    woodland.stump({ gx: 1, gy: 1 }, 0);
    expect(woodland.due(REGROWTH_DAYS)).toHaveLength(1);
    expect(woodland.due(REGROWTH_DAYS)).toHaveLength(0);
  });

  it('remembers ground cleared for good, and owes it nothing', () => {
    const woodland = new Woodland();
    woodland.clear({ gx: 2, gy: 3 });

    expect(woodland.isBarren({ gx: 2, gy: 3 })).toBe(true);
    expect(woodland.due(100000)).toEqual([]);
  });

  it('lets clearing cancel a stump, and a stump cancel a clearing', () => {
    // The last thing done to a cell is what it remembers. Both directions,
    // because a cell can be cleared, replanted and cleared again.
    const woodland = new Woodland();
    woodland.stump({ gx: 4, gy: 4 }, 0);
    woodland.clear({ gx: 4, gy: 4 });
    expect(woodland.due(100000)).toEqual([]);

    woodland.stump({ gx: 4, gy: 4 }, 0);
    expect(woodland.isBarren({ gx: 4, gy: 4 })).toBe(false);
  });

  it('forgets everything about a cell a forester planted on', () => {
    const woodland = new Woodland();
    woodland.clear({ gx: 7, gy: 7 });
    woodland.planted({ gx: 7, gy: 7 });

    expect(woodland.isBarren({ gx: 7, gy: 7 })).toBe(false);
  });

  it('keeps its cells apart', () => {
    const woodland = new Woodland();
    woodland.clear({ gx: 1, gy: 2 });
    expect(woodland.isBarren({ gx: 2, gy: 1 })).toBe(false);
  });
});

describe('a settlement felling trees', () => {
  it('leaves a stump where a workshop cropped', () => {
    const simulation = new Simulation(OPTIONS);
    const tree = firstTree(simulation);
    fellNow(simulation, tree, false);

    expect(simulation.woodland.stumpCount).toBe(1);
    expect(simulation.woodland.barrenCount).toBe(0);
  });

  it('clears the ground for good where the player marked', () => {
    const simulation = new Simulation(OPTIONS);
    const tree = firstTree(simulation);
    fellNow(simulation, tree, true);

    expect(simulation.woodland.barrenCount).toBe(1);
    expect(simulation.woodland.isBarren(tree)).toBe(true);
    expect(simulation.woodland.stumpCount).toBe(0);
  });

  it('spares even the player’s felling when a forester is watching', () => {
    // What a lodge is for: the woods around it recover from anything.
    const simulation = new Simulation(OPTIONS);
    const lodge = raise(simulation, 'forester');
    expect(lodge).not.toBeNull();

    const radius = buildingDefinition('forester').forestry!.radius;
    const near = nearestTreeWithin(simulation, lodge!.accessCell, radius);
    expect(near).not.toBeNull();

    fellNow(simulation, near!, true);
    expect(simulation.woodland.barrenCount).toBe(0);
    expect(simulation.woodland.stumpCount).toBe(1);
  });
});

describe('the woodland growing back', () => {
  it('puts a tree back on a stump when its time comes', () => {
    // Driven through the simulation's own daily pass, so the clock, the ledger
    // and the planting all have to agree.
    const simulation = new Simulation(OPTIONS);
    const cell = firstTree(simulation);
    fellNow(simulation, cell, false);
    expect(simulation.world.trees.has(cell)).toBe(false);

    runDays(simulation, REGROWTH_DAYS + 2);
    expect(simulation.world.trees.has(cell)).toBe(true);
  });

  it('leaves cleared ground bare for as long as anybody watches', () => {
    const simulation = new Simulation(OPTIONS);
    const cell = firstTree(simulation);
    fellNow(simulation, cell, true);

    runDays(simulation, REGROWTH_DAYS + 2);
    expect(simulation.world.trees.has(cell)).toBe(false);
    expect(simulation.woodland.isBarren(cell)).toBe(true);
  });
});

describe('a woodcutter with an axe of its own', () => {
  it('marks trees near it without being asked', () => {
    // The whole point: splitting logs into firewood is useless without logs, and
    // the only way to get them was to mark trees by hand, every winter, for ever.
    const simulation = new Simulation(OPTIONS);
    const shop = raise(simulation, 'woodcutter');
    expect(shop).not.toBeNull();
    simulation.storages.all[0]!.inventory.clear();
    simulation.storages.markChanged();

    runDays(simulation, 2);

    const felling = simulation.jobs.all.filter((job) => job.type === 'chop-tree');
    expect(felling.length).toBeGreaterThan(0);
    // And nothing it ordered is the player's, so the wood grows back.
    expect(felling.every((job) => job.playerOrdered !== true)).toBe(true);
  });

  it('stops once the yard has logs enough', () => {
    // A workshop with a full yard has no business emptying the wood. This is
    // what stops an automatic woodcutter stripping the map.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'woodcutter');
    const target = buildingDefinition('woodcutter').felling!.logTarget;
    simulation.storages.all[0]!.inventory.add('logs', target * 2);
    simulation.storages.markChanged();

    runDays(simulation, 2);

    expect(simulation.jobs.all.filter((job) => job.type === 'chop-tree')).toHaveLength(0);
  });

  it('never keeps more orders standing than it can work through', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'woodcutter');
    simulation.storages.all[0]!.inventory.clear();
    simulation.storages.markChanged();

    const cap = buildingDefinition('woodcutter').felling!.outstanding;
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
  it('carries its stumps and its clearings through a save', () => {
    const simulation = new Simulation(OPTIONS);
    const cropped = firstTree(simulation);
    fellNow(simulation, cropped, false);
    const cleared = firstTree(simulation);
    fellNow(simulation, cleared, true);

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, 'now'));

    expect(loaded.woodland.stumpCount).toBe(simulation.woodland.stumpCount);
    expect(loaded.woodland.isBarren(cleared)).toBe(true);
    expect(loaded.woodland.isBarren(cropped)).toBe(false);
  });

  it('reads an older save as a settlement that never cleared anything', () => {
    const simulation = new Simulation(OPTIONS);
    const save = serialise(simulation, 'now');
    const { woodland: _dropped, ...older } = save;

    const loaded = new Simulation(OPTIONS);
    restore(loaded, older as typeof save);
    expect(loaded.woodland.barrenCount).toBe(0);
    expect(loaded.woodland.stumpCount).toBe(0);
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

function firstTree(simulation: Simulation): { gx: number; gy: number } {
  for (const tree of simulation.world.trees.all) {
    return { gx: tree.gx, gy: tree.gy };
  }
  throw new Error('A generated world with no trees at all');
}

function nearestTreeWithin(
  simulation: Simulation,
  centre: { gx: number; gy: number },
  radius: number,
): { gx: number; gy: number } | null {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const cell = { gx: centre.gx + dx, gy: centre.gy + dy };
      if (simulation.world.trees.getAt(cell)) {
        return cell;
      }
    }
  }
  return null;
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
