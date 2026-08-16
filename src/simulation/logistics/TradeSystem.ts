/**
 * Trade: the way out of a map that will not give you something.
 *
 * Every other system in this game turns land into goods. This one turns goods
 * into other goods, and it exists because some maps simply do not have what a
 * settlement needs — a seed with no rock within reach cannot build a quarry, and
 * no amount of good play makes iron appear. Without a way to swap, that is not
 * a hard start, it is an unwinnable one, and the player cannot tell which.
 *
 * The design is deliberately the smallest thing that solves that:
 *
 * - A **Trading Post** is a building like any other, hauled to and hauled from.
 * - A **merchant visits** every so often, and never in winter. Trade is a road
 *   and a cart, and neither works under snow.
 * - While one is there, the post swaps the settlement's **largest surplus** for
 *   whatever it is **shortest of**, at a poor rate.
 *
 * **The rate is bad on purpose.** Trade must never be the efficient way to get
 * anything — a settlement that trades its way through the game has stopped
 * playing the game. It is the answer to "this map has no iron", not to "I would
 * rather not build a quarry".
 *
 * There is no per-trade interface yet, and that is the honest limitation to
 * record: the post decides for itself. Letting the player name what to buy and
 * what to sell is the obvious next step and is not built.
 */

import { RESOURCE_IDS, type ResourceId } from '@/data/resources';
import type { StorageRegistry } from '@/simulation/logistics/Storage';
import type { Season } from '@/simulation/seasons/SeasonClock';

/** Days between merchant visits. */
export const DAYS_BETWEEN_VISITS = 12;

/** How long a merchant stays, in days. */
export const VISIT_LENGTH_DAYS = 3;

/**
 * Units given up per unit received.
 *
 * Three to one. Enough that a settlement with a genuine surplus can cover a
 * genuine gap, and far too expensive to run an economy on.
 */
export const EXCHANGE_RATE = 3;

/** The most a single post will move in one day, in units received. */
export const TRADED_PER_DAY = 6;

/**
 * A surplus has to be a real one.
 *
 * Below this a settlement is not rich in something, it merely happens to have
 * some — and selling the last of the firewood in November because it outnumbers
 * the iron would be the system actively working against the player.
 */
export const SURPLUS_FLOOR = 80;

/**
 * Goods a merchant will not take.
 *
 * Food rots, and a settlement that sells food is a settlement that starves;
 * firewood is what stands between it and January. Neither is ever a surplus in
 * a way worth acting on, whatever the number says.
 */
const NEVER_SOLD: ReadonlySet<ResourceId> = new Set<ResourceId>(['food', 'firewood']);

export interface TradeReport {
  /** What the settlement gave up today. */
  readonly sold: ResourceId | null;
  readonly soldAmount: number;
  /** What it received. */
  readonly bought: ResourceId | null;
  readonly boughtAmount: number;
  /** `true` while a merchant is at the post. */
  readonly merchantPresent: boolean;
}

export const NO_TRADE: TradeReport = {
  sold: null,
  soldAmount: 0,
  bought: null,
  boughtAmount: 0,
  merchantPresent: false,
};

/**
 * `true` when a merchant is at the settlement on this day.
 *
 * A function of the calendar rather than stored state, so it needs no save
 * field and cannot drift: the same day of the same settlement always has the
 * same answer.
 */
export function merchantIsVisiting(day: number, season: Season): boolean {
  if (season === 'winter') {
    return false;
  }
  return day % DAYS_BETWEEN_VISITS < VISIT_LENGTH_DAYS;
}

/**
 * Runs one day of trade at one post.
 *
 * Takes the stores rather than the world, because trade is entirely a matter of
 * what is in them — the post's own position matters only to the haulers who
 * fill it, which is the ordinary logistics system's business.
 */
export function runTrade(options: {
  readonly storages: StorageRegistry;
  readonly day: number;
  readonly season: Season;
  readonly posts: number;
}): TradeReport {
  if (options.posts <= 0 || !merchantIsVisiting(options.day, options.season)) {
    return NO_TRADE;
  }

  const held = new Map<ResourceId, number>();
  for (const resource of RESOURCE_IDS) {
    held.set(resource, options.storages.totalOf(resource));
  }

  const sell = largestSurplus(held);
  const buy = scarcest(held);
  if (sell === null || buy === null || sell === buy) {
    return { ...NO_TRADE, merchantPresent: true };
  }

  // Bounded three ways: by the day's allowance, by what the surplus can spare
  // without dropping below the floor, and by what will physically fit.
  const spare = Math.floor(((held.get(sell) ?? 0) - SURPLUS_FLOOR) / EXCHANGE_RATE);
  const wanted = Math.min(TRADED_PER_DAY * options.posts, Math.max(0, spare));
  if (wanted <= 0) {
    return { ...NO_TRADE, merchantPresent: true };
  }

  const given = takeFrom(options.storages, sell, wanted * EXCHANGE_RATE);
  const received = Math.floor(given / EXCHANGE_RATE);
  const accepted = giveTo(options.storages, buy, received);

  // Whatever the yards would not take is refunded rather than lost. A trade
  // that silently vanishes goods because a storehouse was full is a bug the
  // player would read as theft.
  const unplaced = received - accepted;
  if (unplaced > 0) {
    giveTo(options.storages, sell, unplaced * EXCHANGE_RATE);
  }

  return {
    sold: sell,
    soldAmount: accepted * EXCHANGE_RATE,
    bought: buy,
    boughtAmount: accepted,
    merchantPresent: true,
  };
}

/** The good the settlement has most of, above the floor, that may be sold. */
function largestSurplus(held: ReadonlyMap<ResourceId, number>): ResourceId | null {
  let best: ResourceId | null = null;
  let bestAmount = SURPLUS_FLOOR;

  for (const resource of RESOURCE_IDS) {
    if (NEVER_SOLD.has(resource)) {
      continue;
    }
    const amount = held.get(resource) ?? 0;
    if (amount > bestAmount) {
      best = resource;
      bestAmount = amount;
    }
  }

  return best;
}

/**
 * The good the settlement has least of.
 *
 * Food and firewood are eligible to *buy* even though they may not be sold: a
 * merchant is exactly who you want to see in a bad autumn.
 *
 * Ties break on `RESOURCE_IDS` order, which is not incidental — that list runs
 * food, logs, firewood, stone, iron, tools, hides, clothing, which is roughly
 * how badly a settlement needs a good it has none of. A village with nothing
 * but timber buys firewood before it buys coats, which is the right answer and
 * falls out of the ordering for free.
 */
function scarcest(held: ReadonlyMap<ResourceId, number>): ResourceId | null {
  let worst: ResourceId | null = null;
  let worstAmount = Number.POSITIVE_INFINITY;

  for (const resource of RESOURCE_IDS) {
    const amount = held.get(resource) ?? 0;
    if (amount < worstAmount) {
      worst = resource;
      worstAmount = amount;
    }
  }

  return worst;
}

function takeFrom(storages: StorageRegistry, resource: ResourceId, amount: number): number {
  let remaining = amount;
  for (const storage of storages.all) {
    if (remaining <= 0) {
      break;
    }
    remaining -= storage.inventory.remove(resource, remaining);
  }
  return amount - remaining;
}

function giveTo(storages: StorageRegistry, resource: ResourceId, amount: number): number {
  let remaining = amount;
  for (const storage of storages.all) {
    if (remaining <= 0) {
      break;
    }
    if (!storage.accepts(resource)) {
      continue;
    }
    remaining -= storage.inventory.add(resource, remaining);
  }
  return amount - remaining;
}
