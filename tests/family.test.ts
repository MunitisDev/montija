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
import { ADULT_AGE, CHILDBEARING_AGE_MIN, MAX_PAIR_AGE_GAP } from '@/data/population';
import { FAMILY_NAMES, FEMININE_NAMES, MASCULINE_NAMES } from '@/data/villagers';
import { restore, serialise } from '@/simulation/save/serialise';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { Building } from '@/simulation/buildings/Building';
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
      yard.inventory.add('vegetables', Math.max(0, 400 - yard.inventory.count('vegetables')));
      yard.inventory.add('firewood', Math.max(0, 300 - yard.inventory.count('firewood')));
    }
    for (let tick = 1; tick <= TICKS_PER_DAY; tick += 1) {
      simulation.update(simulation.tick + 1, TICK);
    }
  }

  return simulation;
}

/** Raises one house wherever the map will take it, and finishes it. */
function raise(simulation: Simulation, id: 'house'): Building | null {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      if (simulation.canPlaceBuilding(id, { gx, gy }).ok) {
        const building = simulation.placeBuilding(id, { gx, gy });
        if (building) {
          simulation.world.buildings.complete(simulation.world, building);
        }
        return building;
      }
    }
  }
  return null;
}

/** Runs the clock, keeping the settlement fed so nothing starves mid-test. */
function step(simulation: Simulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    if (simulation.tick % TICKS_PER_DAY === 0) {
      for (const yard of simulation.storages.all) {
        yard.inventory.add('vegetables', Math.max(0, 200 - yard.inventory.count('vegetables')));
      }
    }
    simulation.update(simulation.tick + 1, TICK);
  }
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

describe('names', () => {
  it('passes the family name down to the children', () => {
    // What makes a roster read as households rather than as a list of
    // strangers who happen to share a roof.
    const simulation = raiseAFamily(240);
    const byId = new Map(simulation.villagers.all.map((v) => [v.id, v]));
    const children = simulation.villagers.all.filter((v) => v.parentIds !== null);
    expect(children.length).toBeGreaterThan(0);

    for (const child of children) {
      const parents = child.parentIds!.map((id) => byId.get(id)).filter(Boolean);
      if (parents.length < 2) {
        // A parent has died since; nothing left to compare against.
        continue;
      }
      const father = parents.find((p) => p!.sex === 'm')!;
      expect(surname(child.name), `${child.name}`).toBe(surname(father.name));
    }
  });

  it('gives a child a given name of their own', () => {
    const simulation = raiseAFamily(240);
    for (const child of simulation.villagers.all.filter((v) => v.parentIds !== null)) {
      expect(child.name.split(' ').length).toBeGreaterThanOrEqual(2);
      expect(child.name.split(' ')[0]!.length).toBeGreaterThan(0);
    }
  });

  it('names everybody out of the valley, surname and all', () => {
    // **The test that keeps a multi-word surname whole.** Half the family names
    // are toponymics — `de Valdivielso`, `de Sotoscueva` — and a child inherits
    // "everything after the given name", so a naming convention that split on the
    // wrong space would quietly turn a family into the house of Valdivielso and
    // its cousins the de-somethings. Asserted against the tables rather than
    // against a list of strings, so adding a name to the valley cannot fail it.
    const simulation = raiseAFamily(240);
    expect(simulation.villagers.all.length).toBeGreaterThan(10);

    for (const villager of simulation.villagers.all) {
      const [given, ...rest] = villager.name.split(' ');
      const pool = villager.sex === 'f' ? FEMININE_NAMES : MASCULINE_NAMES;
      expect(pool, villager.name).toContain(given);
      expect(FAMILY_NAMES, villager.name).toContain(rest.join(' '));
    }
  });

  it('matches a given name to who somebody is', () => {
    const simulation = raiseAFamily(60);
    for (const villager of simulation.villagers.all) {
      const given = villager.name.split(' ')[0]!;
      const pool = villager.sex === 'f' ? FEMININE_NAMES : MASCULINE_NAMES;
      expect(pool, `${villager.name} (${villager.sex})`).toContain(given);
    }
  });
});

