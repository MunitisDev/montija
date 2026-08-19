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
  if (day === 7 && !ordered(sim, 'feller')) buildNearby(sim, 'feller');
  if (day === 10 && !ordered(sim, 'woodcutter')) buildNearby(sim, 'woodcutter');
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
  if (day === 26 && !ordered(sim, 'feller')) buildNearby(sim, 'feller');
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
  if (day === 7 && !ordered(sim, 'feller')) buildNearby(sim, 'feller');
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
  if (day === 5 && !ordered(sim, 'feller')) buildNearby(sim, 'feller');
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

/**
 * How many seeds the aggregate claims below are judged on.
 *
 * **Eight rather than one, and the reason is a bug this file hid for months.**
 * Every claim about `prepared` used to be asserted on the reference seed alone,
 * and that settlement survived its first winter by a hair — a single villager's
 * worth of firewood. Across a dozen worlds the same player was losing eight
 * settlements in twelve, so the suite was green while the game was not winnable.
 * Any change that shifted a random stream tipped the one lucky seed over and
 * looked like a regression it had not caused.
 *
 * Eight is a compromise with the clock: a year of simulation costs a few seconds,
 * and these runs are memoised so each script is played once however many claims
 * read it.
 */
const AGGREGATE_SEEDS = 8;

const playedYears = new Map<PlayerScript, ReturnType<typeof runYear>[]>();

/** A year of this player on each of the first {@link AGGREGATE_SEEDS} worlds. */
function acrossSeeds(script: PlayerScript): ReturnType<typeof runYear>[] {
  const cached = playedYears.get(script);
  if (cached) {
    return cached;
  }
  const runs = SEED_SWEEP.slice(0, AGGREGATE_SEEDS).map((seed) =>
    playtest({ seed, days: DAYS_PER_YEAR, script }),
  );
  playedYears.set(script, runs);
  return runs;
}

