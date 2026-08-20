/**
 * Trade: the way out of a map that will not give you something.
 *
 * A seed with no rock within reach cannot build a quarry, and no amount of good
 * play makes iron appear. Without a way to swap, that is not a hard start but an
 * unwinnable one — and the player cannot tell which they have been given.
 *
 * So the rules worth guarding are the ones that keep it a *last resort* rather
 * than an economy: the rate has to be bad, the merchant has to be occasional,
 * and the post must never sell the food or the firewood out from under a
 * settlement that is about to need them.
 */

import { describe, expect, it } from 'vitest';
import {
  DAYS_BETWEEN_VISITS,
  EXCHANGE_RATE,
  NO_TRADE,
  SURPLUS_FLOOR,
  VISIT_LENGTH_DAYS,
  merchantIsVisiting,
  runTrade,
} from '@/simulation/logistics/TradeSystem';
import { StorageRegistry } from '@/simulation/logistics/Storage';
import { Simulation } from '@/simulation/Simulation';
import { TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';
import type { ResourceId } from '@/data/resources';

function yardWith(contents: Partial<Record<ResourceId, number>>): StorageRegistry {
  const storages = new StorageRegistry();
  const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 100_000 });
  for (const [resource, amount] of Object.entries(contents)) {
    yard.inventory.add(resource as ResourceId, amount);
  }
  return storages;
}

const SUMMER_TRADING_DAY = 0;

describe('when the merchant calls', () => {
  it('comes round on a cycle, and stays a few days', () => {
    let visits = 0;
    for (let day = 0; day < DAYS_BETWEEN_VISITS * 4; day += 1) {
      if (merchantIsVisiting(day, 'summer')) {
        visits += 1;
      }
    }
    expect(visits).toBe(VISIT_LENGTH_DAYS * 4);
  });

  it('never comes in winter', () => {
    // Trade is a road and a cart, and neither works under snow — which also
    // stops the merchant being the answer to the season the game is about.
    for (let day = 0; day < DAYS_BETWEEN_VISITS * 3; day += 1) {
      expect(merchantIsVisiting(day, 'winter'), `day ${day}`).toBe(false);
    }
  });
});

