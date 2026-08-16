/**
 * Saying *who* works where, not just how many.
 *
 * Quotas already answered "how many people at this workshop". They could not
 * answer "this person, at that workshop" — and a player who wanted their
 * strongest hauler kept on hauling, or wanted somebody specific at the new
 * forge, had to turn quotas down across the settlement and hope the
 * nearest-first rule happened to pick the right body.
 *
 * The rules worth guarding are the ones that keep a posting an *instruction*
 * rather than an override: it never invents a post that a quota did not ask
 * for, it survives the building not being ready yet, and it does not quietly
 * stop meaning anything after a save or a demolition.
 */

import { describe, expect, it } from 'vitest';

import { Simulation } from '@/simulation/Simulation';
import { restore, serialise } from '@/simulation/save/serialise';
import { runEmployment } from '@/simulation/population/EmploymentSystem';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { BuildingId } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';

const TICK = 0.1;
const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

describe('posting somebody to a building', () => {
  it('puts that person there rather than whoever was nearest', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }

    // The one furthest away, so nearest-first would never have chosen them.
    const chosen = furthestFrom(simulation, hut);
    simulation.setWorkPreference(chosen.id, hut.id);
    runEmployment(simulation.villagers.all, simulation.world.buildings);

    expect(chosen.employerId).toBe(hut.id);
  });

  it('takes effect without waiting for them to be let go', () => {
    // A posting that only applied the next time somebody happened to be
    // released would look, to the player, like a control that does nothing.
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    const woodcutter = raise(simulation, 'woodcutter');
    if (!hut || !woodcutter) {
      return;
    }
    runEmployment(simulation.villagers.all, simulation.world.buildings);

    const atHut = simulation.villagers.all.find((villager) => villager.employerId === hut.id);
    expect(atHut).toBeDefined();
    if (!atHut) {
      return;
    }

    simulation.setWorkPreference(atHut.id, woodcutter.id);
    runEmployment(simulation.villagers.all, simulation.world.buildings);

    expect(atHut.employerId).toBe(woodcutter.id);
  });

  it('never staffs a building beyond the quota it was given', () => {
    // The safeguard. A posting says who, not how many — otherwise the player
    // could quietly overrun every balance rule the building definitions set.
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }

    for (const villager of simulation.villagers.all) {
      simulation.setWorkPreference(villager.id, hut.id);
    }
    runEmployment(simulation.villagers.all, simulation.world.buildings);

    expect(hut.workers.length).toBe(hut.hiringTarget);
  });

  it('keeps a posted villager ahead of one merely placed there', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    runEmployment(simulation.villagers.all, simulation.world.buildings);
    const chosen = furthestFrom(simulation, hut);
    simulation.setWorkPreference(chosen.id, hut.id);

    runEmployment(simulation.villagers.all, simulation.world.buildings);
    // Turn the quota down to one: the posted villager is the one who stays.
    hut.desiredWorkers = 1;
    runEmployment(simulation.villagers.all, simulation.world.buildings);

    expect(hut.workers).toEqual([chosen.id]);
  });

  it('waits for a building that is not finished yet', () => {
    // "When it opens" is a reasonable thing for a player to mean, and refusing
    // the instruction would make them come back and repeat it later.
    const simulation = new Simulation(OPTIONS);
    const site = place(simulation, 'woodcutter');
    if (!site) {
      return;
    }
    const chosen = simulation.villagers.all[0]!;

    expect(simulation.setWorkPreference(chosen.id, site.id)).toBe(true);
    runEmployment(simulation.villagers.all, simulation.world.buildings);
    expect(chosen.employerId).toBeNull();

    simulation.world.buildings.complete(simulation.world, site);
    runEmployment(simulation.villagers.all, simulation.world.buildings);

    expect(chosen.employerId).toBe(site.id);
  });

  it('refuses a building nobody could ever work at', () => {
    const simulation = new Simulation(OPTIONS);
    const yard = raise(simulation, 'storage-yard');
    if (!yard) {
      return;
    }
    expect(yard.definition.workerSlots).toBe(0);
    expect(simulation.setWorkPreference(simulation.villagers.all[0]!.id, yard.id)).toBe(false);
  });

  it('refuses a villager who does not exist', () => {
    const simulation = new Simulation(OPTIONS);
    expect(simulation.setWorkPreference(9999, 'labourer')).toBe(false);
  });
});

