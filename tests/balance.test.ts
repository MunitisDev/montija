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
    //
    // Asserted as a measured number of days rather than derived from the stock,
    // because **the stock is not the grace period and it was misleading to
    // pretend otherwise.** Food rots at a tenth a day in an open yard, and the
    // beach yard is an open yard, so the starting pile decays as it is eaten:
    // raising it from 120 to 156 — thirty per cent, three and a half days of
    // rations — moved the first death by exactly *one* day. Anything spent on
    // the opening has to survive the night before it can help.
    const result = runYear(idle);
    expect(result.firstDeathDay).toBeGreaterThan(18);
  });

  it('loses most of the settlers salvaged food to the weather', () => {
    // Kept as a test because it is the least obvious thing about the opening and
    // the reason "just start them with more food" does not work. Ten a day is
    // eaten and a tenth of the remainder turns overnight, so the pile is gone in
    // about ten days however big it was.
    const result = runYear(idle);
    const firstTenDays = result.log.slice(0, 10);
    const eaten = firstTenDays.reduce((total, day) => total + day.foodEaten, 0);
    const spoiled = firstTenDays.reduce((total, day) => total + day.spoiledFood, 0);

    expect(spoiled).toBeGreaterThan(eaten * 0.5);
    // Ten days in, a stock that was meant to last fifteen is already spent.
    expect(firstTenDays.at(-1)!.food).toBe(0);
    expect(STARTING_RESOURCES.food / (10 * FOOD_PER_VILLAGER_PER_DAY)).toBeGreaterThan(15);
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

  it('is pushed back by a second hut, and only survived by a third', () => {
    // The graded middle of the curve, and the reason the one-hut run above is
    // allowed to be fatal: each hut buys real time, and somewhere in that
    // sequence is the settlement that lives.
    //
    // Asserted as an *ordering* rather than as "two huts survive". It used to
    // say that, and the claim was true only by a couple of days' margin — any
    // change that shifted the random streams tipped it over and the test
    // failed for reasons that had nothing to do with the change. What the game
    // actually promises is that more huts is monotonically better, and that a
    // properly fed settlement lives; both of those are stable.
    const one = runYear(oneHut);
    const two = runYear(twoHuts);
    const three = runYear(prepared);

    expect(one.deaths).toBeGreaterThan(0);
    expect(two.firstDeathDay ?? Infinity).toBeGreaterThan(one.firstDeathDay ?? 0);
    expect(three.deaths).toBe(0);
  });

  it('lets a prepared settlement bank food before the cold', () => {
    const result = runYear(prepared);
    // Not merely "some food": enough that stockpiling is a real strategy, and
    // a real fraction of the 120 a winter costs ten villagers. The rest is
    // covered by what autumn's last harvests are still carrying in.
    //
    // The bar came down from 60 when the settlers stopped arriving with
    // salvaged stone. A shipwreck's cargo is timber, so the first quarry has to
    // be found before anything permanent goes up, and the whole settlement runs
    // a few days later all year. It banks about 40 now rather than about 100 —
    // less comfortable, still clearly worth doing, and the difference between
    // this run and the ones that die is unchanged.
    expect(result.atWinter.food).toBeGreaterThan(30);
  });

  it('is far harder without somewhere to keep the food', () => {
    // The same player, playing the same way, minus the larder. Food rots in the
    // open yard, so roughly half of the autumn's work never reaches the cold.
    const withLarder = runYear(prepared);
    const without = runYear(noLarder);
    expect(without.atWinter.food).toBeLessThan(withLarder.atWinter.food * 0.75);
  });

  it('kills a settlement that built no houses, and not by cold', () => {
    // The same player, minus the roofs, loses everyone — which is what makes a
    // House worth raising. What is interesting is *how*, because it is no
    // longer what this test used to assert.
    //
    // It used to say they froze in winter with full yards. Measured now, they
    // starve in autumn with their warmth still at 100. The chain runs through
    // illness: sleeping rough makes somebody five times more likely to fall
    // ill, an ill villager does no work for eight days, and a settlement short
    // of hands cannot gather. Over thirty days the roofless run idles 19% of
    // the time against 12% for the same player with houses, and brings in 148
    // food against 231.
    //
    // That is a better reason to build houses than the old one, and it is
    // emergent rather than designed — so the test now describes it instead of
    // asserting a cause of death that has moved.
    const withRoofs = runYear(prepared);
    const without = runYear(noHouses);

    expect(without.deaths).toBeGreaterThan(0);
    expect(withRoofs.deaths).toBe(0);
    expect(without.firstDeathDay ?? Infinity).toBeLessThan(Infinity);
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