describe('what the post does', () => {
  it('does nothing without a post to do it at', () => {
    const storages = yardWith({ logs: 900, iron: 0 });
    expect(runTrade({ storages, day: SUMMER_TRADING_DAY, season: 'summer', posts: 0 })).toEqual(
      NO_TRADE,
    );
  });

  it('does nothing on a day nobody is visiting', () => {
    const storages = yardWith({ logs: 900, iron: 0 });
    const quiet = DAYS_BETWEEN_VISITS - 1;
    expect(merchantIsVisiting(quiet, 'summer')).toBe(false);

    const report = runTrade({ storages, day: quiet, season: 'summer', posts: 1 });
    expect(report.boughtAmount).toBe(0);
    expect(report.merchantPresent).toBe(false);
  });

  it('swaps the biggest surplus for the scarcest good', () => {
    const storages = yardWith({
      logs: 900,
      stone: 200,
      vegetables: 300,
      firewood: 200,
      tools: 40,
      hides: 40,
      clothing: 40,
      iron: 0,
    });
    const report = runTrade({ storages, day: SUMMER_TRADING_DAY, season: 'summer', posts: 1 });

    expect(report.sold).toBe('logs');
    expect(report.bought).toBe('iron');
    expect(report.boughtAmount).toBeGreaterThan(0);
    expect(storages.totalOf('iron')).toBe(report.boughtAmount);
  });

  it('buys the most essential of the goods it has none of', () => {
    // Several goods at zero is the ordinary case for a young settlement, and
    // the tie breaks on the order resources are declared in — which runs
    // roughly from "cannot live without" to "nice to have".
    const storages = yardWith({ logs: 900, firewood: 0, iron: 0, clothing: 0 });
    const report = runTrade({ storages, day: SUMMER_TRADING_DAY, season: 'summer', posts: 1 });

    expect(report.bought).toBe('vegetables');
  });

  it('charges a bad rate, on purpose', () => {
    // Trade must never be the efficient way to get anything. A settlement that
    // trades its way through the game has stopped playing it.
    const storages = yardWith({ logs: 900, iron: 0 });
    const report = runTrade({ storages, day: SUMMER_TRADING_DAY, season: 'summer', posts: 1 });

    expect(report.soldAmount).toBe(report.boughtAmount * EXCHANGE_RATE);
    expect(EXCHANGE_RATE).toBeGreaterThan(1);
  });

  it('will not sell food or firewood, however much of it there is', () => {
    // A post that sells the last of the firewood in November because it
    // outnumbers the iron would be the game working against the player.
    const storages = yardWith({ vegetables: 5000, firewood: 4000, iron: 0 });
    const report = runTrade({ storages, day: SUMMER_TRADING_DAY, season: 'summer', posts: 1 });

    expect(report.sold).toBeNull();
    expect(storages.totalOf('vegetables')).toBe(5000);
    expect(storages.totalOf('firewood')).toBe(4000);
  });

  it('will happily buy food, which is what a merchant is for in a bad autumn', () => {
    const storages = yardWith({ logs: 900, vegetables: 0, iron: 200, stone: 200 });
    const report = runTrade({ storages, day: SUMMER_TRADING_DAY, season: 'summer', posts: 1 });

    expect(report.bought).toBe('vegetables');
    expect(storages.totalOf('vegetables')).toBeGreaterThan(0);
  });

  it('leaves a working stock behind rather than selling down to nothing', () => {
    const storages = yardWith({ logs: SURPLUS_FLOOR + 12, iron: 0 });
    runTrade({ storages, day: SUMMER_TRADING_DAY, season: 'summer', posts: 1 });

    expect(storages.totalOf('logs')).toBeGreaterThanOrEqual(SURPLUS_FLOOR);
  });

  it('does nothing at all when no surplus clears the floor', () => {
    const storages = yardWith({ logs: SURPLUS_FLOOR - 1, iron: 0 });
    const report = runTrade({ storages, day: SUMMER_TRADING_DAY, season: 'summer', posts: 1 });

    expect(report.sold).toBeNull();
    expect(report.merchantPresent).toBe(true);
  });

  it('refunds goods the yards would not take rather than losing them', () => {
    // A trade that silently vanishes goods because a storehouse was full is a
    // bug the player would rightly read as theft.
    const storages = new StorageRegistry();
    const yard = storages.add({ cell: { gx: 0, gy: 0 }, capacity: 100_000, accepts: ['logs'] });
    yard.inventory.add('logs', 900);

    const before = storages.totalOf('logs');
    const report = runTrade({ storages, day: SUMMER_TRADING_DAY, season: 'summer', posts: 1 });

    expect(report.boughtAmount).toBe(0);
    expect(storages.totalOf('logs')).toBe(before);
  });
});

describe('a settlement with a post', () => {
  it('acquires something the map never gave it', () => {
    const simulation = new Simulation({
      seed: 20260815,
      worldWidth: 64,
      worldHeight: 64,
      startingVillagers: 6,
    });
    const post = raiseTradingPost(simulation);
    expect(post).toBe(true);
    if (!post) {
      return;
    }

    const yard = simulation.storages.all[0];
    yard?.inventory.add('logs', 600);
    // Whatever came off the wreck, and no more: the settlers salvage a little
    // iron and have no way at all to get another scrap of it without a mine.
    const salvaged = simulation.storages.totalOf('iron');
    // Named rather than left automatic. Since the settlers stopped arriving
    // with salvaged stone, *stone* is the thing a new settlement has least of,
    // so an automatic post quite correctly buys that instead — and this test is
    // about iron, which is the good no amount of good play can produce without
    // a mine.
    simulation.setTradeOrder({ sell: 'logs', buy: 'iron' });

    for (let tick = 1; tick <= TICKS_PER_DAY * 30; tick += 1) {
      simulation.update(tick, TICK);
    }

    // No mine, no rock worked, and more iron in the yards than the wreck gave
    // them. That is the whole point: a map without iron is now hard rather than
    // unwinnable.
    expect(simulation.storages.totalOf('iron')).toBeGreaterThan(salvaged);
  });

  it('employs nobody, because the merchant does the trading', () => {
    const simulation = new Simulation({
      seed: 20260815,
      worldWidth: 64,
      worldHeight: 64,
      startingVillagers: 6,
    });
    raiseTradingPost(simulation);

    for (let tick = 1; tick <= TICKS_PER_DAY * 3; tick += 1) {
      simulation.update(tick, TICK);
    }

    expect(simulation.snapshot().employment.vacancies).toBe(0);
  });
});

