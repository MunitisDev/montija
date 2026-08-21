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
  AGE_DOUBLING,
  BASE_ILLNESS_CHANCE,
  CARE_RECOVERY_SHARE,
  CARE_SURVIVAL_SHARE,
  MORTAL_BASE,
  PRIME_AGE,
  mortalRiskFor,
  EXPOSURE_MULTIPLIER,
  HOUSEHOLD_CONTAGION,
  ILLNESS_DAYS,
  WASHING_SHARE,
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
    //
    // Housed four to a cottage, which is what twenty people under a roof
    // actually is — and it matters now that illness spreads: putting the same
    // twenty in one house is a different claim, and the outbreak below is where
    // it is tested.
    const villagers = Array.from({ length: 20 }, (_, i) =>
      person({ id: i + 1, homeId: Math.floor(i / 4) + 1 }),
    );
    const random = new SeededRandom(99);
    let cases = 0;
    for (let day = 0; day < 60; day += 1) {
      cases += runIllness(villagers, random, 0).fellIll;
    }

    expect(cases).toBeGreaterThan(0);
    expect(cases).toBeLessThan(10);
  });
});

describe('a case, once caught', () => {
  it('runs its course and ends', () => {
    const villagers = [person()];
    villagers[0]!.illDaysRemaining = ILLNESS_DAYS;
    // A stream that never rolls anything: nobody catches anything and nobody
    // dies of it, so the only thing moving is the case itself. This is a claim
    // about how long an illness lasts and it should not be a claim about luck.
    const random = { next: () => 1 };

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
    const random = { next: () => 1 };

    let days = 0;
    while (treated[0]!.isIll && days < 50) {
      runIllness(treated, random, 1);
      days += 1;
    }

    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThan(ILLNESS_DAYS);
    expect(CARE_RECOVERY_SHARE).toBeGreaterThan(0);
  });

  it('can be the end of somebody, and the older they are the likelier', () => {
    // What the player asked for, and the reversal of the oldest rule in this
    // system. Doubling every dozen years, so a settlement's elders are the ones
    // at risk and its young adults are very nearly not.
    const young = person();
    young.age = PRIME_AGE;
    const old = person();
    old.age = PRIME_AGE + AGE_DOUBLING * 3;

    expect(mortalRiskFor(young)).toBeCloseTo(MORTAL_BASE);
    expect(mortalRiskFor(old)).toBeCloseTo(MORTAL_BASE * 8);
  });

  it('is far less likely for somebody being treated', () => {
    const patient = person();
    patient.age = 60;

    expect(mortalRiskFor(patient, 1)).toBeCloseTo(
      mortalRiskFor(patient, 0) * (1 - CARE_SURVIVAL_SHARE),
    );
    expect(mortalRiskFor(patient, 1)).toBeLessThan(mortalRiskFor(patient, 0));
  });

  it('is worse for somebody cold and worse again for somebody hungry', () => {
    // The two things the player is already managing, meeting the sickbed. Not a
    // second way to lose health — a multiplier on a small number.
    const comfortable = person();
    const cold = person();
    cold.needs.warmth = 0;
    const starving = person();
    starving.needs.hunger = 0;
    const both = person();
    both.needs.warmth = 0;
    both.needs.hunger = 0;

    expect(mortalRiskFor(cold)).toBeGreaterThan(mortalRiskFor(comfortable));
    expect(mortalRiskFor(starving)).toBeGreaterThan(mortalRiskFor(comfortable));
    expect(mortalRiskFor(both)).toBeGreaterThan(mortalRiskFor(cold));
    // And bounded: three times over, not ten.
    expect(mortalRiskFor(both)).toBeLessThan(mortalRiskFor(comfortable) * 4);
  });

  it('reports who died rather than removing them itself', () => {
    // The illness system decides who does not recover; what a death means for
    // the roll of the dead, the household and the job they were holding belongs
    // to the simulation.
    const villagers = [person()];
    villagers[0]!.age = 70;
    villagers[0]!.illDaysRemaining = ILLNESS_DAYS;

    const report = runIllness(villagers, { next: () => 0 }, 0);

    expect(report.died).toEqual([villagers[0]!.id]);
    expect(villagers[0]!.isIll).toBe(false);
  });

  it('buries them in the settlement, and names the illness', () => {
    // End to end: a settlement of elders with something going round loses
    // people, and the roll says what took them.
    const simulation = new Simulation(OPTIONS);
    for (const villager of simulation.villagers.all) {
      villager.age = 74;
      villager.illDaysRemaining = ILLNESS_DAYS;
    }
    const before = simulation.villagers.count;

    for (let day = 0; day < ILLNESS_DAYS; day += 1) {
      runDays(simulation, 1);
    }

    expect(simulation.villagers.count).toBeLessThan(before);
    const roll = simulation.necrology.all;
    expect(roll.some((record) => record.cause === 'illness')).toBe(true);
  });

  it('takes no health at all', () => {
    // The central design decision. Illness costs the settlement hands; hunger
    // and cold are what kill.
    const villagers = [person()];
    villagers[0]!.illDaysRemaining = ILLNESS_DAYS;
    const before = villagers[0]!.needs.health;

    runIllness(villagers, { next: () => 1 }, 0);

    expect(villagers[0]!.needs.health).toBe(before);
  });

  it('goes round the house it started in', () => {
    // The whole point of contagion: five people sharing a roof with somebody ill
    // are in a different settlement from five people in five cottages, and the
    // player decides which one they built.
    //
    // Counted over forty streams rather than one, because a single household's
    // fortnight is luck: the rate is three in a hundred a day.
    let crowded = 0;
    let spread = 0;
    for (let trial = 0; trial < 40; trial += 1) {
      const together = Array.from({ length: 5 }, (_, i) => person({ id: i + 1, homeId: 1 }));
      const apart = Array.from({ length: 5 }, (_, i) => person({ id: i + 1, homeId: i + 1 }));
      together[0]!.illDaysRemaining = ILLNESS_DAYS;
      apart[0]!.illDaysRemaining = ILLNESS_DAYS;
      const near = new SeededRandom(4 + trial);
      const far = new SeededRandom(4 + trial);
      for (let day = 0; day < ILLNESS_DAYS; day += 1) {
        crowded += runIllness(together, near, 0).fellIll;
        spread += runIllness(apart, far, 0).fellIll;
      }
    }

    expect(crowded).toBeGreaterThan(spread);
  });

  it('spreads half as far where there is water to wash in', () => {
    // The Well's second job, and a decision made seasons before anybody is ill.
    // Rolled against a fixed number rather than a stream, because the claim is
    // about the odds and not about one valley's luck.
    const household = () => {
      const people = Array.from({ length: 4 }, (_, i) => person({ id: i + 1, homeId: 1 }));
      people[0]!.illDaysRemaining = ILLNESS_DAYS;
      return people;
    };
    const certain = { next: () => HOUSEHOLD_CONTAGION * 0.75 };

    const dry = runIllness(household(), certain, 0, 0, 0);
    const washed = runIllness(household(), certain, 0, 0, 1);

    // A roll three quarters of the way to the dry chance catches it without
    // water and does not with it, which is what halving the spread means.
    expect(dry.caught).toBe(3);
    expect(washed.caught).toBe(0);
    expect(WASHING_SHARE).toBeGreaterThan(0);
  });

  it('separates what was caught from what simply happened', () => {
    // Two ways to fall ill, told apart by one roll read twice. It is the only
    // honest way to answer "did the settlement do this to itself?".
    const alone = [person()];
    const report = runIllness(alone, { next: () => 0 }, 0);

    expect(report.fellIll).toBe(1);
    expect(report.caught).toBe(0);
  });

  it('does not run through a household in a single day', () => {
    // Today's exposure is yesterday's sick list. Walk the villagers live and the
    // first case of the morning infects the family by the afternoon, which makes
    // the outcome depend on the order people happen to be stored in.
    const family = Array.from({ length: 4 }, (_, i) => person({ id: i + 1, homeId: 1 }));
    let call = 0;
    const random = {
      next: () => {
        call += 1;
        // The first villager falls ill on their own account; the rest roll a
        // number that would catch it from a sick housemate and would not catch
        // anything from a healthy one.
        return call === 1 ? 0 : HOUSEHOLD_CONTAGION * 0.5;
      },
    };

    const report = runIllness(family, random, 0);

    expect(report.fellIll).toBe(1);
    expect(report.caught).toBe(0);
  });

  it('is not passed round the people sleeping rough, who have no roof to share', () => {
    // Written the other way round first, and measured away: every settlement
    // starts with ten people sleeping in the open, so treating them as one
    // household meant one case in the first fortnight took most of the hands the
    // opening needs. Sleeping rough is dangerous because of the exposure, not
    // because of the company.
    const rough = Array.from({ length: 4 }, (_, i) => person({ id: i + 1, homeId: null }));
    rough[0]!.illDaysRemaining = ILLNESS_DAYS;

    const report = runIllness(rough, { next: () => HOUSEHOLD_CONTAGION * 0.9 }, 0);

    expect(report.caught).toBe(0);
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
    // Handed back, not destroyed — and often picked straight back up: on a busy
    // board somebody else claims it inside the same tick, which is the whole
    // point of handing it back. So the claim is that the *ill* villager is not
    // holding it, not that nobody is.
    expect(simulation.jobs.get(jobId)?.assignedVillager ?? null).not.toBe(worker.id);
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
    // The measurement that makes housing worth more than warmth alone. Thirty
    // people housed is thirty people in cottages of four; thirty people exposed
    // is thirty people sleeping in one heap, which is why the gap is now far
    // wider than the fivefold the base rate alone would give.
    const sheltered = Array.from({ length: 30 }, (_, i) =>
      person({ id: i + 1, homeId: Math.floor(i / 4) + 1 }),
    );
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
