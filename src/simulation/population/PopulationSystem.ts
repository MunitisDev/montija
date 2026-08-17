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
  ADULT_AGE,
  BIRTH_CHANCE_PER_DAY,
  BIRTH_REQUIREMENTS,
  CHILDBEARING_AGE_MAX,
  CHILDBEARING_AGE_MIN,
  ILL_DAYS_PER_YEAR_LOST,
  IMMIGRANTS_PER_ARRIVAL,
  IMMIGRATION_CHANCE_PER_DAY,
  IMMIGRATION_REQUIREMENTS,
  LIFESPAN_MAX,
  LIFESPAN_MIN,
  MAX_PAIR_AGE_GAP,
} from '@/data/population';
import { DAYS_PER_YEAR } from '@/simulation/seasons/SeasonClock';
import type { Building } from '@/simulation/buildings/Building';
import type { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';
import type { SeededRandom } from '@/shared/math/random';
import type { Villager } from '@/simulation/villagers/Villager';

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
  readonly born: {
    readonly home: Building;
    readonly parents: readonly [number, number];
    /** The family name the child is given, from its father. */
    readonly familyName: string;
  }[];
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
  settleCouples(survivors, houses);
  // Last, so it packs whatever the couples left behind rather than being
  // undone by them a line later.
  gatherSingles(survivors, houses);

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

  // Adult places, and adults filling them: a newcomer needs a grown-up's place,
  // and a household's children were never taking one.
  const capacity = houses.reduce((total, house) => total + adultCapacityOf(house), 0);
  const spare =
    capacity - villagers.filter((villager) => villager.homeId !== null && villager.isAdult).length;
  if (spare < IMMIGRATION_REQUIREMENTS.spareHousing) {
    return 0;
  }

  if (random.next() >= IMMIGRATION_CHANCE_PER_DAY) {
    return 0;
  }

  return Math.min(IMMIGRANTS_PER_ARRIVAL, spare);
}

/**
 * Everything after the given name.
 *
 * Names are generated as "Given Family", so the family name is whatever
 * follows the first space. Crude, and correct for every name this game makes;
 * a name with no space at all falls back to itself rather than to an empty
 * string, so a child is never born surnameless.
 */
function familyNameOf(villager: Villager): string {
  const space = villager.name.indexOf(' ');
  return space === -1 ? villager.name : villager.name.slice(space + 1);
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

  // **No upper age limit, because widowhood has no upper age limit.** Bearing
  // children does — see `considerBirths` — but a widow of fifty who finds
  // somebody her own age is a household, and refusing to model it left every
  // survivor of a long marriage alone for the rest of their life.
  const eligible = (villager: Villager): boolean =>
    villager.partnerId === null && villager.age >= ADULT_AGE;

  // Two queues rather than one list paired off in order: a couple is one of
  // each. A settlement founded lopsided therefore makes fewer couples and grows
  // more slowly, which is a real consequence of its seed rather than a bug.
  const women = villagers.filter((v) => eligible(v) && v.sex === 'f').sort((a, b) => a.id - b.id);
  const men = villagers.filter((v) => eligible(v) && v.sex === 'm').sort((a, b) => a.id - b.id);

  // **Closest in age, within six years.** Matching the two queues off by id was
  // what this did before, and the id order is arrival order — so it would marry
  // a nineteen year old to a forty year old purely because that was the order
  // they turned up in. Nearest-age is both plausible and stable: candidates are
  // taken in id order and ties break on the lower id, so a settlement replayed
  // from its seed forms exactly the same households.
  const taken = new Set<number>();
  let pairs = 0;

  for (const woman of women) {
    let best: Villager | null = null;
    let bestGap = Number.POSITIVE_INFINITY;

    for (const man of men) {
      if (taken.has(man.id)) {
        continue;
      }
      const gap = Math.abs(man.age - woman.age);
      if (gap > MAX_PAIR_AGE_GAP) {
        continue;
      }
      if (gap < bestGap || (gap === bestGap && best !== null && man.id < best.id)) {
        best = man;
        bestGap = gap;
      }
    }

    if (!best) {
      continue;
    }
    taken.add(best.id);
    woman.partnerId = best.id;
    best.partnerId = woman.id;
    pairs += 1;
  }

  return pairs;
}

