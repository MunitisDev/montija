/**
 * What kind of year it is, and why that is not bad luck.
 *
 * **The granary was never the decision it should have been.** Every year was the
 * same year — the same fourteen freezing nights, the same harvest — so a
 * settlement that got through one winter got through all of them, and a full
 * larder in autumn was tidiness rather than insurance. Nothing ever asked the
 * player why they were keeping two hundred food they did not need.
 *
 * The rules tested here are the ones that make a hard year a *plan* rather than
 * a dice roll: it is derived rather than rolled, it is fixed before the year
 * starts so it can be announced in spring, and the first one is never hard.
 */

import { describe, expect, it } from 'vitest';

import {
  FIRST_YEAR_KIND,
  YEAR_CHARACTERS,
  characterOf,
  type YearKind,
} from '@/simulation/seasons/YearCharacter';
import { FREEZING_POINT, TICKS_PER_DAY, yearStateAt } from '@/simulation/seasons/SeasonClock';
import { Simulation } from '@/simulation/Simulation';

const SEED = 20260824;

describe('the character of a year', () => {
  it('is the same year twice in the same valley', () => {
    // Derived from the seed and the year's number, so a settlement replayed from
    // its save meets the winter it met before. This is the whole difference
    // between a hard year and a betrayal.
    for (let year = 1; year <= 12; year += 1) {
      expect(characterOf(SEED, year)).toEqual(characterOf(SEED, year));
    }
  });

  it('is a different year in a different valley', () => {
    const here = Array.from({ length: 24 }, (_, index) => characterOf(SEED, index + 2).kind);
    const there = Array.from({ length: 24 }, (_, index) => characterOf(SEED + 1, index + 2).kind);
    expect(here).not.toEqual(there);
  });

  it('is never hard in the first year', () => {
    // A settlement's opening is already the hardest thing in the game. A bitter
    // first winter would be the game killing beginners for something they had no
    // way to see coming.
    for (let seed = 1; seed <= 200; seed += 1) {
      expect(characterOf(seed, 1).kind, `seed ${seed}`).toBe(FIRST_YEAR_KIND);
    }
    expect(YEAR_CHARACTERS[FIRST_YEAR_KIND].coldBite).toBe(0);
    expect(YEAR_CHARACTERS[FIRST_YEAR_KIND].harvest).toBe(1);
  });

  it('is ordinary more often than anything else, and bitter rarely', () => {
    const tally = new Map<YearKind, number>();
    let years = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      for (let year = 2; year <= 21; year += 1) {
        const kind = characterOf(seed * 7919, year).kind;
        tally.set(kind, (tally.get(kind) ?? 0) + 1);
        years += 1;
      }
    }

    const share = (kind: YearKind): number => (tally.get(kind) ?? 0) / years;
    expect(share('ordinary')).toBeGreaterThan(share('kind'));
    expect(share('ordinary')).toBeGreaterThan(share('hard'));
    expect(share('bitter')).toBeLessThan(0.2);
    // And every kind does turn up: a weight nobody ever draws is dead data.
    for (const kind of ['kind', 'ordinary', 'hard', 'bitter'] as const) {
      expect(tally.get(kind) ?? 0, kind).toBeGreaterThan(0);
    }
  });

  it('pays for a kind year as well as charging for a hard one', () => {
    // A game whose weather can only be neutral or worse teaches the player to
    // read every announcement as a punishment.
    expect(YEAR_CHARACTERS.kind.harvest).toBeGreaterThan(1);
    expect(YEAR_CHARACTERS.kind.coldBite).toBeLessThan(0);
    expect(YEAR_CHARACTERS.hard.harvest).toBeLessThan(1);
    expect(YEAR_CHARACTERS.bitter.harvest).toBeLessThan(YEAR_CHARACTERS.hard.harvest);
    expect(YEAR_CHARACTERS.bitter.coldBite).toBeGreaterThan(YEAR_CHARACTERS.hard.coldBite);
  });
});

describe('what the cold bite does to a year', () => {
  it('takes the same degrees off every day of it', () => {
    // Cold rather than a count of freezing nights, because the thermometer is
    // already on the HUD: a bitter year *reads* as bitter every day of it.
    const bite = YEAR_CHARACTERS.bitter.coldBite;
    for (const day of [1, 13, 25, 37, 47]) {
      const tick = day * TICKS_PER_DAY;
      expect(yearStateAt(tick, bite).temperature).toBeCloseTo(
        yearStateAt(tick).temperature - bite,
        5,
      );
    }
  });

  it('turns more nights freezing, which is what costs the firewood', () => {
    const freezingDays = (bite: number): number => {
      let days = 0;
      for (let day = 0; day < 48; day += 1) {
        if (yearStateAt(day * TICKS_PER_DAY, bite).isFreezing) {
          days += 1;
        }
      }
      return days;
    };

    const ordinary = freezingDays(0);
    expect(ordinary).toBeGreaterThan(0);
    expect(freezingDays(YEAR_CHARACTERS.hard.coldBite)).toBeGreaterThan(ordinary);
    expect(freezingDays(YEAR_CHARACTERS.bitter.coldBite)).toBeGreaterThan(
      freezingDays(YEAR_CHARACTERS.hard.coldBite),
    );
    expect(freezingDays(YEAR_CHARACTERS.kind.coldBite)).toBeLessThan(ordinary);
    // And the threshold is still the one the survival system uses.
    expect(FREEZING_POINT).toBeGreaterThan(-20);
  });
});

describe('what the settlement is told', () => {
  it('carries the year’s character in its own snapshot', () => {
    // Shown all year in the calendar rather than announced as an event: a
    // settlement three seasons into a bitter year should be able to look up and
    // see why the thermometer is low.
    const simulation = new Simulation({
      seed: SEED,
      worldWidth: 48,
      worldHeight: 48,
      startingVillagers: 4,
    });
    const snapshot = simulation.snapshot();
    expect(snapshot.yearKind).toBe(FIRST_YEAR_KIND);
    expect(snapshot.harvest).toBe(1);
    expect(simulation.yearCharacter).toEqual(characterOf(SEED, 1));
  });

  it('is the same character the harvest is scaled by', () => {
    // One number, read in two places — the ground and the sheet — so the ledger
    // forecasts the year the settlement is actually in.
    const simulation = new Simulation({
      seed: SEED,
      worldWidth: 48,
      worldHeight: 48,
      startingVillagers: 4,
    });
    expect(simulation.snapshot().harvest).toBe(simulation.yearCharacter.harvest);
  });
});
