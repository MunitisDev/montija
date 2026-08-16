/**
 * Difficulty tests: does the first winter behave as the game intends?
 *
 * The MVP objective is SURVIVE THE FIRST WINTER, and the brief asks that winter
 * be capable of killing an unprepared settlement while poor planning has
 * consequences. Those are claims about outcomes a year long, which is exactly
 * what nobody can check by hand — a year is five minutes of watching at 1x, and
 * eyeballing it proves nothing. Headless, the same year runs in a fraction of a
 * second and is deterministic from its seed.
 *
 * These tests are therefore about the *shape* of the difficulty curve rather
 * than about particular numbers. They are written with slack, so that retuning
 * a recipe does not fail them, but a change that makes winter survivable by
 * doing nothing — or unsurvivable however well the player plays — does.
 */

import { describe, expect, it } from 'vitest';

import { STARTING_RESOURCES } from '@/app/config';
import { FOOD_PER_VILLAGER_PER_DAY } from '@/simulation/seasons/SurvivalSystem';
import {
  DAYS_PER_YEAR,
  buildNearby,
  countOf,
  designateNearbyStone,
  designateNearbyTrees,
  firstDayOf,
  ordered,
  playtest,
  type PlayerScript,
} from './support/playtest';

const SEED = 20260815;

/** Does nothing at all. The settlement lives on what the settlers carried in. */
const idle: PlayerScript = () => {};

/** Gets a food supply going, and roofs, but only one hut for ten mouths. */
const oneHut: PlayerScript = (sim, day) => {
  if (day === 1) {
    designateNearbyTrees(sim, 40);
    designateNearbyStone(sim, 16);
  }
  if (day === 2 && !ordered(sim, 'gatherer-hut')) buildNearby(sim, 'gatherer-hut');
  if (day === 8 && !ordered(sim, 'woodcutter')) buildNearby(sim, 'woodcutter');
  if (day === 14 && !ordered(sim, 'food-storage')) buildNearby(sim, 'food-storage');
  // Three houses for ten villagers. Firewood warms a house, so a settlement
  // without them freezes however full its woodshed is.
  for (const built of [4, 6, 22]) {
    if (day === built && countOf(sim, 'house') < 3) buildNearby(sim, 'house');
  }
  if (day % 5 === 0) designateNearbyTrees(sim, 25);
  if (day % 8 === 0) designateNearbyStone(sim, 6);
};

/** Leaves everything until midsummer, and never builds a second hut. */
const late: PlayerScript = (sim, day) => {
  if (day === 1) designateNearbyTrees(sim, 20);
  if (day === 15 && !ordered(sim, 'gatherer-hut')) {
    designateNearbyStone(sim, 10);
    buildNearby(sim, 'gatherer-hut');
  }
  if (day === 28 && !ordered(sim, 'woodcutter')) buildNearby(sim, 'woodcutter');
  if (day % 10 === 0) designateNearbyTrees(sim, 20);
};

/** Leaves it so long that the settlers' own supplies run out first. */
const tooLate: PlayerScript = (sim, day) => {
  if (day === 1) designateNearbyTrees(sim, 20);
  if (day === 25 && !ordered(sim, 'gatherer-hut')) {
    designateNearbyStone(sim, 10);
    buildNearby(sim, 'gatherer-hut');
  }
  if (day % 10 === 0) designateNearbyTrees(sim, 20);
};

/** One more hut than the marginal settlement, and nothing else different. */
const twoHuts: PlayerScript = (sim, day) => {
  if (day === 12 && countOf(sim, 'gatherer-hut') < 2) {
    buildNearby(sim, 'gatherer-hut');
    return;
  }
  oneHut(sim, day);
};

/**
 * Plays it properly: enough huts for ten mouths, and a larder to keep what
 * they gather.
 */
const prepared: PlayerScript = (sim, day) => {
  if (day === 1) {
    designateNearbyTrees(sim, 40);
    designateNearbyStone(sim, 20);
  }
  if (day === 2 && !ordered(sim, 'gatherer-hut')) buildNearby(sim, 'gatherer-hut');
  if (day === 8 && !ordered(sim, 'woodcutter')) buildNearby(sim, 'woodcutter');
  if (day === 12 && countOf(sim, 'gatherer-hut') < 2) buildNearby(sim, 'gatherer-hut');
  if (day === 16 && countOf(sim, 'gatherer-hut') < 3) buildNearby(sim, 'gatherer-hut');
  if (day === 20 && !ordered(sim, 'food-storage')) buildNearby(sim, 'food-storage');
  for (const built of [4, 6, 24]) {
    if (day === built && countOf(sim, 'house') < 3) buildNearby(sim, 'house');
  }
  if (day % 5 === 0) designateNearbyTrees(sim, 25);
  if (day % 8 === 0) designateNearbyStone(sim, 8);
};

/** Everything the prepared player does, except raising a single roof. */
const noHouses: PlayerScript = (sim, day) => {
  if (day === 4 || day === 6 || day === 24) {
    return;
  }
  prepared(sim, day);
};

/** Exactly the same, but never builds anywhere to keep the food. */
const noLarder: PlayerScript = (sim, day) => {
  if (day === 20) {
    return;
  }
  prepared(sim, day);
};

function runYear(script: PlayerScript) {
  return playtest({ seed: SEED, days: DAYS_PER_YEAR, script });
}