/**
 * Moves new couples in together.
 *
 * A couple sleeping in separate houses is the household model saying one thing
 * and the roster showing another, and it is the reason a family could not be
 * read off the settlement at a glance.
 *
 * The order of preference is deliberate and is the one a player asked for: **his
 * house**, then **a house standing empty**, then hers, then anywhere with room
 * for the two of them. An empty house ranks above hers because a new household
 * taking an empty cottage is both what happens and what spreads a growing
 * settlement across the houses it has built.
 *
 * Nobody is ever moved into a house that cannot hold them: capacity is counted
 * without the couple themselves, so a pair already living apart in two full
 * houses simply stays put until something frees up. Getting that wrong would
 * push a third person onto the street to make room, which is a far worse
 * outcome than a couple who have not moved in yet.
 */
function settleCouples(villagers: readonly Villager[], houses: readonly Building[]): void {
  if (houses.length === 0) {
    return;
  }

  const byId = new Map(villagers.map((villager) => [villager.id, villager]));
  // Adults only: a house's capacity is a count of grown-ups, and a family's own
  // children must never be the reason their parents cannot live together.
  const occupancy = new Map<number, number>();
  for (const villager of villagers) {
    if (villager.homeId !== null && villager.isAdult) {
      occupancy.set(villager.homeId, (occupancy.get(villager.homeId) ?? 0) + 1);
    }
  }

  const capacityOf = adultCapacityOf;

  // Who else is under each roof, so a couple can tell a household from a
  // dormitory. Children do not count: a couple sharing with their own children
  // is a family, and moving out to escape them would be absurd.
  const otherAdultsIn = (houseId: number, couple: readonly Villager[]): number =>
    villagers.filter(
      (resident) => resident.homeId === houseId && resident.isAdult && !couple.includes(resident),
    ).length;

  for (const woman of villagers) {
    // Each couple considered once, from the woman, so a pair is not moved
    // twice in opposite directions on the same day.
    if (woman.sex !== 'f' || woman.partnerId === null) {
      continue;
    }
    const man = byId.get(woman.partnerId);
    if (!man) {
      continue;
    }
    const pair = [woman, man];

    // Already a household of their own: nothing to do.
    if (
      woman.homeId !== null &&
      man.homeId === woman.homeId &&
      otherAdultsIn(woman.homeId, pair) === 0
    ) {
      continue;
    }

    const roomFor = (house: Building): boolean => {
      const taken =
        (occupancy.get(house.id) ?? 0) -
        (woman.homeId === house.id ? 1 : 0) -
        (man.homeId === house.id ? 1 : 0);
      return taken + 2 <= capacityOf(house);
    };

    // **A house should be a household, not a dormitory.** Two unrelated couples
    // filling a four-bed cottage was the state this arrived in, and it meant a
    // child born to either of them had nowhere to sleep but a different house —
    // so families were split across the settlement from the day they started.
    // A couple therefore only settles somewhere without other adults in it.
    const ownable = (house: Building | undefined | null): boolean =>
      house !== undefined &&
      house !== null &&
      roomFor(house) &&
      otherAdultsIn(house.id, pair) === 0;

    const hisHouse = man.homeId === null ? null : houses.find((h) => h.id === man.homeId);
    const herHouse = woman.homeId === null ? null : houses.find((h) => h.id === woman.homeId);
    const empty = houses.filter((house) => (occupancy.get(house.id) ?? 0) === 0);

    const destination =
      // His house first, then one standing empty, then hers — the order a
      // player asked for, with an empty cottage ahead of hers because a new
      // household taking one is both what happens and what spreads a growing
      // settlement across the houses it has built.
      [hisHouse, ...empty, herHouse].find((house) => ownable(house)) ??
      houses.find((house) => ownable(house)) ??
      // Nowhere of their own to be had. Sharing beats sleeping apart, and
      // beats sleeping outside by a great deal more.
      (woman.homeId === man.homeId ? null : houses.find((house) => roomFor(house)));
    if (!destination) {
      continue;
    }

    for (const person of [woman, man]) {
      if (person.homeId === destination.id) {
        continue;
      }
      if (person.homeId !== null) {
        occupancy.set(person.homeId, (occupancy.get(person.homeId) ?? 1) - 1);
      }
      person.homeId = destination.id;
      occupancy.set(destination.id, (occupancy.get(destination.id) ?? 0) + 1);
    }
  }
}

/**
 * Moves unpaired adults in together.
 *
 * A couple takes a house to themselves on purpose — the two spare beds are for
 * the children they are going to have, and a household split across two roofs
 * is the thing `settleCouples` exists to prevent. Unpaired adults have no such
 * claim. Left alone they each kept whichever house they were assigned on the
 * day it was built, so a settlement of ten could end up spread across five
 * four-bed cottages at half occupancy, having paid for two houses it did not
 * need and leaving nothing free for the next couple.
 *
 * So singles are pulled together into as few houses as possible: filled houses
 * first, and never into one a couple has to themselves. What that frees is a
 * whole house, which is the point.
 *
 * Deliberately not applied to children, who live where their parents do.
 */
