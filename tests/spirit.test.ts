/**
 * The fourth need, and the two buildings that answer it.
 *
 * Spirit is the only need in the game that **cannot kill anybody**, and the
 * whole design rests on that. Fifty is neutral and is worth exactly nothing;
 * above it the settlement works faster, below it nothing at all happens. A
 * settlement that never builds a Cemetery or a Temple therefore plays exactly
 * the game it played before either existed — which is the property tested
 * hardest here, because getting it wrong would quietly add a fourth way for a
 * first winter to end on a game whose opening already kills seven seeds in
 * eight.
 */

import { describe, expect, it } from 'vitest';

import type { BuildingId } from '@/data/buildings';
import { buildingDefinition } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';
import { Simulation } from '@/simulation/Simulation';
import { restore, serialise } from '@/simulation/save/serialise';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import {
  SPIRIT_LOST_PER_DEATH,
  SPIRIT_NEUTRAL,
  SPIRIT_WORK_BONUS,
  spiritWorkBonus,
} from '@/simulation/seasons/SurvivalSystem';

const TICK = 0.1;
const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };
const SAVED_AT = '2026-08-17T00:00:00.000Z';

describe('spirit is a bonus, never a penalty', () => {
  it('is worth nothing at neutral', () => {
    expect(spiritWorkBonus(SPIRIT_NEUTRAL)).toBe(1);
  });

  it('is worth nothing below neutral either', () => {
    // The load-bearing assertion of the whole feature. A miserable settlement
    // must work at exactly the speed the game has always run at.
    expect(spiritWorkBonus(0)).toBe(1);
    expect(spiritWorkBonus(SPIRIT_NEUTRAL - 1)).toBe(1);
  });

  it('pays its full bonus at the top', () => {
    expect(spiritWorkBonus(100)).toBeCloseTo(1 + SPIRIT_WORK_BONUS);
  });

  it('pays proportionally in between', () => {
    expect(spiritWorkBonus(75)).toBeCloseTo(1 + SPIRIT_WORK_BONUS / 2);
  });

  it('starts every settlement at neutral', () => {
    const simulation = new Simulation(OPTIONS);
    for (const villager of simulation.villagers.all) {
      expect(villager.needs.spirit).toBe(SPIRIT_NEUTRAL);
    }
  });

  it('leaves a settlement with neither building at neutral, for ever', () => {
    // Nothing drifts. A settlement that builds nothing should be able to run a
    // full year and still be playing the game it started.
    const simulation = new Simulation(OPTIONS);
    feed(simulation);
    run(simulation, TICKS_PER_DAY * 30, true);

    expect(simulation.solace).toBe(0);
    expect(simulation.snapshot().lastDay.spirit).toBe(SPIRIT_NEUTRAL);
  });
});

describe('what the buildings are worth', () => {
  it('counts nothing while neither stands', () => {
    expect(new Simulation(OPTIONS).solace).toBe(0);
  });

  it('counts a cemetery on its own', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'cemetery');
    expect(simulation.solace).toBeCloseTo(buildingDefinition('cemetery').solace!.share);
  });

  it('counts nothing for a temple nobody keeps', () => {
    // The temple is the one that needs a person in it. An empty one is a
    // building the settlement paid for and is not using.
    const simulation = new Simulation(OPTIONS);
    const temple = raise(simulation, 'temple');
    temple!.desiredWorkers = 0;

    expect(temple!.workers).toHaveLength(0);
    expect(simulation.solace).toBe(0);
  });

  it('counts the temple once somebody keeps it', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'temple');
    feed(simulation);
    run(simulation, TICKS_PER_DAY * 2, true);

    expect(simulation.solace).toBeCloseTo(buildingDefinition('temple').solace!.share);
  });

  it('reaches the top with both, and never goes past it', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'cemetery');
    raise(simulation, 'cemetery');
    raise(simulation, 'temple');
    feed(simulation);
    run(simulation, TICKS_PER_DAY * 2, true);

    expect(simulation.solace).toBe(1);
  });

  it('counts nothing for a cemetery still being built', () => {
    const simulation = new Simulation(OPTIONS);
    place(simulation, 'cemetery');
    expect(simulation.solace).toBe(0);
  });
});

