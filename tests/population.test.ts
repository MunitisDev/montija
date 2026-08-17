/**
 * Homes, ageing, births and old age.
 *
 * These cover the loop that turns "survive one winter" into the brief's actual
 * fantasy — survive, grow and prosper over many years — and the three things
 * that were quietly inert before it existed: `housingCapacity`, `age`, and the
 * House's own claim to keep its residents warm.
 */

import { describe, expect, it } from 'vitest';

import {
  ADULT_AGE,
  BIRTH_REQUIREMENTS,
  IMMIGRATION_REQUIREMENTS,
  LIFESPAN_MAX,
  RETIREMENT_AGE,
  WORKING_AGE,
} from '@/data/population';
import { SeededRandom } from '@/shared/math/random';
import { Building } from '@/simulation/buildings/Building';
import { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';
import { runPopulationDay } from '@/simulation/population/PopulationSystem';
import { DAYS_PER_SEASON } from '@/simulation/seasons/SeasonClock';
import { Villager } from '@/simulation/villagers/Villager';

const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;

function person(options: {
  id: number;
  age: number;
  lifespan?: number;
  sex?: 'f' | 'm';
}): Villager {
  return new Villager({
    id: options.id,
    name: `V${options.id}`,
    // Alternating by id unless a test says otherwise, so a pair of test
    // villagers is a pair that can actually become a couple. A settlement of
    // one sex is sterile, which is true of the game and would otherwise show
    // up here as an unrelated test mysteriously failing.
    sex: options.sex ?? (options.id % 2 === 0 ? 'f' : 'm'),
    age: options.age,
    position: { wx: 0.5, wy: 0.5 },
    lifespan: options.lifespan ?? LIFESPAN_MAX,
  });
}

/**
 * A registry holding `count` finished houses.
 *
 * Built directly rather than constructed by villagers: this file is about who
 * lives where, not about hauling planks.
 */
function withHouses(count: number): BuildingRegistry {
  const buildings = new BuildingRegistry();
  for (let i = 0; i < count; i++) {
    // Restored rather than placed: placing needs a world and a navigation grid,
    // and this file is about who lives where, not about terrain.
    const house = new Building(i + 1, 'house', { gx: i * 3, gy: 0 });
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

describe('homes', () => {
  it('houses everyone it has room for', () => {
    const villagers = [person({ id: 1, age: 30 }), person({ id: 2, age: 30 })];

    runDay({ villagers, buildings: withHouses(1) });

    expect(villagers.every((villager) => villager.homeId !== null)).toBe(true);
  });

  it('leaves the overflow homeless rather than overfilling a house', () => {
    // One house holds four. The fifth villager sleeps outside, and winter will
    // tell them so.
    const villagers = Array.from({ length: 5 }, (_, i) => person({ id: i + 1, age: 30 }));

    const day = runDay({ villagers, buildings: withHouses(1) });

    expect(day.report.homeless).toBe(1);
    expect(villagers.filter((villager) => villager.homeId !== null)).toHaveLength(4);
  });

  it('gives nobody a home when there are no houses', () => {
    const villagers = [person({ id: 1, age: 30 })];

    const day = runDay({ villagers });

    expect(villagers[0]!.homeId).toBeNull();
    expect(day.report.homeless).toBe(1);
  });

  it('does not shuffle people between houses for no reason', () => {
    const villagers = Array.from({ length: 5 }, (_, i) => person({ id: i + 1, age: 30 }));
    const buildings = withHouses(2);

    runDay({ villagers, buildings });
    const before = villagers.map((villager) => villager.homeId);
    runDay({ villagers, buildings });

    expect(villagers.map((villager) => villager.homeId)).toEqual(before);
  });

  it('rehouses somebody sleeping rough when a bed frees up', () => {
    const villagers = Array.from({ length: 5 }, (_, i) => person({ id: i + 1, age: 30 }));
    const buildings = withHouses(1);
    runDay({ villagers, buildings });

    const homeless = villagers.find((villager) => villager.homeId === null)!;
    const housed = villagers.find((villager) => villager.homeId !== null)!;
    // Somebody dies, and the empty bed should not stay empty.
    const remaining = villagers.filter((villager) => villager !== housed);
    runDay({ villagers: remaining, buildings });

    expect(homeless.homeId).not.toBeNull();
  });
});

describe('ageing', () => {
  it('advances a year for every year of days', () => {
    const villager = person({ id: 1, age: 30 });

    for (let day = 0; day < DAYS_PER_YEAR; day++) {
      runDay({ villagers: [villager] });
    }

    expect(villager.age).toBe(31);
  });

  it('does not put every birthday on the same day', () => {
    // Ageing counts days rather than firing on a calendar boundary, so old age
    // does not arrive as an annual cull.
    const young = person({ id: 1, age: 30 });
    const old = person({ id: 2, age: 30 });
    old.daysSinceBirthday = DAYS_PER_YEAR - 1;

    runDay({ villagers: [young, old] });

    expect(old.age).toBe(31);
    expect(young.age).toBe(30);
  });

  it('takes the old at the end of their lifespan', () => {
    const villager = person({ id: 1, age: 59, lifespan: 60 });
    villager.daysSinceBirthday = DAYS_PER_YEAR - 1;

    const day = runDay({ villagers: [villager] });

    expect(day.died).toContain(villager);
    expect(day.report.deathsOfOldAge).toBe(1);
  });

  it('leaves everyone else alone', () => {
    const villager = person({ id: 1, age: 30, lifespan: 70 });
    const day = runDay({ villagers: [villager] });
    expect(day.died).toHaveLength(0);
  });
});

describe('children', () => {
  it('separates working from being grown up, and from being retired', () => {
    // **Three ages, not one.** These were a single getter for a long time, and
    // conflating them cost the settlement four years of everybody's labour and,
    // worse, filled houses with children who counted as grown-ups — so one
    // family of four blocked every birth in the village.
    const child = person({ id: 1, age: WORKING_AGE - 1 });
    const youth = person({ id: 2, age: WORKING_AGE });
    const grownUp = person({ id: 3, age: ADULT_AGE });
    const elder = person({ id: 4, age: RETIREMENT_AGE });

    // A thirteen year old does neither.
    expect(child.canWork).toBe(false);
    expect(child.isAdult).toBe(false);

    // A fourteen year old works, and is still a child at home.
    expect(youth.canWork).toBe(true);
    expect(youth.isAdult).toBe(false);
    expect(youth.isChild).toBe(true);

    // At eighteen they are one of the household's grown-ups.
    expect(grownUp.canWork).toBe(true);
    expect(grownUp.isAdult).toBe(true);

    // At sixty they stop working and go on living, eating and needing a fire.
    expect(elder.canWork).toBe(false);
    expect(elder.isAdult).toBe(true);
    expect(elder.isElder).toBe(true);
  });

  it('reports children and grown-ups by adulthood, not by working age', () => {
    const youth = person({ id: 1, age: WORKING_AGE });
    const grownUp = person({ id: 2, age: ADULT_AGE });

    const day = runDay({ villagers: [youth, grownUp] });
    expect(day.report.children).toBe(1);
    expect(day.report.adults).toBe(1);
  });
});

describe('births', () => {
  /** A settlement with every condition for growth met. */
  function fertile() {
    return {
      villagers: [person({ id: 1, age: 25 }), person({ id: 2, age: 27 })],
      buildings: withHouses(1),
      foodDaysPerPerson: BIRTH_REQUIREMENTS.foodDaysPerPerson + 10,
      // Seeded so the roll actually lands; growth is a 4%-a-day chance.
      random: new SeededRandom(7),
    };
  }

  /** Runs days until a birth happens, or gives up. */
  function daysUntilBirth(setup: ReturnType<typeof fertile>, limit = 400): number | null {
    for (let day = 1; day <= limit; day++) {
      if (runDay(setup).born.length > 0) {
        return day;
      }
    }
    return null;
  }

  it('happens in a fed, housed settlement', () => {
    expect(daysUntilBirth(fertile())).not.toBeNull();
  });

  it('never happens without food to spare', () => {
    const setup = { ...fertile(), foodDaysPerPerson: 1 };
    expect(daysUntilBirth(setup)).toBeNull();
  });

  it('happens however many children the household already has', () => {
    // **This test used to assert the opposite, and the opposite was the bug.**
    // A house held four *residents*, so a couple with two children filled it,
    // the birth check found no spare bed anywhere in the village, and growth
    // stopped dead — a player watched a settlement sit at twenty people for
    // years with workshops standing empty.
    //
    // A house now holds four grown-ups and as many of their children as they
    // have. What limits a village is food, health and how many couples it has,
    // which are all things the player can do something about.
    const setup = fertile();
    setup.villagers.push(person({ id: 3, age: 2 }), person({ id: 4, age: 3 }));
    expect(daysUntilBirth(setup)).not.toBeNull();
  });

  it('never happens in a settlement with no houses at all', () => {
    // The bed limit is gone; needing somewhere to live is not. Clearing the
    // couple's `homeId` would prove nothing — housing is reassigned at the top
    // of the same day, before births are considered — so the houses go instead.
    const setup = fertile();
    setup.buildings = withHouses(0);
    expect(daysUntilBirth(setup)).toBeNull();
  });

  it('never happens with only one adult of an age to raise a child', () => {
    const setup = fertile();
    setup.villagers = [person({ id: 1, age: 25 }), person({ id: 2, age: 60 })];
    expect(daysUntilBirth(setup)).toBeNull();
  });

  it('never happens when the adults are in poor health', () => {
    const setup = fertile();
    for (const villager of setup.villagers) {
      villager.needs.health = BIRTH_REQUIREMENTS.minimumHealth - 1;
    }
    expect(daysUntilBirth(setup)).toBeNull();
  });

  it('puts the newborn in the house that had the room', () => {
    const setup = fertile();
    for (let day = 1; day <= 400; day++) {
      const born = runDay(setup).born;
      if (born.length > 0) {
        expect(born[0]!.home.definition.id).toBe('house');
        return;
      }
    }
    throw new Error('no birth to check');
  });

  it('rests the parents afterwards rather than growing every day', () => {
    const setup = fertile();
    daysUntilBirth(setup);
    expect(setup.villagers.some((villager) => villager.birthCooldownDays > 0)).toBe(true);
  });

  it('is reproducible from the seed', () => {
    const first = daysUntilBirth(fertile());
    const second = daysUntilBirth(fertile());
    expect(first).toBe(second);
  });
});

describe('immigration', () => {
  /**
   * A settlement worth walking to: food to spare and beds standing empty.
   *
   * Everyone here is past childbearing age, so any growth observed can only be
   * arrivals — which is the dead end this exists to open up.
   */
  function attractive() {
    return {
      villagers: [person({ id: 1, age: 55 }), person({ id: 2, age: 58 })],
      buildings: withHouses(2),
      foodDaysPerPerson: IMMIGRATION_REQUIREMENTS.foodDaysPerPerson + 6,
      random: new SeededRandom(3),
    };
  }

  function daysUntilArrival(setup: ReturnType<typeof attractive>, limit = 400): number | null {
    for (let day = 1; day <= limit; day++) {
      if (runDay(setup).report.arrivals > 0) {
        return day;
      }
    }
    return null;
  }

  it('brings newcomers to a settlement with food and empty beds', () => {
    expect(daysUntilArrival(attractive())).not.toBeNull();
  });

  it('rescues a settlement too old to have children of its own', () => {
    // The dead end: without arrivals this village can only decline, however
    // well the player then plays.
    const setup = attractive();
    expect(setup.villagers.every((villager) => villager.age > 42)).toBe(true);
    expect(daysUntilArrival(setup)).not.toBeNull();
  });

  it('asks more of a settlement than a birth does', () => {
    // Enough food for a family already living here, not enough for a stranger
    // to make the journey on.
    const setup = { ...attractive(), foodDaysPerPerson: BIRTH_REQUIREMENTS.foodDaysPerPerson };
    expect(daysUntilArrival(setup)).toBeNull();
  });

  it('brings nobody to a settlement with nowhere to sleep', () => {
    const setup = { ...attractive(), buildings: withHouses(0) };
    expect(daysUntilArrival(setup)).toBeNull();
  });

  it('brings nobody when the beds are already taken', () => {
    const setup = attractive();
    // One house, and four people already in it.
    setup.buildings = withHouses(1);
    setup.villagers = Array.from({ length: 4 }, (_, i) => person({ id: i + 1, age: 50 }));
    expect(daysUntilArrival(setup)).toBeNull();
  });

  it('never arrives at a settlement with nobody left', () => {
    // Word cannot spread about a place that no longer exists.
    const setup = { ...attractive(), villagers: [] };
    expect(daysUntilArrival(setup)).toBeNull();
  });

  it('never brings more people than there are beds', () => {
    const setup = attractive();
    for (let day = 1; day <= 400; day++) {
      const report = runDay(setup).report;
      if (report.arrivals > 0) {
        const capacity = 2 * 4;
        expect(report.arrivals).toBeLessThanOrEqual(capacity);
        return;
      }
    }
    throw new Error('no arrival to check');
  });

  it('is reproducible from the seed', () => {
    expect(daysUntilArrival(attractive())).toBe(daysUntilArrival(attractive()));
  });
});