function gatherSingles(villagers: readonly Villager[], houses: readonly Building[]): void {
  if (houses.length === 0) {
    return;
  }

  const occupancy = new Map<number, number>();
  const couplesIn = new Set<number>();
  for (const villager of villagers) {
    if (villager.homeId === null || !villager.isAdult) {
      continue;
    }
    occupancy.set(villager.homeId, (occupancy.get(villager.homeId) ?? 0) + 1);
    if (villager.partnerId !== null) {
      couplesIn.add(villager.homeId);
    }
  }

  // A grown child still living with their parents is not a lodger — they were
  // born there, and turning them out the day they came of age would be the
  // opposite of the household this pass exists to protect.
  const bornInto = (villager: Villager): boolean =>
    villager.parentIds !== null &&
    villagers.some(
      (other) => villager.parentIds!.includes(other.id) && other.homeId === villager.homeId,
    );

  const singles = villagers.filter(
    (villager) =>
      villager.isAdult &&
      villager.partnerId === null &&
      villager.homeId !== null &&
      !bornInto(villager),
  );

  for (const single of singles) {
    // The fullest house that still has room and no household of its own. Ties
    // break on the lower id so the pass is deterministic, which every part of
    // this simulation has to be.
    const destination = houses
      .filter((house) => {
        if (couplesIn.has(house.id) || house.id === single.homeId) {
          return false;
        }
        return (occupancy.get(house.id) ?? 0) < adultCapacityOf(house);
      })
      .sort((a, b) => {
        const byRoom = (occupancy.get(b.id) ?? 0) - (occupancy.get(a.id) ?? 0);
        return byRoom !== 0 ? byRoom : a.id - b.id;
      })[0];

    // Two reasons to move, and only two.
    //
    // **Lodging on a family.** A couple's spare beds are their children's, so a
    // single who ended up under their roof leaves if there is anywhere else to
    // go — otherwise the next child born there has nowhere to sleep.
    //
    // **Filling a house rather than half-filling two.** Otherwise this is
    // shuffling people between beds for no reason.
    const here = occupancy.get(single.homeId!) ?? 0;
    const lodging = couplesIn.has(single.homeId!);
    if (!destination || (!lodging && (occupancy.get(destination.id) ?? 0) < here)) {
      continue;
    }

    occupancy.set(single.homeId!, here - 1);
    single.homeId = destination.id;
    occupancy.set(destination.id, (occupancy.get(destination.id) ?? 0) + 1);
  }
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
    if (villager.age >= expectedLifespan(villager)) {
      died.push(villager);
    }
  }

  return died;
}

/**
 * How long this villager will actually live.
 *
 * The span rolled at birth, less a year for every stretch of illness they got
 * through. **This is the whole return on a Healer's House**: a healer shortens
 * cases, shorter cases cost fewer years, and the settlement's life expectancy is
 * therefore something the player builds rather than something the seed decides.
 *
 * Exported because it is the honest answer to "how long will this person live?"
 * and the roster and ledger should quote it rather than the raw roll.
 */
