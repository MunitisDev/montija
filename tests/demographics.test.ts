/**
 * A settlement that goes on being a settlement.
 *
 * All of this came out of one report from a long game: **"I have reached year six
 * with no trouble, and the population has settled at twenty people, so I have
 * buildings with nobody in them."** Measured on a kept-fed, kept-housed
 * settlement over twenty years, that was exactly right — it reached 24 people in
 * year four and was still 24 in year twenty. Sixteen years flat.
 *
 * Three separate things were holding it there, and each of them looked reasonable
 * on its own:
 *
 * 1. **One birth roll a day for the whole village.** Not per couple — per
 *    settlement. So eight households grew no faster than two, and the ceiling was
 *    about two children a year whatever the player did.
 * 2. **A house counted residents, not grown-ups.** A couple with two children
 *    filled a four-bed cottage, so the birth check found no spare bed anywhere
 *    and stopped.
 * 3. **One age did three jobs.** `isAdult` meant "can work", "can marry" and
 *    "takes a place at home" all at once, so a fifteen year old counted against
 *    their own parents' housing.
 *
 * With all three addressed the same fixture reaches 63 people by year six. These
 * tests pin the mechanisms rather than that number, which is a balance figure and
 * will move.
 */

import { describe, expect, it } from 'vitest';

