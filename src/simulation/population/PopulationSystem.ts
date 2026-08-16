/**
 * Homes, ageing, births and old age.
 *
 * Runs once a day, with the rest of the settlement's accounting.
 *
 * Until this existed, a House was the third building in the game that cost
 * timber and did nothing: `housingCapacity` was computed, reported in the
 * snapshot, and read by nobody. It said "shelter for a family, keeps its
 * residents warm in winter" and neither half was true. `age` was likewise a
 * number that never changed, so a settlement could be played for a decade
 * without anybody growing a day older.
 *
 * What this adds is the loop the brief's core fantasy needs — "survive, grow
 * and prosper over many years":
 *
 * ```text
 * build houses ─▶ people have somewhere to live ─▶ households have children
 *      ▲                                                      │
 *      └────────── more mouths need more houses ◀─────────────┘
 * ```
 *
 * Growth is deliberately slow and deliberately conditional. A settlement that
 * cannot feed itself does not grow, because a child is another mouth for
 * fifteen years before it is another pair of hands, and a village growing
 * itself to death is not a decision the player made.
 */

import {
  BIRTH_CHANCE_PER_DAY,
  BIRTH_REQUIREMENTS,
  CHILDBEARING_AGE_MAX,
  CHILDBEARING_AGE_MIN,
  IMMIGRANTS_PER_ARRIVAL,
  IMMIGRATION_CHANCE_PER_DAY,
  IMMIGRATION_REQUIREMENTS,
  LIFESPAN_MAX,
  LIFESPAN_MIN,
} from '@/data/population';
import { DAYS_PER_SEASON } from '@/simulation/seasons/SeasonClock';
import type { Building } from '@/simulation/buildings/Building';
import type { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';
import type { SeededRandom } from '@/shared/math/random';
import type { Villager } from '@/simulation/villagers/Villager';

/** Days in a year, for ageing. Matches the calendar rather than guessing. */
const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;

export interface PopulationReport {
  readonly births: number;
  /** Newcomers who arrived from outside the settlement. */
  readonly arrivals: number;
  /** Villagers who died of old age, as distinct from starving or freezing. */
  readonly deathsOfOldAge: number;
  /** How many have no house to go back to. */
  readonly homeless: number;
  readonly children: number;
  readonly adults: number;
  /** Couples who paired up today. */
  readonly paired: number;
}

export const NO_POPULATION_CHANGE: PopulationReport = {
  births: 0,
  arrivals: 0,
  deathsOfOldAge: 0,
  homeless: 0,
  children: 0,
  adults: 0,
  paired: 0,
};

export interface PopulationDay {
  readonly report: PopulationReport;
  /** Villagers who died of old age, for the caller to remove. */
  readonly died: Villager[];
  /** Newborns, for the caller to place and name. */
  readonly born: { readonly home: Building; readonly parents: readonly [number, number] }[];
  /** How many strangers walked in today. */
  readonly arrivals: number;
}

/**
 * Runs a day of ageing, housing and births.
 *
 * Returns the newborns and the dead rather than mutating the population, so the
 * caller keeps ownership of who exists — spawning needs a name, a position and
 * an id, none of which are this system's business.
 */
export function runPopulationDay(options: {
  villagers: readonly Villager[];
  buildings: BuildingRegistry;
  random: SeededRandom;
  /** Days of food the settlement holds, per person. */
  foodDaysPerPerson: number;
}): PopulationDay {
  const { villagers, buildings, random, foodDaysPerPerson } = options;

  const died = ageEveryone(villagers);
  const survivors = villagers.filter((villager) => !died.includes(villager));

  const houses = [...buildings.all].filter(
    (building) => building.isComplete && (building.definition.housing ?? 0) > 0,
  );
  assignHomes(survivors, houses);
  const paired = formPairs(survivors);

  const born = considerBirths({ villagers: survivors, houses, random, foodDaysPerPerson });
  const arrivals = considerImmigration({ villagers: survivors, houses, random, foodDaysPerPerson });

  let homeless = 0;
  let children = 0;
  let adults = 0;
  for (const villager of survivors) {
    if (villager.homeId === null) {
      homeless += 1;
    }
    if (villager.isAdult) {
      adults += 1;
    } else {
      children += 1;
    }
  }

  return {
    report: {
      births: born.length,
      arrivals,
      deathsOfOldAge: died.length,
      homeless,
      children,
      adults,
      paired,
    },
    died,
    born,
    arrivals,
  };
}

/**
 * Decides whether anyone walks in from outside today.
 *
 * The settlement has to be visibly worth joining: real food in store and beds
 * standing empty. Stiffer than a birth on purpose — a family already living
 * here will take a chance that a stranger on the road will not.
 *
 * The cooldown is kept on the settlement rather than on a person, because there
 * is nobody yet to keep it on.
 */
function considerImmigration(options: {
  villagers: readonly Villager[];
  houses: readonly Building[];
  random: SeededRandom;
  foodDaysPerPerson: number;
}): number {
  const { villagers, houses, random, foodDaysPerPerson } = options;

  if (villagers.length === 0) {
    // Nobody left to have built anything, and no story left to continue.
    return 0;
  }
  if (foodDaysPerPerson < IMMIGRATION_REQUIREMENTS.foodDaysPerPerson) {
    return 0;
  }

  const capacity = houses.reduce((total, house) => total + (house.definition.housing ?? 0), 0);
  const spare = capacity - villagers.filter((villager) => villager.homeId !== null).length;
  if (spare < IMMIGRATION_REQUIREMENTS.spareHousing) {
    return 0;
  }

  if (random.next() >= IMMIGRATION_CHANCE_PER_DAY) {
    return 0;
  }

  return Math.min(IMMIGRANTS_PER_ARRIVAL, spare);
}

/** A lifespan for a newborn, or for a founding settler. */
export function rollLifespan(random: SeededRandom): number {
  return random.int(LIFESPAN_MIN, LIFESPAN_MAX + 1);
}

/**
 * Pairs up unattached adults, and breaks the pairs death has ended.
 *
 * A birth used to draw two eligible adults out of the settlement afresh every
 * time, so "the parents" were a different two people each day and there was
 * nothing about anybody worth showing. Pairs make a settlement a set of
 * households rather than a headcount, which is most of why watching one is
 * interesting at all.
 *
 * Deliberately **not** conditional on sharing a house. That was tried when
 * births were first written and produced no children at all across six
 * simulated years: whether the two people given the house with a spare bed
 * happened to both be of an age was a lottery, so a settlement could be sterile
 * because of the order beds were handed out. A pairing is a fact about two
 * people; the spare bed is checked when a child actually arrives.
 *
 * Deterministic: candidates are taken in id order and paired off in turn, so a
 * settlement replayed from its seed forms the same households.
 *
 * @returns how many pairs formed today
 */
function formPairs(villagers: readonly Villager[]): number {
  const byId = new Map<number, Villager>();
  for (const villager of villagers) {
    byId.set(villager.id, villager);
  }

  // Widowhood, first. A partner who died is still named on the survivor, and
  // leaving it there would keep them out of every future pairing for ever.
  for (const villager of villagers) {
    if (villager.partnerId !== null && !byId.has(villager.partnerId)) {
      villager.partnerId = null;
    }
  }

  const single = villagers
    .filter(
      (villager) =>
        villager.partnerId === null &&
        villager.age >= CHILDBEARING_AGE_MIN &&
        villager.age <= CHILDBEARING_AGE_MAX,
    )
    .sort((a, b) => a.id - b.id);

  let pairs = 0;
  for (let i = 0; i + 1 < single.length; i += 2) {
    const one = single[i]!;
    const other = single[i + 1]!;
    one.partnerId = other.id;
    other.partnerId = one.id;
    pairs += 1;
  }

  return pairs;
}

/**
 * Advances everyone by a day, returning those who reached the end of their life.
 *
 * Ageing is counted in days rather than applied on a yearly boundary, so a
 * settlement does not have every birthday at once and old age does not arrive
 * as an annual cull.
 */
function ageEveryone(villagers: readonly Villager[]): Villager[] {
  const died: Villager[] = [];

  for (const villager of villagers) {
    villager.daysSinceBirthday += 1;
    if (villager.daysSinceBirthday >= DAYS_PER_YEAR) {
      villager.daysSinceBirthday = 0;
      villager.age += 1;
    }
    if (villager.birthCooldownDays > 0) {
      villager.birthCooldownDays -= 1;
    }
    if (villager.age >= villager.lifespan) {
      died.push(villager);
    }
  }

  return died;
}

/**
 * Puts everyone who can be housed into a house.
 *
 * Re-checked daily rather than assigned once, because houses are built and
 * villagers die: a home freed by a death should be taken by someone sleeping
 * outside, without the player having to do anything.
 */
function assignHomes(villagers: readonly Villager[], houses: readonly Building[]): void {
  const capacity = new Map<number, number>();
  for (const house of houses) {
    capacity.set(house.id, house.definition.housing ?? 0);
  }

  // Keep existing homes first, so nobody is shuffled between houses for no
  // reason — and so the household a child was born into stays that household.
  for (const villager of villagers) {
    if (villager.homeId === null) {
      continue;
    }
    const room = capacity.get(villager.homeId);
    if (room === undefined || room <= 0) {
      villager.homeId = null;
      continue;
    }
    capacity.set(villager.homeId, room - 1);
  }

  for (const villager of villagers) {
    if (villager.homeId !== null) {
      continue;
    }
    for (const house of houses) {
      const room = capacity.get(house.id) ?? 0;
      if (room > 0) {
        villager.homeId = house.id;
        capacity.set(house.id, room - 1);
        break;
      }
    }
  }
}

/**
 * Decides whether the settlement takes on a child today.
 *
 * Needs a spare bed, two healthy adults of an age to raise one, and food in
 * store. All three are conditions the player controls, which is the point:
 * population is something a settlement earns rather than something that happens
 * to it.
 *
 * Deliberately judged across the whole settlement rather than per household.
 * Requiring both parents to share the *same* house sounded more faithful, and
 * measured over six simulated years it produced no children at all: the two
 * people who happened to be assigned the house with a spare bed were simply
 * never both of childbearing age, so growth was hostage to the order beds were
 * handed out. A settlement should not be sterile because of a rounding detail
 * in the housing list.
 */
function considerBirths(options: {
  villagers: readonly Villager[];
  houses: readonly Building[];
  random: SeededRandom;
  foodDaysPerPerson: number;
}): { home: Building; parents: readonly [number, number] }[] {
  const { villagers, houses, random, foodDaysPerPerson } = options;

  if (foodDaysPerPerson < BIRTH_REQUIREMENTS.foodDaysPerPerson) {
    return [];
  }

  const occupancy = new Map<number, number>();
  for (const villager of villagers) {
    if (villager.homeId !== null) {
      occupancy.set(villager.homeId, (occupancy.get(villager.homeId) ?? 0) + 1);
    }
  }

  const spare = houses.find(
    (house) => (occupancy.get(house.id) ?? 0) < (house.definition.housing ?? 0),
  );
  if (!spare) {
    return [];
  }

  // A couple, rather than any two adults who happen to qualify. Both have to
  // be well and both off cooldown, which is what makes a child something a
  // particular household had rather than a number the settlement went up by.
  const ready = (villager: Villager): boolean =>
    villager.age >= CHILDBEARING_AGE_MIN &&
    villager.age <= CHILDBEARING_AGE_MAX &&
    villager.needs.health >= BIRTH_REQUIREMENTS.minimumHealth &&
    villager.birthCooldownDays <= 0;

  const byId = new Map(villagers.map((villager) => [villager.id, villager]));
  const couple = villagers
    .filter((villager) => {
      if (villager.partnerId === null || villager.partnerId < villager.id) {
        // Each couple considered once, from the lower id, so a pair is not
        // examined twice and cannot have two children in a day.
        return false;
      }
      const partner = byId.get(villager.partnerId);
      return partner !== undefined && ready(villager) && ready(partner);
    })
    .sort((a, b) => a.id - b.id)[0];

  if (!couple) {
    return [];
  }

  // One roll a day for the settlement. `random` is the seeded stream, never
  // Math.random, so a settlement's history is reproducible from its seed.
  if (random.next() >= BIRTH_CHANCE_PER_DAY) {
    return [];
  }

  const partner = byId.get(couple.partnerId!)!;
  couple.birthCooldownDays = BIRTH_REQUIREMENTS.cooldownDays;
  partner.birthCooldownDays = BIRTH_REQUIREMENTS.cooldownDays;

  // The child joins its parents' household where there is room, and only falls
  // back to any spare bed when there is not — a newborn billeted across the
  // settlement from both its parents would make the family tree read as noise.
  const family = houses.find(
    (house) =>
      (house.id === couple.homeId || house.id === partner.homeId) &&
      (occupancy.get(house.id) ?? 0) < (house.definition.housing ?? 0),
  );

  return [
    {
      home: family ?? spare,
      parents: [Math.min(couple.id, partner.id), Math.max(couple.id, partner.id)] as const,
    },
  ];
}
