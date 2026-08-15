/**
 * Homes, ageing, births and old age.
 *
 * These cover the loop that turns "survive one winter" into the brief's actual
 * fantasy — survive, grow and prosper over many years — and the three things
 * that were quietly inert before it existed: `housingCapacity`, `age`, and the
 * House's own claim to keep its residents warm.
 */

import { describe, expect, it } from 'vitest';

import { BIRTH_REQUIREMENTS, LIFESPAN_MAX, WORKING_AGE } from '@/data/population';
import { SeededRandom } from '@/shared/math/random';
import { Building } from '@/simulation/buildings/Building';
import { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';
import { runPopulationDay } from '@/simulation/population/PopulationSystem';
import { DAYS_PER_SEASON } from '@/simulation/seasons/SeasonClock';
import { Villager } from '@/simulation/villagers/Villager';

const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;

function person(options: { id: number; age: number; lifespan?: number }): Villager {
  return new Villager({
    id: options.id,
    name: `V${options.id}`,
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
  it('counts anyone below working age as a child', () => {
    const child = person({ id: 1, age: WORKING_AGE - 1 });
    const adult = person({ id: 2, age: WORKING_AGE });

    expect(child.isAdult).toBe(false);
    expect(adult.isAdult).toBe(true);

    const day = runDay({ villagers: [child, adult] });
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

  it('never happens without a spare bed', () => {
    // Two adults and two children already fill the only house.
    const setup = fertile();
    setup.villagers.push(person({ id: 3, age: 2 }), person({ id: 4, age: 3 }));
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
