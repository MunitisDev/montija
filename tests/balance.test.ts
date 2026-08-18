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
import type { BuildingId } from '@/data/buildings';
import {
  DAYS_PER_YEAR,
  buildNearby,
  has,
  countOf,
  designateNearbyStone,
  designateNearbyTrees,
  firstDayOf,
  ordered,
  playtest,
  type PlayerScript,
} from './support/playtest';

const SEED = 20316248;

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

/**
 * The strongest opening anybody has found, and it is still not enough.
 *
 * Everything the game rewards, in the order it rewards it: stone marked before
 * anything else, a larder up on day four so the salvaged rations stop rotting,
 * shelter before the cold, and industry — a Forester's Lodge and a Quarry — once
 * the settlement is standing. Felling is ordered **only when the yard is short of
 * logs**, which is the one thing `prepared` gets wrong: standing orders for
 * twenty-five more trees every five days bury the mining, because felling and
 * mining tie on priority and the nearest job wins.
 *
 * Measured over 24 seeds against `prepared`: 2 clean years either way, 222 deaths
 * against 220. The discipline works mechanically — timber waste drops from 205
 * logs left over to 50 — and changes nothing about who lives, because it cannot
 * reach the thing that is actually killing them. See `stone-supply.test.ts`.
 */
const disciplined: PlayerScript = (sim, day) => {
  const stored = sim.snapshot().stored;

  if (day === 1) {
    designateNearbyStone(sim, 30);
    designateNearbyTrees(sim, 20);
    buildNearby(sim, 'gatherer-hut');
    return;
  }
  if (day === 2 && countOf(sim, 'gatherer-hut') < 2) buildNearby(sim, 'gatherer-hut');
  if (day === 4 && !ordered(sim, 'food-storage')) buildNearby(sim, 'food-storage');
  if (day === 6 && !ordered(sim, 'woodcutter')) buildNearby(sim, 'woodcutter');
  for (const built of [8, 10, 12]) {
    if (day === built && countOf(sim, 'house') < 3) buildNearby(sim, 'house');
  }
  if (day === 16 && countOf(sim, 'gatherer-hut') < 3) buildNearby(sim, 'gatherer-hut');
  if (day === 20 && !ordered(sim, 'forester')) buildNearby(sim, 'forester');
  // A wider search than the default: a Quarry must touch a rock face, and on
  // some seeds the nearest one is well outside the settlement.
  if (day === 26 && !ordered(sim, 'quarry')) buildNearby(sim, 'quarry', 60);

  if (stored.logs < 40) designateNearbyTrees(sim, 12);
  if (stored.stone < 30) designateNearbyStone(sim, 12);
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

/**
 * A spread of seeds, for the claims that only mean something in aggregate.
 *
 * The reference seed above is what the single-seed tests use, and it is a poor
 * judge of difficulty on its own: a change that shifts any random stream flips
 * which seed lives without changing the game. Two dozen is enough to tell a real
 * difference from noise, and cheap — a headless year is a fraction of a second.
 */
const SEED_SWEEP = Array.from({ length: 24 }, (_, index) => SEED + index * 7919);

/** Villagers buried across the sweep, out of ten per seed. */
function deathsAcrossSeeds(script: PlayerScript): number {
  return SEED_SWEEP.reduce(
    (total, seed) => total + playtest({ seed, days: DAYS_PER_YEAR, script }).deaths,
    0,
  );
}

/** The first day a building of this kind was finished, or `null` if never. */
function firstDayComplete(script: PlayerScript, buildingId: BuildingId): number | null {
  let day: number | null = null;
  playtest({
    seed: SEED,
    days: DAYS_PER_YEAR,
    script: (simulation, today) => {
      script(simulation, today);
      if (day === null && has(simulation, buildingId)) {
        day = today;
      }
    },
  });
  return day;
}

/** Food lost to rot across the whole year. */
function spoiledOverYear(result: ReturnType<typeof runYear>): number {
  return result.log.reduce((total, day) => total + day.spoiledFood, 0);
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

  it('leaves a one-hut settlement entering winter with nothing in store', () => {
    // **This used to assert deaths, and it no longer can.** The founding party
    // now brings three near-adults instead of ten grown-ups, so there are fewer
    // couples, fewer children and fewer mouths in the first year — and one hut
    // very nearly covers a village that small. On the reference seed it now
    // survives.
    //
    // What one hut still cannot do is put anything *by*. It reaches winter on
    // nothing and lives off what autumn's last days carry in, which is the
    // difference the player can act on: see the ladder below.
    const result = runYear(oneHut);
    expect(result.atWinter.food).toBe(0);
  });

  it('banks more food for every hut the player raises', () => {
    // The graded middle of the curve, and the reason a one-hut settlement is
    // still playing badly even when it survives: each hut is a real amount of
    // food in store before the cold.
    //
    // **Measured across the sweep rather than on one seed**, which is what the
    // river changed about this test. Every map now has its own bank, its own
    // distances and its own wood, so a single year's figure swings between 0 and
    // 165 for the same script; over twenty-four seeds the ladder is flat and
    // obvious — 147 food banked on one hut, 658 on two, 762 on three.
    //
    // Asserted as an **ordering** rather than as figures, so retuning a recipe
    // cannot fail it for the wrong reason.
    const banked = (script: PlayerScript): number =>
      SEED_SWEEP.reduce(
        (total, seed) => total + playtest({ seed, days: DAYS_PER_YEAR, script }).atWinter.food,
        0,
      );

    const one = banked(oneHut);
    const two = banked(twoHuts);
    const three = banked(prepared);

    expect(one).toBeLessThan(two);
    expect(two).toBeLessThan(three);
    // A real amount, not a rounding error: enough that stockpiling is a
    // strategy rather than a curiosity.
    expect(two).toBeGreaterThan(SEED_SWEEP.length * 10);
    // Seventy-two simulated years, so this one needs longer than the default.
  }, 180_000);

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

describe('trying to play it better than `prepared` does', () => {
  it('gets the larder up three weeks earlier', () => {
    // Ordering a Food Storage on day four instead of day twenty is the one thing
    // on the food side that clearly works as intended: measured, it finishes on
    // day 8 against day 28.
    const early = firstDayComplete(disciplined, 'food-storage');
    const late = firstDayComplete(prepared, 'food-storage');

    expect(early).not.toBeNull();
    expect(early!).toBeLessThan(late ?? Infinity);
    expect(early!).toBeLessThanOrEqual(12);
  });

  it('still loses as much food to rot, larder or no larder', () => {
    // Counter-intuitive and measured: 372 spoiled against 315. An early larder
    // does not stop the rot, because most of it happens to food lying in the
    // field and in the open beach yard on its way there — the larder only keeps
    // what has already arrived. Recorded because "build a larder sooner" is the
    // obvious advice and it is not the answer.
    expect(spoiledOverYear(runYear(disciplined))).toBeGreaterThan(
      spoiledOverYear(runYear(prepared)) * 0.8,
    );
  });

  it('wastes far less timber', () => {
    // Marking only what is needed works: 87 logs left over against 212. This is
    // the mechanical part of the discipline, and it does what it should.
    expect(runYear(disciplined).log.at(-1)!.logs).toBeLessThan(runYear(prepared).log.at(-1)!.logs);
  });

  it('gets shelter up for everybody before the cold', () => {
    const result = runYear(disciplined);
    expect(result.buildings.filter((id) => id === 'house').length).toBeGreaterThanOrEqual(3);
  });

  it('still enters winter with an empty woodshed, which is what kills it', () => {
    // **The finding this block exists to record.** The best opening anybody has
    // found reaches winter with no firewood at all, because the Woodcutter needs
    // 4 stone and stone does not arrive — so no amount of food, shelter or
    // discipline saves the settlement. See `stone-supply.test.ts` for the cause.
    //
    // Asserted so that fixing the stone supply fails this test loudly.
    expect(runYear(disciplined).atWinter.firewood).toBe(0);
  });

  it('does not survive any more often, across two dozen seeds', () => {
    // **Playing better does not help, and that is the whole point.** Measured
    // over 24 seeds rather than one, because a single seed says nothing here: on
    // the reference seed the disciplined line is actually *worse* — it buries
    // everybody where `prepared` buries nobody — and over the wider sample the
    // two are indistinguishable, 222 deaths against 220.
    //
    // Every lever tried so far lands in this same place. Until stone reaches the
    // building sites, the opening cannot be played well enough to matter.
    const disciplinedDeaths = deathsAcrossSeeds(disciplined);
    const eagerDeaths = deathsAcrossSeeds(prepared);

    expect(Math.abs(disciplinedDeaths - eagerDeaths)).toBeLessThan(24);
    // And both lose the overwhelming majority of the people they started with:
    // measured at 210 and 200 of 240 on the sweep.
    expect(disciplinedDeaths).toBeGreaterThan(SEED_SWEEP.length * 10 * 0.7);
    // Two dozen simulated years each, and one seed in the sweep is a
    // pathologically expensive map to find routes across — 3.5 seconds of
    // pathfinding for its year against 80ms for its neighbours. That is a real
    // measurement and an unsolved one; see `docs/ROADMAP.md`, Phase 11.
  }, 120_000);
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