describe('the first winter', () => {
  it('kills a settlement that does nothing', () => {
    const result = runYear(idle);
    expect(result.survivors).toBe(0);
    expect(result.deaths).toBe(10);
  });

  it('gives a do-nothing settlement time to notice before it dies', () => {
    // The settlers' supplies must outlast the time it takes to see the problem
    // and raise a hut, or the opening is unwinnable rather than difficult.
    const result = runYear(idle);
    const grace = STARTING_RESOURCES.food / (10 * FOOD_PER_VILLAGER_PER_DAY);
    expect(grace).toBeGreaterThanOrEqual(10);
    expect(result.firstDeathDay).toBeGreaterThan(grace + 8);
  });

  it('kills a settlement that leaves its food supply too long', () => {
    const result = runYear(tooLate);
    expect(result.deaths).toBeGreaterThan(0);
  });

  it('kills a late start during the winter itself', () => {
    // Starting at midsummer leaves no room for both a food supply and shelter,
    // and it is winter that collects the debt.
    const result = runYear(late);
    expect(result.deaths).toBeGreaterThan(0);
    expect(result.firstDeathDay).toBeGreaterThanOrEqual(firstDayOf('winter'));
  });

  it('is survived by a settlement that feeds itself properly', () => {
    const result = runYear(prepared);
    expect(result.deaths).toBe(0);
    // At least the ten it started with. More is a success, not a failure: a
    // settlement with food to spare and a bed going begging has a child, and
    // asserting an exact count made growth look like a regression.
    expect(result.survivors).toBeGreaterThanOrEqual(10);
  });

  it('starves a settlement that builds one hut for ten mouths', () => {
    // One hut cannot feed ten, and since villagers took posts rather than
    // drifting to whatever was nearest, it cannot *nearly* feed ten either:
    // two of the ten are committed to the hut and two more to the woodcutter,
    // and the six left over cannot gather. This is the cost the player is now
    // able to decide about, and it bites before winter even arrives.
    const result = runYear(oneHut);
    expect(result.deaths).toBeGreaterThan(0);
    expect(result.atWinter.food).toBe(0);
  });

  it('is scraped through by a second hut, and no more than scraped', () => {
    // The graded middle of the curve, and the reason the one-hut run above is
    // allowed to be fatal: the difference between dying and living is one
    // building, which is exactly the decision the game is asking for.
    const result = runYear(twoHuts);
    expect(result.deaths).toBe(0);
    // Alive, and with nothing to show for it — against 135 for the prepared
    // settlement. A soft landing has to stay something the player earns.
    expect(result.atWinter.food).toBeLessThan(60);
  });

  it('lets a prepared settlement bank food before the cold', () => {
    const result = runYear(prepared);
    // Not merely "some food": enough that stockpiling is a real strategy, and
    // a decent fraction of the 120 a winter costs ten villagers. The rest is
    // covered by what autumn's last harvests are still carrying in.
    expect(result.atWinter.food).toBeGreaterThan(60);
  });

  it('is far harder without somewhere to keep the food', () => {
    // The same player, playing the same way, minus the larder. Food rots in the
    // open yard, so roughly half of the autumn's work never reaches the cold.
    const withLarder = runYear(prepared);
    const without = runYear(noLarder);
    expect(without.atWinter.food).toBeLessThan(withLarder.atWinter.food * 0.75);
  });

  it('freezes a settlement that built no houses, however well stocked', () => {
    // Firewood warms a house. The same player, minus the roofs, loses everyone
    // to the cold with full yards — which is what makes a House worth raising.
    const result = runYear(noHouses);
    expect(result.deaths).toBeGreaterThan(0);
    expect(result.firstDeathDay).toBeGreaterThanOrEqual(firstDayOf('winter'));
  });

  it('makes winter draw down the stores it spent autumn filling', () => {
    const result = runYear(prepared);
    const winterDays = result.log.filter((day) => day.season === 'winter');
    const eaten = winterDays.reduce((total, day) => total + day.foodEaten, 0);
    // Winter forage yields nothing, so everything eaten came out of storage.
    expect(eaten).toBeGreaterThan(60);
    expect(winterDays.at(-1)!.food).toBeLessThan(result.atWinter.food + 40);
  });
});

describe('the food economy', () => {
  it('cannot feed ten villagers from a single hut', () => {
    const result = runYear(oneHut);
    const summer = result.log.filter((day) => day.season === 'summer');
    const madePerDay = summer.reduce((total, day) => total + day.foodEaten, 0) / summer.length;
    expect(madePerDay).toBeLessThan(10 * FOOD_PER_VILLAGER_PER_DAY);
  });

  it('produces a genuine surplus once the settlement builds enough huts', () => {
    const result = runYear(prepared);
    const autumn = result.log.filter((day) => day.season === 'autumn');
    const gained = autumn.at(-1)!.food - autumn[0]!.food;
    expect(gained).toBeGreaterThan(0);
  });

  it('yields nothing from foraging in winter', () => {
    const result = runYear(prepared);
    const winter = result.log.filter((day) => day.season === 'winter');
    const stockAtStart = winter[0]!.food + winter[0]!.looseFood;
    const stockAtEnd = winter.at(-1)!.food + winter.at(-1)!.looseFood;
    // Stock can only fall across winter: nothing is foraged and people eat.
    expect(stockAtEnd).toBeLessThan(stockAtStart);
  });
});

describe('workshops', () => {
  it('staffs every worker slot rather than only one', () => {
    // A two-slot hut once reserved the whole building, so half of it stood idle
    // and `workerSlots` described nothing.
    const result = playtest({
      seed: SEED,
      days: firstDayOf('autumn'),
      script: oneHut,
    });
    expect(result.maxConcurrentProduce).toBeGreaterThan(1);
  });
});