describe('how spirit moves', () => {
  it('climbs above neutral once there is somewhere to bury the dead', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'cemetery');
    feed(simulation);
    run(simulation, TICKS_PER_DAY * 20, true);

    expect(simulation.snapshot().lastDay.spirit).toBeGreaterThan(SPIRIT_NEUTRAL);
  });

  it('climbs higher with both than with one', () => {
    const one = new Simulation(OPTIONS);
    raise(one, 'cemetery');
    feed(one);
    run(one, TICKS_PER_DAY * 30, true);

    const both = new Simulation(OPTIONS);
    raise(both, 'cemetery');
    raise(both, 'temple');
    feed(both);
    run(both, TICKS_PER_DAY * 30, true);

    expect(both.solace).toBeGreaterThan(one.solace);
    expect(both.snapshot().lastDay.spirit).toBeGreaterThan(one.snapshot().lastDay.spirit);
  });

  it('climbs slowly rather than jumping the day the roof goes on', () => {
    // It is the one need that is about how long people have lived somewhere.
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'cemetery');
    raise(simulation, 'temple');
    feed(simulation);
    run(simulation, TICKS_PER_DAY * 2, true);

    const early = simulation.snapshot().lastDay.spirit;
    expect(early).toBeLessThan(100);

    run(simulation, TICKS_PER_DAY * 30, true);
    expect(simulation.snapshot().lastDay.spirit).toBeGreaterThan(early);
  });

  it('falls when the settlement buries somebody', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'cemetery');
    raise(simulation, 'temple');
    feed(simulation);
    run(simulation, TICKS_PER_DAY * 30, true);
    const before = simulation.snapshot().lastDay.spirit;

    // Starve them for a day, which is the only thing that pushes spirit down.
    for (const storage of simulation.storages.all) {
      storage.inventory.clear();
    }
    simulation.storages.markChanged();
    for (const villager of simulation.villagers.all) {
      villager.needs.hunger = 0;
      villager.needs.health = 5;
    }
    run(simulation, TICKS_PER_DAY + 1);

    expect(simulation.snapshot().lastDay.deaths).toBeGreaterThan(0);
    expect(simulation.snapshot().lastDay.spirit).toBeLessThan(before - SPIRIT_LOST_PER_DEATH);
  });

  it('never falls below zero however many are buried', () => {
    const simulation = new Simulation(OPTIONS);
    for (const villager of simulation.villagers.all) {
      villager.needs.spirit = 2;
    }
    for (const storage of simulation.storages.all) {
      storage.inventory.clear();
    }
    simulation.storages.markChanged();
    for (const villager of simulation.villagers.all) {
      villager.needs.hunger = 0;
      villager.needs.health = 5;
    }
    run(simulation, TICKS_PER_DAY + 1);

    for (const villager of simulation.villagers.all) {
      expect(villager.needs.spirit).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('across a save', () => {
  it('carries spirit through', () => {
    const simulation = new Simulation(OPTIONS);
    raise(simulation, 'cemetery');
    raise(simulation, 'temple');
    feed(simulation);
    run(simulation, TICKS_PER_DAY * 20, true);
    expect(simulation.snapshot().lastDay.spirit).toBeGreaterThan(SPIRIT_NEUTRAL);

    const loaded = new Simulation(OPTIONS);
    restore(loaded, serialise(simulation, SAVED_AT));

    expect(loaded.villagers.all.map((v) => v.needs.spirit)).toEqual(
      simulation.villagers.all.map((v) => v.needs.spirit),
    );
  });

  it('restores a save from before spirit existed at neutral', () => {
    // The honest reading of such a save: that settlement had neither building,
    // and neutral is exactly what having neither is worth.
    const simulation = new Simulation(OPTIONS);
    run(simulation, TICKS_PER_DAY);
    const save = serialise(simulation, SAVED_AT);
    const older = {
      ...save,
      villagers: save.villagers.map(({ spirit: _spirit, ...rest }) => rest),
    };

    const loaded = new Simulation(OPTIONS);
    restore(loaded, older);

    for (const villager of loaded.villagers.all) {
      expect(villager.needs.spirit).toBe(SPIRIT_NEUTRAL);
    }
  });
});

function run(simulation: Simulation, ticks: number, keepFed = false): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    if (keepFed && simulation.tick % TICKS_PER_DAY === 0) {
      feed(simulation);
    }
    simulation.update(simulation.tick + 1, TICK);
  }
}

/** Tops the larder up to a level, so nothing starves mid-measurement. */
function feed(simulation: Simulation): void {
  const yard = simulation.storages.all[0];
  if (!yard) {
    return;
  }
  const short = 200 - yard.inventory.count('vegetables');
  if (short > 0) {
    yard.inventory.add('vegetables', short);
    simulation.storages.markChanged();
  }
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
