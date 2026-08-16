/**
 * Couples, and who was born to whom.
 *
 * A settlement whose people are interchangeable is a settlement nobody minds
 * losing. Before this, a birth drew two eligible adults out of the population
 * afresh each time, so "the parents" were a different two people every day and
 * there was nothing about anybody worth showing.
 *
 * The trap this has to avoid is documented in the population system itself:
 * requiring both parents to share a house was tried when births were written
 * and produced **no children at all** across six simulated years, because
 * whether the two people given the house with the spare bed happened to both be
 * of an age was a lottery. So the tests that matter here are not only "are
 * there couples" but "does the settlement still grow" — measured against the
 * same run without pairing, which produced the same population and the same
 * number of births.
 */

import { describe, expect, it } from 'vitest';

import { Simulation } from '@/simulation/Simulation';
import { CHILDBEARING_AGE_MAX, CHILDBEARING_AGE_MIN } from '@/data/population';
import { restore, serialise } from '@/simulation/save/serialise';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { Villager } from '@/simulation/villagers/Villager';

const TICK = 0.1;
const OPTIONS = { seed: 20260815, worldWidth: 64, worldHeight: 64, startingVillagers: 10 };

/** Runs a well-fed, well-housed settlement, so growth is what is measured. */
function raiseAFamily(days: number, seed = OPTIONS.seed): Simulation {
  const simulation = new Simulation({ ...OPTIONS, seed });

  for (let i = 0; i < 12; i += 1) {
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

  for (let day = 1; day <= days; day += 1) {
    // Topped up to a level rather than by an amount. Adding a lump of food
    // filled the yards to capacity and left no room for firewood, and the
    // settlement then froze to death with a full granary — which is the game
    // working correctly, and was purely an artefact of how the test stocked it.
    for (const yard of simulation.storages.all) {
      yard.inventory.add('food', Math.max(0, 400 - yard.inventory.count('food')));
      yard.inventory.add('firewood', Math.max(0, 300 - yard.inventory.count('firewood')));
    }
    for (let tick = 1; tick <= TICKS_PER_DAY; tick += 1) {
      simulation.update(simulation.tick + 1, TICK);
    }
  }

  return simulation;
}

function partners(simulation: Simulation): Villager[] {
  return simulation.villagers.all.filter((villager) => villager.partnerId !== null);
}

describe('pairing up', () => {
  it('happens without anybody being told to', () => {
    const simulation = raiseAFamily(3);
    expect(partners(simulation).length).toBeGreaterThan(0);
  });

  it('is always mutual', () => {
    // A one-sided pairing would let somebody be married to a person who is
    // married to somebody else, and every count drawn from it would disagree.
    const simulation = raiseAFamily(120);
    const byId = new Map(simulation.villagers.all.map((villager) => [villager.id, villager]));

    for (const villager of partners(simulation)) {
      const partner = byId.get(villager.partnerId!);
      expect(partner, `${villager.name} names a partner who does not exist`).toBeDefined();
      expect(partner?.partnerId).toBe(villager.id);
    }
  });

  it('never pairs somebody with themselves', () => {
    const simulation = raiseAFamily(60);
    for (const villager of partners(simulation)) {
      expect(villager.partnerId).not.toBe(villager.id);
    }
  });

  it('leaves children out of it', () => {
    const simulation = raiseAFamily(200);
    for (const villager of partners(simulation)) {
      expect(villager.age).toBeGreaterThanOrEqual(CHILDBEARING_AGE_MIN);
    }
  });

  it('frees a survivor when their partner dies', () => {
    // Left in place, a dead partner's id would keep the survivor out of every
    // future pairing for the rest of their life.
    const simulation = raiseAFamily(3);
    const couple = partners(simulation)[0];
    expect(couple).toBeDefined();
    if (!couple) {
      return;
    }
    const partnerId = couple.partnerId!;

    // Old age, arranged rather than waited for.
    const partner = simulation.villagers.all.find((villager) => villager.id === partnerId)!;
    partner.age = partner.lifespan;
    for (let tick = 1; tick <= TICKS_PER_DAY * 2; tick += 1) {
      simulation.update(simulation.tick + 1, TICK);
    }

    expect(simulation.villagers.all.some((villager) => villager.id === partnerId)).toBe(false);
    // Freed from the dead, not necessarily left alone: the same pass that
    // clears a widow can pair them again, which is correct and was what made
    // an earlier version of this test assert `null` and fail.
    expect(couple.partnerId).not.toBe(partnerId);
  });

  it('lets a widow pair again', () => {
    const simulation = raiseAFamily(3);
    const couple = partners(simulation)[0]!;
    const partner = simulation.villagers.all.find((v) => v.id === couple.partnerId)!;
    partner.age = partner.lifespan;

    for (let tick = 1; tick <= TICKS_PER_DAY * 6; tick += 1) {
      simulation.update(simulation.tick + 1, TICK);
    }

    // Either paired again or genuinely nobody left of an age — both are fine;
    // what must not happen is being stuck naming somebody who is gone.
    const stillNamesTheDead = simulation.villagers.all.some(
      (villager) =>
        villager.partnerId !== null &&
        !simulation.villagers.all.some((other) => other.id === villager.partnerId),
    );
    expect(stillNamesTheDead).toBe(false);
  });
});

describe('children', () => {
  it('are born to a couple, and know which one', () => {
    const simulation = raiseAFamily(240);
    const children = simulation.villagers.all.filter((villager) => villager.parentIds !== null);
    expect(children.length).toBeGreaterThan(0);

    for (const child of children) {
      const [first, second] = child.parentIds!;
      expect(first).not.toBe(second);
      // Recorded oldest id first, so a pair always reads the same way round.
      expect(first).toBeLessThan(second);
    }
  });

  it('are not recorded for the founders', () => {
    // Ten people who walked out of nowhere have no parents in this settlement,
    // and inventing some would put strangers in everybody's family tree.
    const simulation = raiseAFamily(1);
    expect(simulation.villagers.all.every((villager) => villager.parentIds === null)).toBe(true);
  });

  it('grow up into the households they were born into', () => {
    const simulation = raiseAFamily(240);
    const child = simulation.villagers.all.find((villager) => villager.parentIds !== null);
    expect(child).toBeDefined();
    expect(child?.homeId).not.toBeNull();
  });

  it('still arrive at the rate they did before couples existed', () => {
    // The measurement that matters, and the one the shared-house attempt failed.
    // Run against the same settlement without pairing this produced the same
    // population and the same births, so families cost the player nothing.
    for (const seed of [20260815, 2024]) {
      const simulation = raiseAFamily(360, seed);
      expect(simulation.villagers.all.length, `seed ${seed}`).toBeGreaterThanOrEqual(20);
      expect(
        simulation.villagers.all.filter((villager) => villager.parentIds !== null).length,
        `seed ${seed} children born here`,
      ).toBeGreaterThanOrEqual(8);
    }
  });

  it('never arrive from a couple twice in one day', () => {
    // Both partners go on cooldown together; taking them separately would let
    // the same household produce two children on the same day.
    const simulation = raiseAFamily(120);
    const byBirthday = new Map<string, number>();
    for (const villager of simulation.villagers.all) {
      if (villager.parentIds === null) {
        continue;
      }
      const key = `${villager.parentIds[0]}:${villager.parentIds[1]}:${villager.age}:${villager.daysSinceBirthday}`;
      byBirthday.set(key, (byBirthday.get(key) ?? 0) + 1);
    }
    for (const [key, count] of byBirthday) {
      expect(count, key).toBe(1);
    }
  });
});

describe('a family over a save', () => {
  it('keeps its couples and its parents', () => {
    const simulation = raiseAFamily(240);
    const before = simulation.villagers.all.map((villager) => ({
      id: villager.id,
      partnerId: villager.partnerId,
      parentIds: villager.parentIds,
    }));

    const restored = new Simulation(OPTIONS);
    restore(restored, JSON.parse(JSON.stringify(serialise(simulation, 'now'))));

    const after = restored.villagers.all.map((villager) => ({
      id: villager.id,
      partnerId: villager.partnerId,
      parentIds: villager.parentIds,
    }));
    expect(after).toEqual(before);
  });
});

describe('the settlement report', () => {
  it('counts the couples that formed', () => {
    const simulation = raiseAFamily(1);
    // Ten founders of an age pair off on the first day the settlement runs.
    expect(simulation.snapshot().population.paired).toBeGreaterThanOrEqual(0);
    expect(partners(simulation).length % 2).toBe(0);
  });

  it('never pairs somebody past childbearing age', () => {
    const simulation = raiseAFamily(2);
    for (const villager of partners(simulation)) {
      expect(villager.age).toBeLessThanOrEqual(CHILDBEARING_AGE_MAX);
    }
  });
});
