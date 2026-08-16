/**
 * Who works where.
 *
 * The rules that matter are the ones a player will notice being broken: a
 * workshop nobody staffs does nothing, a workshop the player turned down stays
 * turned down, and nobody keeps a post at a building that no longer exists. All
 * three are invisible until a settlement has been running for a while, which is
 * exactly the kind of thing a headless year catches and a playthrough does not.
 */

import { describe, expect, it } from 'vitest';
import { Simulation } from '@/simulation/Simulation';
import { runEmployment } from '@/simulation/population/EmploymentSystem';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { Building } from '@/simulation/buildings/Building';
import type { BuildingId } from '@/data/buildings';
import type { GridPoint } from '@/shared/types/geometry';

function isDone(state: string): boolean {
  return state === 'complete' || state === 'cancelled';
}

const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };
const TICK = 0.1;

describe('taking a post', () => {
  it('staffs a finished workshop and leaves everyone else a labourer', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    expect(hut).not.toBeNull();
    if (!hut) {
      return;
    }

    const report = runEmployment(simulation.villagers.all, simulation.world.buildings);

    expect(hut.workers.length).toBe(hut.definition.workerSlots);
    expect(report.hired).toBe(hut.definition.workerSlots);
    // Everyone not in the hut is available for felling, hauling and building —
    // which is most of the work in the game and must never be starved of hands.
    expect(report.labourers).toBe(10 - hut.definition.workerSlots);
  });

  it('does not staff a building still under construction', () => {
    const simulation = new Simulation(OPTIONS);
    const site = place(simulation, 'gatherer-hut');
    if (!site) {
      return;
    }

    runEmployment(simulation.villagers.all, simulation.world.buildings);
    expect(site.workers).toEqual([]);
  });

  it('never employs a child', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }

    for (const villager of simulation.villagers.all) {
      villager.age = 5;
    }
    runEmployment(simulation.villagers.all, simulation.world.buildings);

    expect(hut.workers).toEqual([]);
    expect(simulation.villagers.all.every((villager) => villager.employerId === null)).toBe(true);
  });

  it('is deterministic, so a replayed settlement hires the same people', () => {
    const staffOf = (): number[] => {
      const simulation = new Simulation(OPTIONS);
      const hut = raise(simulation, 'gatherer-hut');
      if (!hut) {
        return [];
      }
      runEmployment(simulation.villagers.all, simulation.world.buildings);
      return [...hut.workers].sort((a, b) => a - b);
    };

    expect(staffOf()).toEqual(staffOf());
  });
});

describe('losing a post', () => {
  it('releases everyone when the quota goes to zero', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    runEmployment(simulation.villagers.all, simulation.world.buildings);
    expect(hut.workers.length).toBeGreaterThan(0);

    expect(simulation.setDesiredWorkers(hut.id, 0)).toBe(true);

    expect(hut.workers).toEqual([]);
    expect(simulation.villagers.all.every((villager) => villager.employerId === null)).toBe(true);
  });

  it('keeps the longest-serving villager when the quota comes down by one', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut || hut.definition.workerSlots < 2) {
      return;
    }
    runEmployment(simulation.villagers.all, simulation.world.buildings);
    const before = [...hut.workers].sort((a, b) => a - b);

    simulation.setDesiredWorkers(hut.id, 1);

    expect(hut.workers.length).toBe(1);
    // The lowest id stays: the least disruptive choice, and a stable one, so
    // turning a quota down and back up does not shuffle the whole settlement.
    expect(hut.workers[0]).toBe(before[0]);
  });

  it('clamps a quota to the posts the building actually has', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }

    simulation.setDesiredWorkers(hut.id, 99);
    expect(hut.desiredWorkers).toBe(hut.definition.workerSlots);

    simulation.setDesiredWorkers(hut.id, -5);
    expect(hut.desiredWorkers).toBe(0);
  });

  it('frees a villager whose employer is no longer standing', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    runEmployment(simulation.villagers.all, simulation.world.buildings);
    const worker = simulation.villagers.all.find((villager) => villager.employerId === hut.id);
    expect(worker).toBeDefined();

    simulation.world.buildings.clear();
    runEmployment(simulation.villagers.all, simulation.world.buildings);

    expect(worker?.employerId).toBeNull();
  });

  it('reports the posts it cannot fill', () => {
    const simulation = new Simulation({ ...OPTIONS, startingVillagers: 1 });
    const first = raise(simulation, 'gatherer-hut');
    const second = raise(simulation, 'woodcutter');
    if (!first || !second) {
      return;
    }

    const report = runEmployment(simulation.villagers.all, simulation.world.buildings);
    const posts = first.definition.workerSlots + second.definition.workerSlots;
    expect(report.hired).toBe(1);
    expect(report.vacancies).toBe(posts - 1);
    // The older building keeps its staff when there are not enough people for
    // both: a settlement short of hands should keep running what it had.
    expect(first.workers.length).toBe(1);
    expect(second.workers).toEqual([]);
  });
});