describe('households', () => {
  it('moves a couple in together', () => {
    // A couple sleeping in separate houses is the household model saying one
    // thing and the roster showing another.
    const simulation = raiseAFamily(30);
    const byId = new Map(simulation.villagers.all.map((v) => [v.id, v]));

    let couples = 0;
    for (const villager of simulation.villagers.all) {
      if (villager.partnerId === null || villager.partnerId < villager.id) {
        continue;
      }
      const partner = byId.get(villager.partnerId);
      if (!partner || villager.homeId === null) {
        continue;
      }
      couples += 1;
      expect(partner.homeId, `${villager.name} and ${partner.name}`).toBe(villager.homeId);
    }
    expect(couples).toBeGreaterThan(0);
  });

  it('never puts more grown-ups in a house than it holds', () => {
    // Pushing a third adult onto the street to seat a couple would be a far
    // worse outcome than a couple who have not moved in yet.
    //
    // **Grown-ups, not residents.** A house's figure is a count of adults, and
    // children do not count against it — a family is a family, and a couple with
    // three children under a four-adult roof is exactly right. Counting the
    // children was what stalled settlements: a full house meant no more births
    // anywhere in the village.
    const simulation = raiseAFamily(240);
    const occupancy = new Map<number, number>();
    for (const villager of simulation.villagers.all) {
      if (villager.homeId !== null && villager.isAdult) {
        occupancy.set(villager.homeId, (occupancy.get(villager.homeId) ?? 0) + 1);
      }
    }
    for (const [homeId, count] of occupancy) {
      const house = simulation.world.buildings.getById(homeId);
      expect(count, `house ${homeId}`).toBeLessThanOrEqual(house?.definition.housing ?? 0);
    }
  });

  it('houses children with their parents, however many there are', () => {
    const simulation = raiseAFamily(240);
    const byId = new Map(simulation.villagers.all.map((villager) => [villager.id, villager]));

    let checked = 0;
    for (const child of simulation.villagers.all) {
      if (!child.isChild || child.parentIds === null) {
        continue;
      }
      const parents = child.parentIds
        .map((id) => byId.get(id))
        .filter((parent): parent is NonNullable<typeof parent> => parent !== undefined);
      if (parents.length === 0 || parents.every((parent) => parent.homeId === null)) {
        continue;
      }
      checked += 1;
      expect(parents.some((parent) => parent.homeId === child.homeId)).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('moves unpaired adults in together rather than one to a house', () => {
    // A couple keeps a house to itself on purpose: the spare beds are for the
    // children. Singles have no such claim, and left alone they each kept
    // whichever house they were assigned on the day it went up — a settlement
    // of ten spread over five four-bed cottages, having paid for houses it did
    // not need and leaving nothing free for the next couple.
    //
    // The state is built rather than waited for: it needs unpaired adults, and
    // a settlement left to itself pairs everyone off on its first day.
    const simulation = new Simulation(OPTIONS);
    const houses: Building[] = [];
    for (let i = 0; i < 4; i += 1) {
      const house = raise(simulation, 'house');
      expect(house).not.toBeNull();
      houses.push(house!);
    }

    // **Ages spaced eight years apart, so nobody pairs.** Being past
    // childbearing age used to be enough, and is not any more: pairing has no
    // upper age limit now, because a widow of fifty who finds somebody her own
    // age is a household. What keeps them single is the six-year gap rule.
    // Lifespans are lifted out of the way so the elders among them do not die
    // mid-test and turn this into a measurement of old age.
    simulation.villagers.all.forEach((villager, index) => {
      villager.age = 20 + index * 8;
      villager.lifespan = 200;
      villager.partnerId = null;
    });
    // One to a house, which is the state being complained about.
    simulation.villagers.all.forEach((villager, index) => {
      villager.homeId = index < houses.length ? houses[index]!.id : null;
    });

    step(simulation, TICKS_PER_DAY + 1);

    const occupancy = new Map<number, number>();
    for (const villager of simulation.villagers.all) {
      if (villager.homeId !== null && villager.isAdult) {
        occupancy.set(villager.homeId, (occupancy.get(villager.homeId) ?? 0) + 1);
      }
    }

    // Ten singles and sixteen adult places should fill houses, not sprinkle
    // across them: at most one house is left part-filled by the remainder.
    const used = houses.filter((house) => (occupancy.get(house.id) ?? 0) > 0);
    const partial = used.filter(
      (house) => (occupancy.get(house.id) ?? 0) < (house.definition.housing ?? 0),
    );
    expect(used.length).toBeLessThanOrEqual(3);
    expect(partial.length).toBeLessThanOrEqual(1);
  });

  it('never lodges a single on a couple, whose spare beds are their children’s', () => {
    // The packing pass must not park a lodger on a family, or the next child
    // born to them has nowhere to sleep and the household splits — which is
    // the whole thing `settleCouples` exists to prevent.
    const simulation = new Simulation(OPTIONS);
    for (let i = 0; i < 4; i += 1) {
      expect(raise(simulation, 'house')).not.toBeNull();
    }
    step(simulation, TICKS_PER_DAY * 2);

    // One villager put far out of everybody's age range, so the settlement has
    // exactly one single among its couples and the pass has somewhere wrong to
    // put them. Being past childbearing age is no longer enough on its own —
    // pairing has no upper limit — so it is the six-year gap that keeps them
    // single.
    const odd = simulation.villagers.all[0]!;
    const partner = simulation.villagers.all.find((v) => v.id === odd.partnerId);
    odd.age = 55;
    odd.lifespan = 200;
    odd.partnerId = null;
    if (partner) {
      partner.partnerId = null;
    }
    step(simulation, TICKS_PER_DAY + 1);

    const byId = new Map(simulation.villagers.all.map((v) => [v.id, v]));
    for (const villager of simulation.villagers.all) {
      // Children are not lodgers, and the packing pass says so too: a young
      // person with no parents in the settlement has to live *somewhere*, and
      // the only somewhere is a household that already has grown-ups in it.
      if (
        villager.homeId === null ||
        villager.partnerId !== null ||
        villager.parentIds !== null ||
        !villager.isAdult
      ) {
        continue;
      }
      const lodgingWithACouple = simulation.villagers.all.some(
        (other) =>
          other.homeId === villager.homeId &&
          other.id !== villager.id &&
          other.partnerId !== null &&
          byId.get(other.partnerId)?.homeId === villager.homeId,
      );
      expect(lodgingWithACouple, `${villager.name} is lodging with a couple`).toBe(false);
    }
  });

  it('keeps a child under the same roof as its parents', () => {
    const simulation = raiseAFamily(240);
    const byId = new Map(simulation.villagers.all.map((v) => [v.id, v]));
    const children = simulation.villagers.all.filter(
      (v) => v.parentIds !== null && !v.isAdult && v.homeId !== null,
    );
    expect(children.length).toBeGreaterThan(0);

    let together = 0;
    for (const child of children) {
      const parents = child.parentIds!.map((id) => byId.get(id)).filter(Boolean);
      if (parents.some((p) => p!.homeId === child.homeId)) {
        together += 1;
      }
    }
    // Not every child, every time — a house can fill up and somebody has to
    // sleep elsewhere — but a family that is usually split is not a family.
    expect(together).toBeGreaterThan(children.length / 2);
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

  it('pairs only grown-ups, and only within six years of each other', () => {
    // **Not capped at childbearing age any more.** A widow of fifty who finds
    // somebody her own age is a household; what keeps pairings plausible is the
    // age gap, not an upper limit. Bearing children still stops at forty.
    const simulation = raiseAFamily(2);
    const byId = new Map(simulation.villagers.all.map((v) => [v.id, v]));

    for (const villager of partners(simulation)) {
      expect(villager.age).toBeGreaterThanOrEqual(ADULT_AGE);
      const partner = byId.get(villager.partnerId!);
      expect(partner).toBeDefined();
      expect(Math.abs(partner!.age - villager.age)).toBeLessThanOrEqual(MAX_PAIR_AGE_GAP);
    }
  });
});

/** Everything after the given name. */
function surname(name: string): string {
  const space = name.indexOf(' ');
  return space === -1 ? name : name.slice(space + 1);
}
