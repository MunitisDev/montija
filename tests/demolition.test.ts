/**
 * Pulling a building down.
 *
 * Nothing could be un-built until now, which mattered more the moment quarries
 * and mines arrived: a permanent building in the wrong place was a permanent
 * mistake, and a settlement's first hour is exactly when a player makes those.
 *
 * Five things hold a reference to a building — its plot in the navigation grid,
 * its staff, its yard, the jobs aimed at it and anyone walking to one — and a
 * demolition that misses any of them leaves a ghost the player cannot see and
 * cannot fix. Each of those has a test here for that reason.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/simulation/Simulation';
import { runEmployment } from '@/simulation/population/EmploymentSystem';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { Building } from '@/simulation/buildings/Building';
import type { BuildingId } from '@/data/buildings';
import type { GridPoint } from '@/shared/types/geometry';

const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };
const TICK = 0.1;

describe('cancelling a site', () => {
  it('takes it off the map at once', () => {
    // Nothing is standing to pull down, and a player who misplaced a ghost
    // wants it gone rather than scheduled.
    const simulation = new Simulation(OPTIONS);
    const site = place(simulation, 'house');
    expect(site).not.toBeNull();
    if (!site) {
      return;
    }

    expect(simulation.toggleDemolition(site.id)).toBe(true);
    expect(simulation.world.buildings.getById(site.id)).toBeNull();
  });

  it('hands back the materials that were delivered to it', () => {
    const simulation = new Simulation(OPTIONS);
    const site = place(simulation, 'house');
    if (!site) {
      return;
    }
    site.materials.add('logs', 5);

    simulation.toggleDemolition(site.id);

    // On the plot, not credited to a yard: those logs physically arrived on
    // somebody's back, and the rule that resources exist in the world does not
    // get suspended because the player changed their mind.
    expect(simulation.world.piles.totalOf('logs')).toBeGreaterThanOrEqual(5);
  });

  it('withdraws the work that was queued for it', () => {
    const simulation = new Simulation(OPTIONS);
    const site = place(simulation, 'house');
    if (!site) {
      return;
    }
    for (let tick = 1; tick <= 60; tick += 1) {
      simulation.update(tick, TICK);
    }

    simulation.toggleDemolition(site.id);

    const live = simulation.jobs.all.filter(
      (job) => job.state !== 'complete' && job.state !== 'cancelled',
    );
    // By type as well as by id: `targetEntityId` is a shared namespace, and a
    // pile of the settlers' own timber can quite legitimately be pile number 1
    // while the site is building number 1.
    const aimedAtBuildings = new Set(['build', 'produce', 'demolish', 'plant-tree']);
    expect(
      live.some((job) => job.targetEntityId === site.id && aimedAtBuildings.has(job.type)),
    ).toBe(false);
    expect(
      live.some(
        (job) =>
          job.deliverTo?.gx === site.accessCell.gx && job.deliverTo?.gy === site.accessCell.gy,
      ),
    ).toBe(false);
  });
});

describe('ordering a demolition', () => {
  it('posts work rather than removing the building on the spot', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }

    expect(simulation.toggleDemolition(hut.id)).toBe(true);
    expect(simulation.world.buildings.getById(hut.id)).not.toBeNull();
    expect(simulation.isDemolitionOrdered(hut.id)).toBe(true);
  });

  it('is its own undo', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }

    simulation.toggleDemolition(hut.id);
    expect(simulation.toggleDemolition(hut.id)).toBe(true);
    expect(simulation.isDemolitionOrdered(hut.id)).toBe(false);
    expect(simulation.world.buildings.getById(hut.id)).not.toBeNull();
  });

  it('never outranks feeding people', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    simulation.toggleDemolition(hut.id);

    const order = simulation.jobs.all.find((job) => job.type === 'demolish');
    const produce = simulation.jobs.all.find((job) => job.type === 'produce');
    expect(order).toBeDefined();
    if (order && produce) {
      expect(order.priority).toBeLessThan(produce.priority);
    }
  });
});

describe('once it is down', () => {
  it('gives the ground back', () => {
    // The part that is easy to forget: a demolished building whose cells stay
    // blocked leaves a hole nothing can walk through and nothing can explain.
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    const cells = hut.cells();
    expect(cells.every((cell) => !simulation.world.isWalkable(cell))).toBe(true);

    tearDown(simulation, hut);

    expect(cells.every((cell) => simulation.world.isWalkable(cell))).toBe(true);
  });

  it('leaves salvage on the plot', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    // The settlers' own bundles are on the ground at the start and get carried in
    // while this runs, which would swamp the figure. Taken away so what lands on
    // the plot can only be salvage.
    clearBundles(simulation);
    const before = simulation.world.piles.totalOf('logs');

    tearDown(simulation, hut);

    // Half of what it cost, so moving a misplaced building is a real option
    // and shuffling the settlement around is never free.
    const cost = hut.definition.constructionCost.find((entry) => entry.resource === 'logs');
    expect(simulation.world.piles.totalOf('logs') - before).toBe(
      Math.floor((cost?.amount ?? 0) / 2),
    );
  });

  it('releases its staff back to the settlement', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    runEmployment(simulation.villagers.all, simulation.world.buildings);
    expect(hut.workers.length).toBeGreaterThan(0);

    tearDown(simulation, hut);

    expect(simulation.villagers.all.some((villager) => villager.employerId === hut.id)).toBe(false);
  });

  it('turns its residents out', () => {
    const simulation = new Simulation(OPTIONS);
    const house = raise(simulation, 'house');
    if (!house) {
      return;
    }
    const resident = simulation.villagers.all[0];
    if (resident) {
      resident.homeId = house.id;
    }

    tearDown(simulation, house);

    // Homelessness is survivable and being homed at a house that no longer
    // exists is not: that villager would be warmed by a hearth in a field.
    expect(resident?.homeId).toBeNull();
  });

  it('tips a yard onto the plot rather than deleting what it held', () => {
    const simulation = new Simulation(OPTIONS);
    const yard = raise(simulation, 'storage-yard');
    if (!yard) {
      return;
    }
    for (let tick = 1; tick <= 40; tick += 1) {
      simulation.update(tick, TICK);
    }
    const storage = yard.storageId === null ? null : simulation.storages.getById(yard.storageId);
    expect(storage).not.toBeNull();
    clearBundles(simulation);
    storage?.inventory.add('stone', 17);
    const loose = simulation.world.piles.totalOf('stone');

    tearDown(simulation, yard);

    // Somebody carried every one of those in. They do not evaporate.
    expect(simulation.world.piles.totalOf('stone')).toBeGreaterThanOrEqual(loose + 17);
    expect(yard.storageId === null ? null : simulation.storages.getById(yard.storageId)).toBeNull();
  });

  it('is actually torn down by a villager, in play', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }

    simulation.toggleDemolition(hut.id);
    for (let tick = 1; tick <= TICKS_PER_DAY * 12; tick += 1) {
      simulation.update(tick, TICK);
      if (simulation.world.buildings.getById(hut.id) === null) {
        break;
      }
    }

    expect(simulation.world.buildings.getById(hut.id)).toBeNull();
  });
});

// --- helpers ---------------------------------------------------------------

/** Takes the settlers' bundles off the ground, so pile counts mean one thing. */
function clearBundles(simulation: Simulation): void {
  for (const pile of [...simulation.world.piles.all]) {
    simulation.world.piles.remove(pile.id);
  }
}

function place(simulation: Simulation, id: BuildingId): Building | null {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      const cell: GridPoint = { gx, gy };
      if (simulation.canPlaceBuilding(id, cell).ok) {
        return simulation.placeBuilding(id, cell);
      }
    }
  }
  return null;
}

function raise(simulation: Simulation, id: BuildingId): Building | null {
  const building = place(simulation, id);
  if (building) {
    simulation.world.buildings.complete(simulation.world, building);
  }
  return building;
}

/** Orders a demolition and runs until somebody has carried it out. */
function tearDown(simulation: Simulation, building: Building): void {
  simulation.toggleDemolition(building.id);
  for (let tick = 1; tick <= TICKS_PER_DAY * 12; tick += 1) {
    simulation.update(tick, TICK);
    if (simulation.world.buildings.getById(building.id) === null) {
      return;
    }
  }
}