describe('keeping somebody a labourer', () => {
  it('leaves them out of the workshops', () => {
    // The state that could not be expressed before. An unemployed villager is
    // exactly who automatic hiring grabs next, so "leave this one carrying
    // things" needed to be a thing the player could actually say.
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    const chosen = nearestTo(simulation, hut);
    simulation.setWorkPreference(chosen.id, 'labourer');

    runEmployment(simulation.villagers.all, simulation.world.buildings);

    expect(chosen.employerId).toBeNull();
    // And the post is still filled — by somebody else.
    expect(hut.workers.length).toBeGreaterThan(0);
    expect(hut.workers).not.toContain(chosen.id);
  });

  it('gives up a post they already held', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    runEmployment(simulation.villagers.all, simulation.world.buildings);
    const employed = simulation.villagers.all.find((villager) => villager.employerId === hut.id)!;

    simulation.setWorkPreference(employed.id, 'labourer');
    runEmployment(simulation.villagers.all, simulation.world.buildings);

    expect(employed.employerId).toBeNull();
  });

  it('leaves a post unfilled rather than overruling the player', () => {
    // A settlement that quietly re-hired everybody the player set aside would
    // be a settlement whose controls are decoration.
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    for (const villager of simulation.villagers.all) {
      simulation.setWorkPreference(villager.id, 'labourer');
    }

    const report = runEmployment(simulation.villagers.all, simulation.world.buildings);

    expect(hut.workers).toEqual([]);
    expect(report.vacancies).toBe(hut.hiringTarget);
  });
});

describe('handing somebody back to the settlement', () => {
  it('lets automatic employment place them again', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    const chosen = nearestTo(simulation, hut);
    simulation.setWorkPreference(chosen.id, 'labourer');
    runEmployment(simulation.villagers.all, simulation.world.buildings);
    expect(chosen.employerId).toBeNull();

    simulation.setWorkPreference(chosen.id, null);
    hut.desiredWorkers = hut.definition.workerSlots;
    runEmployment(simulation.villagers.all, simulation.world.buildings);

    expect(simulation.villagers.all.filter((v) => v.employerId === hut.id).length).toBe(
      hut.hiringTarget,
    );
  });
});

describe('a posting over time', () => {
  it('is forgotten when the building is pulled down', () => {
    // Otherwise it would keep somebody out of every workshop for ever, waiting
    // for a door that is not coming back.
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    const chosen = simulation.villagers.all[0]!;
    simulation.setWorkPreference(chosen.id, hut.id);

    simulation.toggleDemolition(hut.id);
    for (let tick = 1; tick <= TICKS_PER_DAY * 12; tick += 1) {
      simulation.update(simulation.tick + 1, TICK);
      if (simulation.world.buildings.getById(hut.id) === null) {
        break;
      }
    }

    expect(simulation.world.buildings.getById(hut.id)).toBeNull();
    expect(chosen.workPreference).toBeNull();
  });

  it('survives a save and a load', () => {
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    simulation.setWorkPreference(simulation.villagers.all[0]!.id, hut.id);
    simulation.setWorkPreference(simulation.villagers.all[1]!.id, 'labourer');

    const restored = roundTrip(simulation);

    expect(restored.villagers.all[0]?.workPreference).toBe(hut.id);
    expect(restored.villagers.all[1]?.workPreference).toBe('labourer');
  });

  it('holds while the settlement runs', () => {
    // Employment reconciles every couple of seconds, so an instruction that
    // only survived one pass would look intermittent rather than broken.
    const simulation = new Simulation(OPTIONS);
    const hut = raise(simulation, 'gatherer-hut');
    if (!hut) {
      return;
    }
    const chosen = nearestTo(simulation, hut);
    simulation.setWorkPreference(chosen.id, 'labourer');

    for (let tick = 1; tick <= TICKS_PER_DAY * 5; tick += 1) {
      simulation.update(simulation.tick + 1, TICK);
      expect(chosen.employerId).toBeNull();
    }
  });
});

// --- helpers ---------------------------------------------------------------

function roundTrip(simulation: Simulation): Simulation {
  const restored = new Simulation(OPTIONS);
  restore(restored, JSON.parse(JSON.stringify(serialise(simulation, 'now'))));
  return restored;
}

function nearestTo(simulation: Simulation, building: Building) {
  return [...simulation.villagers.all].sort(
    (a, b) =>
      Math.hypot(a.position.wx - building.accessCell.gx, a.position.wy - building.accessCell.gy) -
      Math.hypot(b.position.wx - building.accessCell.gx, b.position.wy - building.accessCell.gy),
  )[0]!;
}

function furthestFrom(simulation: Simulation, building: Building) {
  return [...simulation.villagers.all].sort(
    (a, b) =>
      Math.hypot(b.position.wx - building.accessCell.gx, b.position.wy - building.accessCell.gy) -
      Math.hypot(a.position.wx - building.accessCell.gx, a.position.wy - building.accessCell.gy),
  )[0]!;
}

function place(simulation: Simulation, id: BuildingId): Building | null {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      const cell = { gx, gy };
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
