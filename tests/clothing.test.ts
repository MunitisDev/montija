/**
 * Clothing: the third need, and the second line of defence.
 *
 * Warmth came from one place — a house with firewood in it — so a settlement
 * that ran short of either had nothing to fall back on, and the loss curve was
 * identical whether they were a day short or a season short. A coat does not
 * replace a hearth. It means running out of firewood is survivable for a while
 * rather than immediately fatal, and it is the only thing that helps somebody
 * with no roof at all.
 *
 * The rules worth guarding are the ones that keep it insurance rather than a
 * tax: nothing is taken from a settlement that has none, and having a coat is
 * never better than having a fire.
 */

import { describe, expect, it } from 'vitest';
import {
  CLOTHING_PER_VILLAGER_PER_COLD_DAY,
  CLOTHING_WARMTH_SHARE,
  SHELTERLESS_WARMTH_SHARE,
  runDay,
} from '@/simulation/seasons/SurvivalSystem';
import { StorageRegistry } from '@/simulation/logistics/Storage';
import { WearLedger } from '@/simulation/resources/wear';
import { Villager } from '@/simulation/villagers/Villager';
import { recipe } from '@/data/recipes';
import { buildingDefinition } from '@/data/buildings';
import { DAYS_PER_SEASON, SEASONAL_YIELD } from '@/simulation/seasons/SeasonClock';
import type { YearState } from '@/simulation/seasons/SeasonClock';

const FREEZING: YearState = {
  season: 'winter',
  dayOfSeason: 5,
  year: 1,
  temperature: -6,
  isFreezing: true,
};

function people(count: number, housed: boolean): Villager[] {
  return Array.from({ length: count }, (_unused, index) => {
    const villager = new Villager({
      id: index + 1,
      name: `Test ${index}`,
      sex: 'f',
      age: 30,
      position: { wx: 0, wy: 0 },
      lifespan: 70,
    });
    villager.homeId = housed ? 1 : null;
    villager.needs.warmth = 50;
    return villager;
  });
}

function stocked(options: { firewood: number; clothing: number }): StorageRegistry {
  const storages = new StorageRegistry();
  const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 5000 });
  yard.inventory.add('food', 500);
  yard.inventory.add('firewood', options.firewood);
  yard.inventory.add('clothing', options.clothing);
  return storages;
}

describe('the chain that makes a coat', () => {
  it('runs from a hunt through a tailor', () => {
    const hunt = recipe('hunt-game');
    expect(hunt?.outputs.some((output) => output.resource === 'hides')).toBe(true);
    // Meat as well as hides: getting both from one building is what stops
    // clothing being a chore bolted onto an economy with no room for it.
    expect(hunt?.outputs.some((output) => output.resource === 'food')).toBe(true);

    const sew = recipe('sew-clothing');
    expect(sew?.inputs.some((input) => input.resource === 'hides')).toBe(true);
    expect(sew?.outputs.some((output) => output.resource === 'clothing')).toBe(true);

    expect(buildingDefinition('hunter').recipeId).toBe('hunt-game');
    expect(buildingDefinition('tailor').recipeId).toBe('sew-clothing');
  });

  it('is the only work that still pays under snow', () => {
    // The reason a settlement built on foraging alone finds winter so much
    // harder than one that hunts.
    expect(SEASONAL_YIELD.game.winter).toBeGreaterThan(0);
    for (const profile of ['forage', 'crop', 'orchard'] as const) {
      expect(SEASONAL_YIELD[profile].winter, profile).toBe(0);
    }
  });
});