import { WORLD_HEIGHT, WORLD_WIDTH } from '@/app/config';
import {
  ADULT_AGE,
  ILL_DAYS_PER_YEAR_LOST,
  LIFESPAN_MAX,
  LIFESPAN_MIN,
  MAX_PAIR_AGE_GAP,
  RETIREMENT_AGE,
  WORKING_AGE,
} from '@/data/population';
import { SeededRandom } from '@/shared/math/random';
import { Building } from '@/simulation/buildings/Building';
import { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';
import { runIllness } from '@/simulation/population/IllnessSystem';
import { expectedLifespan, runPopulationDay } from '@/simulation/population/PopulationSystem';
import { Simulation } from '@/simulation/Simulation';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import { Villager } from '@/simulation/villagers/Villager';

const DAYS_PER_YEAR = 48;

describe('a life is about seventy years', () => {
  it('rolls lifespans around seventy rather than around sixty', () => {
    expect((LIFESPAN_MIN + LIFESPAN_MAX) / 2).toBeGreaterThanOrEqual(68);
    expect((LIFESPAN_MIN + LIFESPAN_MAX) / 2).toBeLessThanOrEqual(72);
  });

  it('costs a year of life for every stretch of illness', () => {
    const well = person({ id: 1, age: 30, lifespan: 70 });
    const sickly = person({ id: 2, age: 30, lifespan: 70 });
    sickly.illDaysLived = ILL_DAYS_PER_YEAR_LOST * 4;

    expect(expectedLifespan(well)).toBe(70);
    expect(expectedLifespan(sickly)).toBe(66);
  });

  it('takes somebody early when illness has cost them enough', () => {
    // **This is what a Healer's House is worth.** Shortening cases lengthens
    // lives, so life expectancy is something the player builds.
    const villager = person({ id: 1, age: 67, lifespan: 70 });
    villager.illDaysLived = ILL_DAYS_PER_YEAR_LOST * 3;
    villager.daysSinceBirthday = DAYS_PER_YEAR - 1;

    const day = runDay({ villagers: [villager] });
    expect(day.died).toContain(villager);
  });

  it('counts a day unwell as it happens', () => {
    // Driven directly rather than waited for: illness is a seeded roll, and a
    // test that hopes somebody falls ill is a test that fails on some other seed.
    const villager = person({ id: 1, age: 30 });
    villager.illDaysRemaining = 5;

    runIllness([villager], new SeededRandom(3), 0);

    expect(villager.illDaysLived).toBe(1);
    expect(villager.illDaysRemaining).toBe(4);
  });

  it('does not count days somebody spent well', () => {
    const villager = person({ id: 1, age: 30 });
    runIllness([villager], new SeededRandom(3), 0);
    // Either they stayed well, or they fell ill today — falling ill is not a day
    // spent ill, and the day it starts must not be charged twice.
    expect(villager.illDaysLived).toBe(0);
  });
});

describe('who works, who is grown up, who has retired', () => {
  it('puts a fourteen year old to work without making them a grown-up', () => {
    const youth = person({ id: 1, age: WORKING_AGE });
    expect(youth.canWork).toBe(true);
    expect(youth.isAdult).toBe(false);
  });

  it('retires everybody at sixty, and keeps them alive', () => {
    const elder = person({ id: 1, age: RETIREMENT_AGE, lifespan: 75 });
    expect(elder.canWork).toBe(false);
    expect(elder.isElder).toBe(true);

    const day = runDay({ villagers: [elder] });
    expect(day.died).toHaveLength(0);
  });

  it('does not let a retired villager hold a workshop post', () => {
    const simulation = keptWell(20260815, 4);
    for (const villager of simulation.villagers.all) {
      villager.age = RETIREMENT_AGE + 1;
      villager.lifespan = 200;
    }
    for (let tick = 0; tick < TICKS_PER_DAY * 3; tick += 1) {
      simulation.update(simulation.tick + 1, 0.1);
    }
    expect(simulation.villagers.all.every((villager) => villager.employerId === null)).toBe(true);
  });
});

describe('a house holds four grown-ups and a family', () => {
  it('never counts a child against the four', () => {
    // Two parents and six children under one roof is a family, not an overfull
    // house. Counting the children is what stopped the births.
    const villagers = [
      person({ id: 1, age: 30, sex: 'f' }),
      person({ id: 2, age: 30, sex: 'm' }),
      ...Array.from({ length: 6 }, (_, index) => person({ id: 3 + index, age: 4 })),
    ];
    for (const child of villagers.slice(2)) {
      child.parentIds = [1, 2];
    }

    const day = runDay({ villagers, buildings: withHouses(1) });

    expect(day.report.homeless).toBe(0);
    expect(villagers.every((villager) => villager.homeId === 1)).toBe(true);
  });

  it('still turns a fifth grown-up away', () => {
    const villagers = Array.from({ length: 5 }, (_, index) =>
      person({ id: index + 1, age: ADULT_AGE + 5 }),
    );
    const day = runDay({ villagers, buildings: withHouses(1) });
    expect(day.report.homeless).toBe(1);
  });

  it('keeps a child with its parents even when the house is full of grown-ups', () => {
    const villagers = [
      person({ id: 1, age: 30, sex: 'f' }),
      person({ id: 2, age: 30, sex: 'm' }),
      person({ id: 3, age: 40, sex: 'f' }),
      person({ id: 4, age: 40, sex: 'm' }),
      person({ id: 5, age: 3 }),
    ];
    villagers[4]!.parentIds = [1, 2];

    runDay({ villagers, buildings: withHouses(1) });

    expect(villagers[4]!.homeId).toBe(1);
  });
});

describe('couples', () => {
  it('will not pair people more than six years apart', () => {
    const young = person({ id: 1, age: 20, sex: 'f' });
    const old = person({ id: 2, age: 20 + MAX_PAIR_AGE_GAP + 1, sex: 'm' });

    runDay({ villagers: [young, old], buildings: withHouses(1) });

    expect(young.partnerId).toBeNull();
    expect(old.partnerId).toBeNull();
  });

  it('pairs the closest in age rather than whoever arrived first', () => {
    // Matching the two queues off by id was what this did before, and id order
    // is arrival order — so it married a nineteen year old to a forty year old
    // purely because that was the order they turned up in.
    const woman = person({ id: 1, age: 30, sex: 'f' });
    const farOff = person({ id: 2, age: 36, sex: 'm' });
    const nearby = person({ id: 3, age: 31, sex: 'm' });

    runDay({ villagers: [woman, farOff, nearby], buildings: withHouses(2) });

    expect(woman.partnerId).toBe(nearby.id);
    expect(farOff.partnerId).toBeNull();
  });

  it('lets a widow of fifty marry again', () => {
    // **No upper age limit, because widowhood has no upper age limit.** Bearing
    // children still stops at forty-two; finding somebody does not. Refusing
    // this left every survivor of a long marriage alone for the rest of a life
    // that is now seventy years long.
    const widow = person({ id: 1, age: 50, sex: 'f' });
    const widower = person({ id: 2, age: 53, sex: 'm' });

    runDay({ villagers: [widow, widower], buildings: withHouses(1) });

    expect(widow.partnerId).toBe(widower.id);
  });

  it('does not pair a fifteen year old with anybody', () => {
    const youth = person({ id: 1, age: 15, sex: 'f' });
    const grownUp = person({ id: 2, age: 19, sex: 'm' });

    runDay({ villagers: [youth, grownUp], buildings: withHouses(1) });

    expect(youth.partnerId).toBeNull();
  });
});

describe('growth', () => {
  it('scales with the number of couples rather than being fixed per village', () => {
    // The stall, isolated. Four households should out-breed one, and under the
    // old one-roll-a-day rule they did not.
    const oneCouple = birthsOver(2, 200);
    const fourCouples = birthsOver(8, 200);

    expect(oneCouple).toBeGreaterThan(0);
    expect(fourCouples).toBeGreaterThan(oneCouple * 2);
  });

  it('does not settle at twenty, which is the whole complaint', () => {
    // A settlement kept fed and housed reached 24 people in year four and was
    // still 24 in year twenty. This runs six years, which is where the player
    // was when they noticed.
    const simulation = keptWell(20260815, 8);
    for (let day = 1; day <= DAYS_PER_YEAR * 6; day += 1) {
      feed(simulation);
      for (let tick = 0; tick < TICKS_PER_DAY; tick += 1) {
        simulation.update(simulation.tick + 1, 0.1);
      }
    }
    expect(simulation.villagers.all.length).toBeGreaterThan(30);
  }, 30_000);
});

/** How many children a settlement of `people` well-fed adults has in `days`. */
function birthsOver(people: number, days: number): number {
  const villagers = Array.from({ length: people }, (_, index) =>
    person({ id: index + 1, age: 25, sex: index % 2 === 0 ? 'f' : 'm' }),
  );
  const buildings = withHouses(people);
  const random = new SeededRandom(7);
  let births = 0;

  for (let day = 0; day < days; day += 1) {
    const result = runPopulationDay({
      villagers,
      buildings,
      random,
      foodDaysPerPerson: 40,
    });
    births += result.born.length;
    // Newborns are not spawned here — this measures the settlement's *rate*,
    // and adding mouths would change the ages in play halfway through.
  }
  return births;
}

function person(options: {
  id: number;
  age: number;
  lifespan?: number;
  sex?: 'f' | 'm';
}): Villager {
  return new Villager({
    id: options.id,
    name: `V${options.id} Family`,
    sex: options.sex ?? (options.id % 2 === 0 ? 'f' : 'm'),
    age: options.age,
    position: { wx: 0.5, wy: 0.5 },
    lifespan: options.lifespan ?? LIFESPAN_MAX,
  });
}

function withHouses(count: number): BuildingRegistry {
  const buildings = new BuildingRegistry();
  for (let index = 0; index < count; index += 1) {
    const house = new Building(index + 1, 'house', { gx: index * 3, gy: 0 });
    house.complete();
    buildings.restoreOne(house);
  }
  return buildings;
}

function runDay(options: {
  villagers: Villager[];
  buildings?: BuildingRegistry;
  foodDaysPerPerson?: number;
  random?: SeededRandom;
}) {
  return runPopulationDay({
    villagers: options.villagers,
    buildings: options.buildings ?? withHouses(0),
    random: options.random ?? new SeededRandom(1),
    foodDaysPerPerson: options.foodDaysPerPerson ?? 0,
  });
}

/** A real settlement with houses standing, kept fed so demographics is what runs. */
function keptWell(seed: number, houses: number): Simulation {
  const simulation = new Simulation({
    seed,
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    startingVillagers: 10,
  });

  for (let index = 0; index < houses; index += 1) {
    outer: for (let gy = 0; gy < simulation.world.height; gy += 1) {
      for (let gx = 0; gx < simulation.world.width; gx += 1) {
        if (simulation.canPlaceBuilding('house', { gx, gy }).ok) {
          const house = simulation.placeBuilding('house', { gx, gy });
          if (house) {
            simulation.world.buildings.complete(simulation.world, house);
          }
          break outer;
        }
      }
    }
  }
  feed(simulation);
  return simulation;
}

/** Tops the yards up to a level, so nothing starves or freezes mid-test. */
function feed(simulation: Simulation): void {
  for (const yard of simulation.storages.all) {
    yard.inventory.add('vegetables', Math.max(0, 900 - yard.inventory.count('vegetables')));
    yard.inventory.add('firewood', Math.max(0, 400 - yard.inventory.count('firewood')));
  }
  simulation.storages.markChanged();
}