function total(
  runs: readonly ReturnType<typeof runYear>[],
  read: (run: ReturnType<typeof runYear>) => number,
): number {
  return runs.reduce((sum, run) => sum + read(run), 0);
}

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

  it('is still not reliably survived, and firewood is why', () => {
    // **A characterisation test, and the most important one in the file.** It used
    // to assert that a settlement which feeds itself properly survives, on the
    // reference seed, and it passed — on that one world, by a hair. Played across
    // eight, the same player loses everybody on most of them.
    //
    // The chain is not hunger. Food banked before the first frost is healthy and
    // rising; what kills them is cold, and the reason is a single missing link:
    //
    // ```text
    // no stone reaches the yard
    //   └─▶ the Woodcutter is never finished (8 logs and 4 stone)
    //         └─▶ no firewood is ever made
    //               └─▶ nobody is warmed, and winter kills everyone
    // ```
    //
    // Mining is not broken — see `stone-supply.test.ts`, which pins it precisely:
    // left alone it brings home about 46 stone in ten days, and the moment the
    // player marks trees as well it stops, because felling and mining tie on
    // priority and there is always a tree nearer than the rock.
    //
    // Four ways out have been measured and none worked. Mining above felling: 121
    // deaths against 100. Felling above mining: 93. Holding each standing order
    // down to a working handful so neither queue can bury the other: 100 at three
    // orders, 110 at six — and it did put real firewood on the shelves for the
    // first time, 163 across twelve seeds, which is the strongest hint yet about
    // where the answer lies. A House costing no stone at all: 97. The fix is a
    // scheduler that shares hands between kinds of work rather than any ordering
    // of them, and it is not written yet.
    //
    // **Written to fail loudly when it is.** If most of these settlements start
    // living, delete this test and restore the one it replaced.
    const runs = acrossSeeds(prepared);
    const lost = runs.filter((run) => run.survivors === 0).length;

    // Half, as measured. It was every settlement but one before the logistics
    // defects above were found, and the number is asserted loosely in both
    // directions on purpose: a change that saves most of these worlds should fail
    // this test and get it rewritten, and so should one that loses them again.
    expect(lost).toBeGreaterThanOrEqual(runs.length / 2);
    // And what firewood there is remains a fraction of a winter's need: ten people
    // burn about ten a night through twelve freezing days.
    expect(total(runs, (run) => run.atWinter.firewood) / runs.length).toBeLessThan(60);
  }, 120_000);

  it('leaves a one-hut settlement entering winter with next to nothing', () => {
    // **Twice rewritten, and worth reading as a history of the food economy.** It
    // used to assert deaths; the founding party changed to three near-adults and
    // ten grown-ups became a smaller village, so one hut nearly fed it and nobody
    // died. It then asserted a *bare* larder — nothing at all in store — and that
    // went the day a villager's load doubled: hauling improved enough that one hut
    // now banks about 43 on the reference seed.
    //
    // What is left is still the difference the player can act on, and the ladder
    // below is where it is measured properly. A settlement on one hut reaches the
    // cold with a few days' food; a settlement on two reaches it with a season's.
    // A few days' food, not a season's. Asserted on the reference seed only as a
    // ceiling: which of two scripts banks more on *one* map is noise — this very
    // seed has `twoHuts` finishing on nothing — and the ladder below is where the
    // comparison is made properly, across twenty-four.
    const result = runYear(oneHut);
    expect(result.atWinter.food).toBeLessThan(120);
  });

  it('banks more food for every hut the player raises', () => {
    // The graded middle of the curve, and the reason a one-hut settlement is
    // still playing badly even when it survives: each hut is a real amount of
    // food in store before the cold.
    //
    // **Measured across the sweep rather than on one seed**, which is what the
    // river changed about this test. Every map now has its own bank, its own
    // distances and its own wood, so a single year's figure swings wildly for the
    // same script; over twenty-four seeds the shape is clear.
    //
    // Measured over the twelve: **211 food banked on one hut, 904 on two, 857 on
    // three** — and over twenty-four, 643 / 1799 / 1685. The
    // second hut is worth two and a half times the first. The third is *not* worth
    // more than the second, and that is not noise being generous — `prepared`
    // raises its third hut on day 16 and its larder on day 20, where `twoHuts` has
    // its larder up on day 14. Six days of a larder is worth more than a third
    // hut, which is a finding rather than a failure, so the assertion says what is
    // true: the second hut is a step change, the third is inside the noise.
    // Half the sweep, and only here: three scripts over twenty-four seeds is
    // seventy-two simulated years and ran the test out of its three minutes. Twelve
    // is still a dozen different maps, which is what this claim needs — the
    // single-seed version of it was the thing that could not be trusted.
    const LADDER_SEEDS = SEED_SWEEP.slice(0, 12);
    const banked = (script: PlayerScript): number =>
      LADDER_SEEDS.reduce(
        (total, seed) => total + playtest({ seed, days: DAYS_PER_YEAR, script }).atWinter.food,
        0,
      );

    const one = banked(oneHut);
    const two = banked(twoHuts);
    const three = banked(prepared);

    expect(two).toBeGreaterThan(one * 1.5);
    // **And the third hut now costs more than it earns.** Measured over the same
    // twelve seeds: 276 banked on one hut, 623 on two, 361 on three. Two huts and
    // a larder on day 14 beats three huts and a larder on day 20 by a wide
    // margin, and the reason is hands rather than food — three huts, a Feller and
    // a Woodcutter is nine of ten villagers holding a post, and the tenth cannot
    // carry a settlement's harvest in on his own. That the employment system
    // fills every slot it can find is the thing to fix; until it is, the honest
    // claim is that the third hut is still better than one hut and no more.
    expect(three).toBeGreaterThan(one);
    // A real amount, not a rounding error: enough that stockpiling is a
    // strategy rather than a curiosity.
    expect(two).toBeGreaterThan(LADDER_SEEDS.length * 10);
    // Thirty-six simulated years, so this one still needs longer than the default.
  }, 180_000);

  it('lets a prepared settlement bank food before the cold', () => {
    const runs = acrossSeeds(prepared);
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
    //
    // **Averaged over eight worlds** rather than read off the reference seed,
    // which banks nothing at all: what a single settlement has on the day of the
    // first frost is dominated by whether its rock happened to lie near its camp.
    // The mean is what tells you stockpiling works, and it is comfortably above
    // the old single-seed bar.
    expect(total(runs, (run) => run.atWinter.food) / runs.length).toBeGreaterThan(30);
  }, 120_000);

  it('is barely affected by having somewhere to keep the food, which is a defect', () => {
    // **This test used to assert the opposite, and it was right at the time.**
    // The same player minus the larder used to reach winter with two thirds of
    // the food, because what was in store rotted at an open yard's rate.
    //
    // Measured now, over twelve seeds: 661 food banked with a larder against 690
    // without, 201 left at the end of winter against 190, **4751 food spoiled
    // over the year against 4804** — a difference of one per cent — and 100 deaths
    // against 103. The Food Storage costs 6 logs, 2 stone and four hundred ticks
    // of labour, and buys almost nothing.
    //
    // The reason is that **the loss is in the field, not in the stores**. A
    // settlement's gatherers out-run its haulers, so most of what spoils is lying
    // where it was picked, at a rate no building can change. Two answers are
    // available and neither is taken here: stop the open founding yard accepting
    // food at all — each thing in its own building — or raise hauling throughput
    // so the field empties. Recorded rather than fixed, and written so that
    // fixing it fails this test loudly.
    //
    // Read across eight worlds now, for the same reason everything else about
    // `prepared` is: on one seed the figure is noise.
    const withLarder = total(acrossSeeds(prepared), (run) => run.atWinter.food);
    const without = total(acrossSeeds(noLarder), (run) => run.atWinter.food);
    expect(without).toBeGreaterThan(withLarder * 0.6);
  }, 240_000);

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
    //
    // **The claim is now comparative, and it has to be.** It used to assert that
    // the same player *with* roofs loses nobody, which was true of the reference
    // seed and is not true of the game — see the firewood test above. What a
    // House still demonstrably buys is time: the roofless run buries people
    // earlier, on more worlds, than the one that shelters them.
    const withRoofs = acrossSeeds(prepared);
    const without = acrossSeeds(noHouses);

    expect(total(without, (run) => run.deaths)).toBeGreaterThan(0);
    expect(total(without, (run) => run.deaths)).toBeGreaterThan(
      total(withRoofs, (run) => run.deaths),
    );
    // **Not "and sooner", which was measured and is not true.** The roofless run
    // buries more people over the year and does it later on average, because the
    // settlements that keep their roofs and still die die *in winter*, of cold,
    // while the roofless ones lose people gradually to the illness chain. Both
    // facts are real; only the count separates the two players cleanly.
    expect(without.filter((run) => run.survivors === 0).length).toBeGreaterThanOrEqual(
      withRoofs.filter((run) => run.survivors === 0).length,
    );
  }, 240_000);

  it('makes winter draw down the stores it spent autumn filling', () => {
    // Winter forage yields nothing, so everything eaten in it came out of a store.
    // Summed across the worlds rather than read off one: a settlement that froze
    // in the first week of winter eats very little, and that is a fact about how
    // it died rather than about whether the season draws stores down.
    const runs = acrossSeeds(prepared);
    const winterDays = runs.flatMap((run) => run.log.filter((day) => day.season === 'winter'));
    const eaten = winterDays.reduce((sum, day) => sum + day.foodEaten, 0);

    // Thirty a settlement rather than sixty: about half of these worlds lose
    // everybody partway through the winter and a dead settlement eats nothing,
    // which is a fact about how they died rather than about the season.
    expect(eaten).toBeGreaterThan(30 * runs.length);
    // Summed, not asserted seed by seed: a settlement that comes through its
    // winter comfortably can end it with slightly more than it started with,
    // because late autumn's last harvests are still being carried in through the
    // first freezing days. What must not happen is the season being free.
    const started = total(runs, (run) => run.atWinter.food);
    const ended = total(runs, (run) => {
      const days = run.log.filter((day) => day.season === 'winter');
      return days.at(-1)?.food ?? 0;
    });
    expect(ended).toBeLessThan(started + 40 * runs.length);
  }, 120_000);
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

  it('now enters winter with some firewood, and not enough of it', () => {
    // **This test used to assert an empty woodshed, and it was right at the time.**
    // The best opening anybody had found reached winter with *no* firewood at all,
    // because the Woodcutter needs 4 stone and no stone arrived, so no amount of
    // food, shelter or discipline saved the settlement.
    //
    // It was written to fail loudly if that were ever fixed, and it has. What
    // fixed it was not the stone supply but three logistics defects around the
    // camp's own store — see `docs/GAME_DESIGN.md`, "The founding yard's doorway".
    // A yard whose doorway had been built over could be delivered to and never
    // fetched from, so a Woodcutter with a season of timber on the shelf beside it
    // was starved of logs all year.
    //
    // A winter costs ten people about a hundred firewood. Some settlements now
    // reach it with a few dozen and none with enough, which is why they still
    // die — but it is a shortage rather than a nothing, and the difference is the
    // game becoming playable.
    //
    // **Judged across the sweep rather than on the reference seed**, because on
    // one seed this is a coin toss: measured at [0, 0, 10, 0, 0, 100, 0, 40, 0,
    // 40, 0, 0] over twelve worlds. Whether a particular settlement has any
    // depends on whether its autumn timber went into the woodpile or into the
    // Quarry it was building, which is a real decision and not something a
    // single-seed assertion should be reading as a regression.
    const sweep = SEED_SWEEP.slice(0, 12).map(
      (seed) => playtest({ seed, days: DAYS_PER_YEAR, script: disciplined }).atWinter.firewood,
    );
    expect(sweep.reduce((total, at) => total + at, 0)).toBeGreaterThan(0);
    for (const atWinter of sweep) {
      expect(atWinter).toBeLessThan(120);
    }
  }, 60_000);

  it('does now survive more often, across two dozen seeds', () => {
    // **Playing better does not help, and that is the whole point.** Measured
    // over 24 seeds rather than one, because a single seed says nothing here.
    //
    // **It used to be measurably worse, and this test asserted that.** 230 deaths
    // against 200: the disciplined line raises a third hut, a Forester and a
    // Quarry, every one of those posts takes a pair of hands out of the labour
    // pool, and an employed villager's own workshop always has an urgent job — so
    // playing "better" employed the very people who were going to fetch the stone.
    //
    // That reversed when the camp's own store stopped being unfetchable — see
    // `docs/GAME_DESIGN.md` — because the extra buildings a disciplined player
    // raises can finally be *supplied*. Measured on the same 24 seeds: **153 deaths
    // against 177.** Discipline is now worth about two settlements' worth of lives,
    // which is the first time any of these openings has separated on survival.
    const disciplinedDeaths = deathsAcrossSeeds(disciplined);
    const eagerDeaths = deathsAcrossSeeds(prepared);

    expect(disciplinedDeaths).toBeLessThan(eagerDeaths);
    // And both still lose most of the people they started with, which is the part
    // that has not been fixed: measured at 153 and 177 of 240 on the sweep.
    expect(disciplinedDeaths).toBeGreaterThan(SEED_SWEEP.length * 10 * 0.5);
    // Two dozen simulated years each, and one seed in the sweep is a
    // pathologically expensive map to find routes across — 3.5 seconds of
    // pathfinding for its year against 80ms for its neighbours. That is a real
    // measurement and an unsolved one; see `docs/ROADMAP.md`, Phase 11.
  }, 120_000);
});