const TICK = 0.1;

/** Places a trading post somewhere and finishes it. */
function raiseTradingPost(simulation: Simulation): boolean {
  for (let gy = 0; gy < simulation.world.height; gy += 1) {
    for (let gx = 0; gx < simulation.world.width; gx += 1) {
      const cell = { gx, gy };
      if (!simulation.canPlaceBuilding('trading-post', cell).ok) {
        continue;
      }
      const building = simulation.placeBuilding('trading-post', cell);
      if (building) {
        simulation.world.buildings.complete(simulation.world, building);
        return true;
      }
    }
  }
  return false;
}

describe('when the player names the trade', () => {
  it('sells what they asked for rather than the biggest pile', () => {
    // The reason the control exists: the settlement's biggest surplus is not
    // always the one it is willing to part with.
    const storages = yardWith({ logs: 900, stone: 400, iron: 0 });
    const report = runTrade({
      storages,
      day: SUMMER_TRADING_DAY,
      season: 'summer',
      posts: 1,
      order: { sell: 'stone', buy: null },
    });

    expect(report.sold).toBe('stone');
    expect(storages.totalOf('logs')).toBe(900);
  });

  it('buys what they asked for rather than the scarcest thing', () => {
    const storages = yardWith({ logs: 900, iron: 0, clothing: 5 });
    const report = runTrade({
      storages,
      day: SUMMER_TRADING_DAY,
      season: 'summer',
      posts: 1,
      order: { sell: null, buy: 'clothing' },
    });

    expect(report.bought).toBe('clothing');
    expect(storages.totalOf('clothing')).toBeGreaterThan(5);
  });

  it('still refuses to sell food, however it is asked', () => {
    // Offering the player a choice the game then quietly ignores would be
    // worse than not offering it; refusing outright is at least honest.
    const storages = yardWith({ vegetables: 5000, iron: 0 });
    const report = runTrade({
      storages,
      day: SUMMER_TRADING_DAY,
      season: 'summer',
      posts: 1,
      order: { sell: 'vegetables', buy: 'iron' },
    });

    expect(report.sold).toBeNull();
    expect(storages.totalOf('vegetables')).toBe(5000);
  });

  it('still leaves a working stock behind', () => {
    // A named good is not a licence to sell the last of it.
    const storages = yardWith({ stone: SURPLUS_FLOOR + 9, iron: 0 });
    runTrade({
      storages,
      day: SUMMER_TRADING_DAY,
      season: 'summer',
      posts: 1,
      order: { sell: 'stone', buy: 'iron' },
    });

    expect(storages.totalOf('stone')).toBeGreaterThanOrEqual(SURPLUS_FLOOR);
  });

  it('does nothing when both sides name the same good', () => {
    const storages = yardWith({ logs: 900 });
    const report = runTrade({
      storages,
      day: SUMMER_TRADING_DAY,
      season: 'summer',
      posts: 1,
      order: { sell: 'logs', buy: 'logs' },
    });

    expect(report.boughtAmount).toBe(0);
    expect(storages.totalOf('logs')).toBe(900);
  });

  it('starts on automatic and cycles back round to it', () => {
    const simulation = new Simulation({
      seed: 20260815,
      worldWidth: 48,
      worldHeight: 48,
      startingVillagers: 2,
    });
    expect(simulation.trading).toEqual({ sell: null, buy: null });

    simulation.setTradeOrder({ sell: 'logs', buy: 'iron' });
    expect(simulation.trading.sell).toBe('logs');

    simulation.setTradeOrder({ sell: null, buy: null });
    expect(simulation.trading).toEqual({ sell: null, buy: null });
  });
});