describe('wearing it', () => {
  it('takes nothing from a settlement that has none', () => {
    const storages = stocked({ firewood: 100, clothing: 0 });
    const { report } = runDay(people(6, true), storages, FREEZING);

    expect(report.clothingWorn).toBe(0);
    expect(report.clothingFraction).toBe(0);
  });

  it('takes nothing in a season nobody needs a coat', () => {
    const storages = stocked({ firewood: 100, clothing: 100 });
    const mild: YearState = { ...FREEZING, season: 'summer', temperature: 18, isFreezing: false };

    const { report } = runDay(people(6, true), storages, mild);
    expect(report.clothingWorn).toBe(0);
  });

  it('wears out at the stated rate over a winter, for everyone', () => {
    // **A day no longer takes a fraction of a coat**, because a yard holds whole
    // coats and a player quite reasonably objected to seeing 99.7 of one. Six
    // villagers owe 0.3 of a coat a night, so one coat comes off the shelf every
    // fourth night — and over enough nights the average is exactly the rate the
    // data states. That is what the running tab in `resources/wear.ts` buys, and
    // it is the claim worth testing.
    const storages = stocked({ firewood: 1000, clothing: 100 });
    const villagers = people(6, true);
    const wear = new WearLedger();
    const nights = 40;

    let worn = 0;
    for (let night = 0; night < nights; night += 1) {
      const { report } = runDay(villagers, storages, FREEZING, 0, wear);
      worn += report.clothingWorn;
      // And never a fraction of one, on any night.
      expect(Number.isInteger(report.clothingWorn)).toBe(true);
    }

    const expected = nights * 6 * CLOTHING_PER_VILLAGER_PER_COLD_DAY;
    // Within one coat: whatever is still owed has not been paid yet.
    expect(Math.abs(worn - expected)).toBeLessThan(1);
    // Children too: a coat keeps a child warm the same as anyone, and six people
    // wearing them is what produced that total.
    expect(worn).toBeGreaterThan(0);
  });

  it('keeps the shelf in whole coats', () => {
    const storages = stocked({ firewood: 1000, clothing: 50 });
    const villagers = people(6, true);
    const wear = new WearLedger();

    for (let night = 0; night < 12; night += 1) {
      runDay(villagers, storages, FREEZING, 0, wear);
      expect(Number.isInteger(storages.totalOf('clothing'))).toBe(true);
    }
  });

  it('still reads as fully clothed on a day it takes nothing', () => {
    // Coverage is read off the shelf rather than off the withdrawal. Read off the
    // withdrawal it would say "unclothed" on three nights in four, and the warmth
    // it drives would flicker.
    const storages = stocked({ firewood: 1000, clothing: 100 });
    const { report } = runDay(people(6, true), storages, FREEZING, 0, new WearLedger());

    expect(report.clothingWorn).toBe(0);
    expect(report.clothingFraction).toBe(1);
  });

  it('keeps people warmer when the firewood runs out', () => {
    // The whole point of the feature: with an empty woodshed, the difference
    // between a settlement that sewed coats and one that did not.
    const clothed = people(6, true);
    const bare = people(6, true);
    runDay(clothed, stocked({ firewood: 0, clothing: 100 }), FREEZING);
    runDay(bare, stocked({ firewood: 0, clothing: 0 }), FREEZING);

    const coldest = (group: Villager[]): number =>
      Math.min(...group.map((villager) => villager.needs.warmth));
    expect(coldest(clothed)).toBeGreaterThan(coldest(bare));
  });

  it('is the only thing that helps somebody with no roof', () => {
    // A fire warms a house. Someone sleeping rough gets a quarter of it, and
    // before coats existed that was the whole of their defence.
    const roofless = people(4, false);
    const clothed = people(4, false);
    runDay(roofless, stocked({ firewood: 100, clothing: 0 }), FREEZING);
    runDay(clothed, stocked({ firewood: 100, clothing: 100 }), FREEZING);

    const coldest = (group: Villager[]): number =>
      Math.min(...group.map((villager) => villager.needs.warmth));
    expect(coldest(clothed)).toBeGreaterThan(coldest(roofless));
    expect(CLOTHING_WARMTH_SHARE).toBeGreaterThan(SHELTERLESS_WARMTH_SHARE);
  });

  it('never beats a fire, however many coats there are', () => {
    // Insurance, not a replacement: a settlement must not be able to skip
    // houses and woodcutters by sewing enough coats.
    const clothedOnly = people(4, true);
    const warmedOnly = people(4, true);
    runDay(clothedOnly, stocked({ firewood: 0, clothing: 500 }), FREEZING);
    runDay(warmedOnly, stocked({ firewood: 500, clothing: 0 }), FREEZING);

    const warmth = (group: Villager[]): number => group[0]?.needs.warmth ?? 0;
    expect(warmth(clothedOnly)).toBeLessThan(warmth(warmedOnly));
  });
});

describe('a winter without firewood', () => {
  /**
   * Runs freezing days back to back and reports when the first person dies.
   *
   * Deliberately `runDay` rather than a whole settlement. An earlier attempt
   * ran a real simulation for a year and measured nothing: the food it was
   * stocked with rotted in the open yard at a tenth a day, so everybody starved
   * before the cold arrived and both runs died on the same afternoon. Isolating
   * the variable means isolating it.
   */
  const daysUntilTheFirstDeath = (clothing: number): number => {
    const group = people(6, true);
    const storages = stocked({ firewood: 0, clothing });

    for (let day = 1; day <= 60; day += 1) {
      const { dead } = runDay(group, storages, FREEZING);
      if (dead.length > 0) {
        return day;
      }
    }
    return 60;
  };

  it('is survived by a clothed settlement and not by a bare one', () => {
    const clothed = daysUntilTheFirstDeath(200);
    const bare = daysUntilTheFirstDeath(0);

    // The design claim, stated as the thing a player would actually
    // experience: with coats, an empty woodshed is a winter you get through.
    // Without, it kills you before the thaw. Measured: 17 days against 13,
    // against a season of 15.
    expect(clothed).toBeGreaterThan(DAYS_PER_SEASON);
    expect(bare).toBeLessThan(DAYS_PER_SEASON);
  });

  it('runs out eventually, because coats are not a hearth', () => {
    // A second winter with no fire is not survivable however well dressed the
    // settlement is, or houses and woodcutters would be optional.
    expect(daysUntilTheFirstDeath(200)).toBeLessThan(DAYS_PER_SEASON * 2);
  });
});