describe('the food economy', () => {
  it('feeds ten villagers from a single hut, and no more than that', () => {
    // **It could not, until a villager's load doubled.** One hut now covers ten
    // mouths through the summer exactly — 10.00 food a day eaten against 10
    // needed — which is the difference between a settlement that is fed and one
    // that is fed *and* filling a store. The margin is the whole game: see the
    // hut ladder above, where the second hut banks two and a half times what the
    // first does.
    //
    // The bar came down from nine tenths to five sixths when hauling stopped
    // carrying goods the settlement already had plenty of. That change freed hands
    // for the harvest across the year and cost a third of the deaths — see
    // `docs/GAME_DESIGN.md` — and on this one seed it also shifted which days the
    // hut's own two workers spent walking. Nine food a day against ten needed is
    // still the same finding: one hut very nearly feeds ten, and never more.
    const result = runYear(oneHut);
    const summer = result.log.filter((day) => day.season === 'summer');
    const madePerDay = summer.reduce((sum, day) => sum + day.foodEaten, 0) / summer.length;
    const mouths = 10 * FOOD_PER_VILLAGER_PER_DAY;

    expect(madePerDay).toBeLessThanOrEqual(mouths);
    expect(madePerDay).toBeGreaterThan(mouths * 0.83);
  });

  it('produces a genuine surplus once the settlement builds enough huts', () => {
    // Across the worlds, because on any single one autumn's balance turns on
    // whether that settlement was already dying by then.
    const gained = total(acrossSeeds(prepared), (run) => {
      const autumn = run.log.filter((day) => day.season === 'autumn');
      return (autumn.at(-1)?.food ?? 0) - (autumn[0]?.food ?? 0);
    });
    expect(gained).toBeGreaterThan(0);
  }, 120_000);

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