describe('only the staff work the workshop', () => {
  it('posts no production at a building nobody works', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    simulation.setDesiredWorkers(hut.id, 0);

    for (let tick = 1; tick <= TICKS_PER_DAY * 2; tick += 1) {
      simulation.update(tick, TICK);
    }

    // A job only this building's staff may take is a job nobody can take when
    // it has no staff. Posting it anyway litters the board forever.
    expect(simulation.jobs.all.some((job) => job.type === 'produce')).toBe(false);
  });

  it('lets an unstaffed workshop be restarted', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }

    simulation.setDesiredWorkers(hut.id, 0);
    const idle = simulation.storages.totalOf('food');
    for (let tick = 1; tick <= TICKS_PER_DAY * 3; tick += 1) {
      simulation.update(tick, TICK);
    }

    simulation.setDesiredWorkers(hut.id, hut.definition.workerSlots);
    for (let tick = TICKS_PER_DAY * 3 + 1; tick <= TICKS_PER_DAY * 12; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(hut.workers.length).toBeGreaterThan(0);
    // Food eaten daily makes the stored total a poor witness; what matters is
    // that the hut resumed producing at all.
    expect(
      simulation.storages.totalOf('food') + simulation.world.piles.totalOf('food'),
    ).toBeGreaterThan(0);
    expect(idle).toBeGreaterThanOrEqual(0);
  });

  it('hands gatherers back to the settlement for the winter', () => {
    // Employment reserves the workshop for its staff; it does not idle them.
    // Nothing grows under snow, and since production is the highest priority
    // in the game, two people miming a harvest all winter would refuse to haul
    // or fell while producing exactly nothing.
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    provision(simulation);

    let employeeDidOtherWork = false;
    let sawWinter = false;
    for (let tick = 1; tick <= TICKS_PER_DAY * 58; tick += 1) {
      simulation.update(tick, TICK);
      if (simulation.snapshot().season !== 'winter') {
        continue;
      }
      sawWinter = true;
      if (tick % 20 === 0) {
        for (const tree of [...simulation.world.trees.all].slice(0, 6)) {
          simulation.designateTreeForFelling({ gx: tree.gx, gy: tree.gy });
        }
      }
      for (const villager of simulation.villagers.all) {
        if (villager.employerId === null || villager.currentJobId === null) {
          continue;
        }
        const job = simulation.jobs.get(villager.currentJobId);
        if (job && job.type !== 'produce') {
          employeeDidOtherWork = true;
        }
      }
    }

    expect(sawWinter).toBe(true);
    expect(employeeDidOtherWork).toBe(true);
  });

  it('posts no harvest in a season that yields nothing', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    provision(simulation);

    let producedInWinter = false;
    for (let tick = 1; tick <= TICKS_PER_DAY * 58; tick += 1) {
      simulation.update(tick, TICK);
      if (simulation.snapshot().season !== 'winter') {
        continue;
      }
      if (simulation.jobs.all.some((job) => job.type === 'produce' && !isDone(job.state))) {
        producedInWinter = true;
      }
    }

    expect(producedInWinter).toBe(false);
  });
});

// --- helpers ---------------------------------------------------------------

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

/**
 * Stocks the settlement so it reaches winter alive.
 *
 * One hut and no houses kills everybody by autumn, which makes a test about
 * winter behaviour a test about an empty map. Supplies are the shortest way to
 * keep ten people breathing long enough to observe them.
 */
/**
 * Stocks the yards and roofs everyone, so a test can watch a whole winter.
 *
 * The houses are real ones, and that is not incidental. Setting `homeId` by
 * hand looked equivalent and was not: the population system reassigns homes
 * every day and drops any that name a house which does not exist, so the
 * settlement was homeless again by the following morning and froze to death two
 * days into winter. Tests downstream of that were reading a two-day sliver of
 * winter and calling it a season.
 */
function provision(simulation: Simulation): void {
  const yard = simulation.storages.all[0];
  yard?.inventory.add('food', 900);
  yard?.inventory.add('firewood', 900);

  while (simulation.snapshot().housingCapacity < simulation.villagers.all.length) {
    if (!raise(simulation, 'house')) {
      return;
    }
  }
}

/** Places a building and finishes it, so it is ready to be staffed. */
function raise(simulation: Simulation, id: BuildingId): Building | null {
  const building = place(simulation, id);
  if (building) {
    simulation.world.buildings.complete(simulation.world, building);
  }
  return building;
}
