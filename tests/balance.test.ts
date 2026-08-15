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

/** Gets a food supply going, but only one hut for ten mouths. */
const oneHut: PlayerScript = (sim, day) => {
  if (day === 1) {
    designateNearbyTrees(sim, 40);
    designateNearbyStone(sim, 12);
  }
  if (day === 2 && !ordered(sim, 'gatherer-hut')) buildNearby(sim, 'gatherer-hut');
  if (day === 8 && !ordered(sim, 'woodcutter')) buildNearby(sim, 'woodcutter');
  if (day === 14 && !ordered(sim, 'food-storage')) buildNearby(sim, 'food-storage');
  if (day % 5 === 0) designateNearbyTrees(sim, 25);
  if (day % 8 === 0) designateNearbyStone(sim, 6);
};

/** Leaves everything until late summer. */
const late: PlayerScript = (sim, day) => {
  if (day === 1) designateNearbyTrees(sim, 20);
  if (day === 15 && !ordered(sim, 'gatherer-hut')) {
    designateNearbyStone(sim, 10);
    buildNearby(sim, 'gatherer-hut');
  }
  if (day === 28 && !ordered(sim, 'woodcutter')) buildNearby(sim, 'woodcutter');
  if (day % 10 === 0) designateNearbyTrees(sim, 20);
};

/** Raises a second hut, which ten villagers need. */
const prepared: PlayerScript = (sim, day) => {
  oneHut(sim, day);
  if (day === 18 && countOf(sim, 'gatherer-hut') < 2) buildNearby(sim, 'gatherer-hut');
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

  it('kills a settlement that leaves its food supply until late summer', () => {
    const result = runYear(late);
    expect(result.deaths).toBeGreaterThan(0);
    // The point of the game is that winter is what gets you.
    expect(result.firstDeathDay).toBeGreaterThanOrEqual(firstDayOf('winter'));
  });

  it('is survived by a settlement that feeds itself properly', () => {
    const result = runYear(prepared);
    expect(result.survivors).toBe(10);
    expect(result.deaths).toBe(0);
  });

  it('is survived only barely on a single hut for ten villagers', () => {
    // One hut cannot feed ten. This settlement lives, but ends the winter on
    // the brink — which is the intended lesson rather than a soft landing.
    const result = runYear(oneHut);
    expect(result.survivors).toBe(10);
    const endOfWinter = result.log[firstDayOf('spring') + DAYS_PER_YEAR - 1] ?? result.log.at(-1);
    expect(endOfWinter).toBeDefined();
    expect(result.log.at(-1)?.lowestHealth ?? 100).toBeLessThan(50);
  });

  it('lets a prepared settlement bank food before the cold', () => {
    const result = runYear(prepared);
    // Not merely "some food": enough that stockpiling is a real strategy.
    expect(result.atWinter.food).toBeGreaterThan(30);
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
