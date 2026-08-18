/**
 * Falling ill, and getting better.
 *
 * Health existed before this and had exactly one cause: it fell when somebody
 * was starving or freezing. That made it a second readout of hunger and warmth
 * rather than a thing of its own, and it meant a settlement with full stores
 * could never be in any trouble at all, however large or badly housed.
 *
 * The claims worth guarding are the ones that keep illness *third*: that it
 * arrives on its own schedule rather than as a consequence of hunger, that it
 * costs the settlement hands rather than health, and that a healer is a real
 * answer to it rather than decoration.
 */

import { describe, expect, it } from 'vitest';

import { SeededRandom } from '@/shared/math/random';
import { Simulation } from '@/simulation/Simulation';
import {
  BASE_ILLNESS_CHANCE,
  CARE_RECOVERY_SHARE,
  EXPOSURE_MULTIPLIER,
  ILLNESS_DAYS,
  chanceFor,
  runIllness,
} from '@/simulation/population/IllnessSystem';
import { Villager } from '@/simulation/villagers/Villager';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { BuildingId } from '@/data/buildings';
import type { Building } from '@/simulation/buildings/Building';
import { designateNearbyTrees } from './support/playtest';

const TICK = 0.1;
const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

function person(options: { id?: number; homeId?: number | null } = {}): Villager {
  const villager = new Villager({
    id: options.id ?? 1,
    name: 'Test',
    sex: 'f',
    age: 30,
    position: { wx: 0, wy: 0 },
    lifespan: 70,
  });
  villager.homeId = options.homeId === undefined ? 1 : options.homeId;
  return villager;
}

describe('who falls ill', () => {
  it('is far more likely for somebody sleeping rough', () => {
    // The one thing that changes the odds, and the one thing the player can do
    // something about before anybody is unwell.
    expect(chanceFor(person({ homeId: null }))).toBeCloseTo(
      chanceFor(person({ homeId: 1 })) * EXPOSURE_MULTIPLIER,
    );
  });

  it('does not depend on how hungry or cold they are', () => {
    // Deliberate, and it took three measurements to arrive at. Every version
    // that keyed off hunger made illness a *multiplier* on starvation, so a
    // struggling settlement died in autumn of sickness rather than in winter of
    // hunger — and winter is the failure this whole game is about.
    const comfortable = person();
    const wretched = person();
    wretched.needs.hunger = 0;
    wretched.needs.warmth = 0;

    expect(chanceFor(wretched)).toBe(chanceFor(comfortable));
  });

  it('is rare enough not to be a treadmill', () => {
    // A settlement of twenty under a roof should see a handful of cases a year,
    // not a rolling infirmary. Sixty days is a year in this game.
    const villagers = Array.from({ length: 20 }, (_, i) => person({ id: i + 1 }));
    const random = new SeededRandom(99);
    let cases = 0;
    for (let day = 0; day < 60; day += 1) {
      cases += runIllness(villagers, random, 0).fellIll;
    }

    expect(cases).toBeGreaterThan(0);
    expect(cases).toBeLessThan(8);
  });
});

describe('a case, once caught', () => {
  it('runs its course and ends', () => {
    const villagers = [person()];
    villagers[0]!.illDaysRemaining = ILLNESS_DAYS;
    const random = new SeededRandom(1);

    let days = 0;
    while (villagers[0]!.isIll && days < 50) {
      runIllness(villagers, random, 0);
      days += 1;
    }

    expect(days).toBe(ILLNESS_DAYS);
  });

  it('is shortened by care rather than cured by it', () => {
    // A healer is somebody who gets you through an illness, not a switch that
    // turns it off — so treatment shows up as a shorter case, and a settlement
    // still loses the work.
    const treated = [person()];
    treated[0]!.illDaysRemaining = ILLNESS_DAYS;
    const random = new SeededRandom(1);

    let days = 0;
    while (treated[0]!.isIll && days < 50) {
      runIllness(treated, random, 1);
      days += 1;
    }

    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThan(ILLNESS_DAYS);
    expect(CARE_RECOVERY_SHARE).toBeGreaterThan(0);
  });

  it('takes no health at all', () => {
    // The central design decision. Illness costs the settlement hands; hunger
    // and cold are what kill.
    const villagers = [person()];
    villagers[0]!.illDaysRemaining = ILLNESS_DAYS;
    const before = villagers[0]!.needs.health;

    runIllness(villagers, new SeededRandom(1), 0);

    expect(villagers[0]!.needs.health).toBe(before);
  });

  it('does not spread', () => {
    // Nothing is contagious, on purpose: an outbreak that compounds is a curve
    // to be studied, and the answer would still be "build a healer".
    const villagers = Array.from({ length: 12 }, (_, i) => person({ id: i + 1 }));
    villagers[0]!.illDaysRemaining = ILLNESS_DAYS;
    const random = new SeededRandom(4);

    for (let day = 0; day < ILLNESS_DAYS; day += 1) {
      runIllness(villagers, random, 0);
    }

    // Somebody else may still catch something on their own account; what must
    // not happen is the whole household going down together.
    expect(villagers.filter((villager) => villager.isIll).length).toBeLessThan(4);
  });
});