export function expectedLifespan(villager: Villager): number {
  return villager.lifespan - Math.floor(villager.illDaysLived / ILL_DAYS_PER_YEAR_LOST);
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
    capacity.set(house.id, adultCapacityOf(house));
  }

  // **Children live with their parents, and never against the count.** A house
  // holds four grown-ups and as many of their children as they have: a family
  // is a family, and turning the fifth child out into the snow — or, as it
  // actually happened, refusing to have one at all — is not what a house is for.
  //
  // Done before anything else so a child never loses their place to an adult.
  const byId = new Map(villagers.map((villager) => [villager.id, villager]));
  for (const villager of villagers) {
    if (!villager.isChild || villager.parentIds === null) {
      continue;
    }
    const parentHome = villager.parentIds
      .map((id) => byId.get(id))
      .find((parent) => parent !== undefined && parent.homeId !== null)?.homeId;
    if (parentHome !== undefined && parentHome !== null) {
      villager.homeId = parentHome;
    }
  }

  // Keep existing homes first, so nobody is shuffled between houses for no
  // reason — and so the household a child was born into stays that household.
  for (const villager of villagers) {
    if (villager.homeId === null || !villager.isAdult) {
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
    // **A child with nobody to follow still needs a roof.** Orphaned, or one of
    // the young people who walked in with the founding party and has no parents
    // here at all. They take no adult place, so the only question is which
    // household — and the answer is the emptiest, so they spread across the
    // settlement instead of all crowding into whichever house was built first.
    if (villager.isChild) {
      const quietest = [...houses].sort((a, b) => {
        const byResidents = residents(villagers, a.id) - residents(villagers, b.id);
        return byResidents !== 0 ? byResidents : a.id - b.id;
      })[0];
      if (quietest) {
        villager.homeId = quietest.id;
      }
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
 * How many grown-ups a house holds.
 *
 * The `housing` figure in the building data means **adults**, not residents. It
 * used to mean residents, and that is what stalled settlements: a couple with
 * two children filled a four-bed cottage, so the birth check found no spare bed
 * anywhere in the village and the population stopped dead. A player reported it
 * as "it has settled at twenty people".
 */
function adultCapacityOf(house: Building): number {
  return house.definition.housing ?? 0;
}

/** Everybody under a roof, children included — for spreading orphans out. */
function residents(villagers: readonly Villager[], houseId: number): number {
  return villagers.filter((villager) => villager.homeId === houseId).length;
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
}): { home: Building; parents: readonly [number, number]; familyName: string }[] {
  const { villagers, houses, random, foodDaysPerPerson } = options;

  if (foodDaysPerPerson < BIRTH_REQUIREMENTS.foodDaysPerPerson) {
    return [];
  }
  if (houses.length === 0) {
    return [];
  }

  // **The childbearing window is the mother's.** Both parents must be well and
  // off cooldown, and only she has an age range — applying it to both retired a
  // couple the moment either of them aged out, so a woman of thirty stopped
  // having children because her husband turned forty-one.
  const wellEnough = (villager: Villager): boolean =>
    villager.needs.health >= BIRTH_REQUIREMENTS.minimumHealth && villager.birthCooldownDays <= 0;

  const canBear = (villager: Villager): boolean =>
    villager.sex === 'f' &&
    villager.age >= CHILDBEARING_AGE_MIN &&
    villager.age <= CHILDBEARING_AGE_MAX &&
    wellEnough(villager);

  const canFather = (villager: Villager): boolean => villager.isAdult && wellEnough(villager);

  const byId = new Map(villagers.map((villager) => [villager.id, villager]));

  // **Every couple gets its own chance, and that is the fix to a stalled
  // settlement.** This used to take the first ready couple in the village and
  // roll once for the whole settlement, so growth was capped near two children a
  // year however many households there were — a player watched their population
  // sit at twenty for years with workshops standing empty. A settlement of eight
  // couples should grow four times as fast as a settlement of two, because it is
  // four times as many families.
  //
  // Taken in id order so the run of random draws is fixed by the seed, which is
  // what keeps a settlement's history reproducible.
  // Considered from the mother, which also means each couple is considered
  // exactly once without needing an id comparison to deduplicate them.
  const mothers = villagers
    .filter((villager) => {
      if (villager.partnerId === null || !canBear(villager)) {
        return false;
      }
      const partner = byId.get(villager.partnerId);
      return partner !== undefined && canFather(partner);
    })
    .sort((a, b) => a.id - b.id);

  const born: { home: Building; parents: readonly [number, number]; familyName: string }[] = [];

  for (const mother of mothers) {
    const partner = byId.get(mother.partnerId!)!;

    // A household needs a roof of its own to raise a child under. There is no
    // bed to count any more — a house holds its family's children without limit
    // — so what is required is simply that the parents have a home.
    const home =
      houses.find((house) => house.id === mother.homeId || house.id === partner.homeId) ?? null;
    if (!home) {
      continue;
    }

    // One roll per couple per day. `random` is the seeded stream, never
    // Math.random, so a settlement's history is reproducible from its seed.
    if (random.next() >= BIRTH_CHANCE_PER_DAY) {
      continue;
    }

    mother.birthCooldownDays = BIRTH_REQUIREMENTS.cooldownDays;
    partner.birthCooldownDays = BIRTH_REQUIREMENTS.cooldownDays;

    // The child carries the father's family name. A convention rather than a
    // rule of the world, chosen so a household reads as one family — and the
    // same convention as the couple moving into his house, so the two agree.
    const father = partner;

    born.push({
      home,
      parents: [Math.min(mother.id, partner.id), Math.max(mother.id, partner.id)] as const,
      familyName: familyNameOf(father),
    });
  }

  return born;
}