describe('an ill villager, in play', () => {
  it('stops working and hands their job back', () => {
    // The whole cost of illness, and the part that must not be got wrong: a
    // reserved job held by somebody who will not move for eight days is a job
    // nobody else can take.
    const simulation = new Simulation(OPTIONS);
    designateNearbyTrees(simulation, 20);
    for (let tick = 1; tick <= TICKS_PER_DAY * 2; tick += 1) {
      simulation.update(tick, TICK);
    }

    const worker = simulation.villagers.all.find((villager) => villager.currentJobId !== null);
    expect(worker).toBeDefined();
    if (!worker) {
      return;
    }
    const jobId = worker.currentJobId!;
    worker.illDaysRemaining = ILLNESS_DAYS;

    simulation.update(simulation.tick + 1, TICK);

    expect(worker.currentJobId).toBeNull();
    expect(worker.activity).toBe('ill');
    expect(worker.path).toEqual([]);
    // Handed back, not destroyed: somebody else can pick the work up today.
    expect(simulation.jobs.get(jobId)?.assignedVillager ?? null).toBeNull();
  });

  it('stays put', () => {
    const simulation = new Simulation(OPTIONS);
    for (let tick = 1; tick <= TICKS_PER_DAY; tick += 1) {
      simulation.update(tick, TICK);
    }
    const villager = simulation.villagers.all[0]!;
    villager.illDaysRemaining = ILLNESS_DAYS;
    simulation.update(simulation.tick + 1, TICK);
    const where = villager.position;

    for (let tick = 1; tick <= 40; tick += 1) {
      simulation.update(simulation.tick + 1, TICK);
    }

    expect(villager.position).toEqual(where);
  });

  it('goes back to work once they are well', () => {
    const simulation = new Simulation(OPTIONS);
    const villager = simulation.villagers.all[0]!;
    villager.illDaysRemaining = 1;

    for (let tick = 1; tick <= TICKS_PER_DAY * 3; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(villager.isIll).toBe(false);
    expect(villager.activity).not.toBe('ill');
  });
});

describe("a healer's house", () => {
  it('treats nobody without herbs, however well staffed', () => {
    // Half the building is the supply chain. A healer with an empty shelf is a
    // building the player paid for and gets nothing from, which is the point:
    // the herbalist is not optional decoration next to it.
    const simulation = new Simulation(OPTIONS);
    const healer = raise(simulation, 'healer');
    expect(healer).not.toBeNull();
    if (!healer) {
      return;
    }
    for (const storage of simulation.storages.all) {
      storage.inventory.remove('herbs', 10_000);
    }
    const patient = simulation.villagers.all[0]!;
    patient.illDaysRemaining = ILLNESS_DAYS;

    runDays(simulation, 1);

    expect(simulation.snapshot().illness.careFraction).toBe(0);
  });

  it('shortens a case when it is staffed and stocked', () => {
    const simulation = new Simulation(OPTIONS);
    const healer = raise(simulation, 'healer');
    if (!healer) {
      return;
    }
    simulation.storages.all[0]?.inventory.add('herbs', 500);
    const patient = simulation.villagers.all[0]!;
    patient.illDaysRemaining = ILLNESS_DAYS;

    runDays(simulation, 1);

    // A day of care removes more than a day of illness. **Care is what is tested
    // here, not the herbs**: one patient owes half a bundle a day, the shelf
    // holds whole bundles, so nothing comes off it until the second day — see
    // `resources/wear.ts`. The treatment still happens on the first, because
    // what the healer can supply is read off the shelf rather than off the
    // withdrawal.
    expect(patient.illDaysRemaining).toBeLessThan(ILLNESS_DAYS - 1);
  });

  it('spends its herbs on the people it is treating', () => {
    const simulation = new Simulation(OPTIONS);
    if (!raise(simulation, 'healer')) {
      return;
    }
    simulation.storages.all[0]?.inventory.add('herbs', 500);
    const before = simulation.storages.totalOf('herbs');

    // Kept unwell for a fortnight, because half a bundle a day is paid in whole
    // bundles every second day. Over that span the shelf must fall, and must
    // never hold part of a bundle.
    const patient = simulation.villagers.all[0]!;
    for (let day = 0; day < 14; day += 1) {
      patient.illDaysRemaining = ILLNESS_DAYS;
      runDays(simulation, 1);
      expect(Number.isInteger(simulation.storages.totalOf('herbs'))).toBe(true);
    }

    expect(simulation.storages.totalOf('herbs')).toBeLessThan(before);
  });

  it('uses nothing on a day when nobody is unwell', () => {
    const simulation = new Simulation(OPTIONS);
    if (!raise(simulation, 'healer')) {
      return;
    }
    simulation.storages.all[0]?.inventory.add('herbs', 500);
    for (const villager of simulation.villagers.all) {
      villager.illDaysRemaining = 0;
    }
    const before = simulation.storages.totalOf('herbs');

    runDays(simulation, 1);

    expect(simulation.storages.totalOf('herbs')).toBe(before);
  });

  it('is overwhelmed by more patients than it has room for', () => {
    // Care is capped by staff, so a big settlement needs more than one — which
    // is the reason the building scales with the settlement rather than being
    // a one-off purchase.
    const simulation = new Simulation(OPTIONS);
    const healer = raise(simulation, 'healer');
    if (!healer) {
      return;
    }
    simulation.storages.all[0]?.inventory.add('herbs', 5000);
    for (const villager of simulation.villagers.all) {
      villager.illDaysRemaining = ILLNESS_DAYS;
    }

    runDays(simulation, 1);

    const capacity = healer.workers.length * (healer.definition.care?.patientsPerWorker ?? 0);
    expect(capacity).toBeGreaterThan(0);
    expect(capacity).toBeLessThan(simulation.villagers.all.length);
    expect(simulation.snapshot().illness.careFraction).toBeLessThan(1);
  });
});

describe('the settlement as a whole', () => {
  it('reports who is unwell, so the player can see it coming', () => {
    const simulation = new Simulation(OPTIONS);
    simulation.villagers.all[0]!.illDaysRemaining = ILLNESS_DAYS;

    runDays(simulation, 1);

    expect(simulation.snapshot().illness.ill).toBeGreaterThan(0);
  });

  it('falls ill the same way after a save and a load', () => {
    // Illness has its own RNG stream, and a stream whose cursor is not saved
    // makes a loaded settlement diverge from the one the player left.
    const first = new Simulation(OPTIONS);
    runDays(first, 6);

    const restored = new Simulation(OPTIONS);
    restored.restoreIllnessRandom(first.illnessRandomState);

    expect(restored.illnessRandomState).toEqual(first.illnessRandomState);
  });

  it('is rarer under a roof than in the open, over a whole year', () => {
    // The measurement that makes housing worth more than warmth alone.
    const sheltered = Array.from({ length: 30 }, (_, i) => person({ id: i + 1, homeId: 1 }));
    const exposed = Array.from({ length: 30 }, (_, i) => person({ id: i + 1, homeId: null }));
    const random = new SeededRandom(2026);

    let shelteredCases = 0;
    let exposedCases = 0;
    for (let day = 0; day < 60; day += 1) {
      shelteredCases += runIllness(sheltered, random, 0).fellIll;
      exposedCases += runIllness(exposed, random, 0).fellIll;
    }

    expect(exposedCases).toBeGreaterThan(shelteredCases);
    expect(BASE_ILLNESS_CHANCE).toBeGreaterThan(0);
  });
});

// --- helpers ---------------------------------------------------------------

function runDays(simulation: Simulation, days: number): void {
  for (let tick = 1; tick <= TICKS_PER_DAY * days; tick += 1) {
    simulation.update(simulation.tick + 1, TICK);
  }
}

function raise(simulation: Simulation, id: BuildingId): Building | null {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      const cell = { gx, gy };
      if (!simulation.canPlaceBuilding(id, cell).ok) {
        continue;
      }
      const building = simulation.placeBuilding(id, cell);
      if (building) {
        simulation.world.buildings.complete(simulation.world, building);
        return building;
      }
    }
  }
  return null;
}
