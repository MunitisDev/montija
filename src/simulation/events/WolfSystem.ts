/**
 * Wolves, which are the wood answering back.
 *
 * **The rule this file is written around is the fire system's rule.** A pack is
 * never bad luck: it comes in the season the wood has nothing left in it, it goes
 * for whatever the settlement made easy, and everything it can take is something
 * the player left where it could be taken.
 *
 * - **When** is the hungry half of the year. Nothing comes down in spring or
 *   summer, so a settlement's first two seasons are its own business and the
 *   threat arrives exactly when the player is already busy being afraid of the
 *   cold.
 * - **What it takes** is, in order: **food lying in the open**, and failing that
 *   **somebody working alone with the trees at their back**. Those are the two
 *   mistakes the game has been asking the player not to make since the first
 *   winter — the harvest left in the field, and a lone feller sent to the far
 *   woods — and this is the first thing that punishes them directly rather than
 *   through an empty larder in three weeks' time.
 * - **What stops it** is a **palisade**: a pack will not cross a stake line. This
 *   is deliberately the firebreak rule again — what lies *between* two things
 *   decides whether one reaches the other — so a player who has understood roads
 *   and fires already understands fences.
 * - **Who it will not touch**: anybody with company. A pack takes the one who is
 *   on their own, which makes *where the settlement sends people* the decision
 *   rather than a die roll.
 *
 * **Nothing comes down in the settlement's first year**, and that is a tuning
 * decision stated as a rule rather than hidden in a number. The first winter is
 * this game's stated objective and every figure in it has been measured against
 * ten people with no walls and no spare timber; dropping a second predator into
 * that particular winter does not make the game deeper, it makes the tutorial
 * lose two worlds in twelve — measured, before this rule existed. A camp has
 * nothing a pack wants that a wood in autumn does not already have. A settlement
 * with three winters of stores and people working a mile out does.
 *
 * One pack a day at most, resolved at the day boundary like every other slow
 * process, and deterministic from the settlement's own stream: the same seed and
 * the same plan lose the same heap of turnips on the same night.
 */

import { isFood, type ResourceId } from '@/data/resources';
import type { ResourcePile } from '@/simulation/resources/ResourcePile';
import type { GridPoint } from '@/shared/types/geometry';
import type { Season } from '@/simulation/seasons/SeasonClock';
import type { Villager } from '@/simulation/villagers/Villager';
import type { World } from '@/simulation/world/World';

/**
 * Chance a pack comes down, per day, by season.
 *
 * Nothing at all while the wood is feeding them. Autumn is the warning and winter
 * is the problem, which lines the threat up with the season the whole game is
 * about: a little over one pack a year, and both of the seasons it can happen in
 * are seasons the player is already short of hands.
 */
export const PACK_CHANCE: Readonly<Record<Season, number>> = {
  spring: 0,
  summer: 0,
  autumn: 0.03,
  winter: 0.08,
};

/**
 * How far from the trees a pack will come, in cells.
 *
 * Six, which is far enough to reach a yard built at the edge of a clearing and
 * not far enough to reach the middle of a settlement that has cleared its ground.
 * Felling the wood back is therefore a defence in itself — the same axes the
 * player is already swinging, doing a second job.
 */
export const WOLF_REACH = 6;

/** The first settlement year a pack will come down in. See the header. */
export const FIRST_WOLF_YEAR = 2;

/** How close somebody else has to be to count as company, in cells. */
export const COMPANY_RADIUS = 3;

/**
 * How much food a pack carries off from one heap.
 *
 * A day and a half of eating for ten people, which for almost every heap on the
 * map is the whole heap: measured, an exposed pile holds three or four, because
 * the settlement's harvest lies in the fields in ones and twos.
 */
export const PACK_APPETITE = 15;

/**
 * How many heaps one pack will work through.
 *
 * **Three, and this is the number that makes the rule bite.** With one heap a
 * pack took three or four food off a settlement and the whole mechanic was a
 * rounding error — measured over twelve settlements and six years: 74 raids and
 * 236 food between them, against the 3,600 a year those settlements ate. Wolves
 * are scavengers and a field with the harvest lying in it is a field they clear,
 * so a careless settlement now loses a real amount and a tidy one loses nothing
 * at all. That gap is the palisade's whole reason to exist.
 */
export const PACK_HEAPS = 3;

/**
 * Chance a pack takes somebody it finds alone at the treeline.
 *
 * The one roll in the whole system, and it is the last step of four decisions:
 * the season came round, the settlement had no food lying out to distract them,
 * somebody was working the far wood, and they were working it alone. A settlement
 * that gets any one of those right loses nobody.
 */
export const KILL_CHANCE = 0.25;

export interface WolfReport {
  /** `true` on a day a pack came down at all. */
  readonly prowled: boolean;
  /** What they carried off, heap by heap. */
  readonly stolen: readonly {
    readonly resource: ResourceId;
    readonly amount: number;
    readonly cell: GridPoint;
  }[];
  /** Everything they took, across the heaps they worked through. */
  readonly stolenTotal: number;
  /** Villagers the pack took, by id. */
  readonly killed: readonly number[];
  /**
   * Villagers a pack went for and did not get.
   *
   * Worth reporting rather than dropping: the near miss is the warning, and a
   * player who is told about it can move somebody before the next one.
   */
  readonly escaped: readonly number[];
}

export const NO_WOLVES: WolfReport = {
  prowled: false,
  stolen: [],
  stolenTotal: 0,
  killed: [],
  escaped: [],
};

export interface WolfOptions {
  readonly world: World;
  readonly villagers: readonly Villager[];
  /**
   * Where the night's luck comes from.
   *
   * Narrowed to the one method this system uses, so a test can hand it a night
   * that always brings a pack or one that never does — the only way to hold a
   * rule that fires once a year to account.
   */
  readonly random: { next(): number };
  readonly season: Season;
  /** The settlement year, counting from 1. Nothing happens in the first. */
  readonly year: number;
}

/** Runs one day of wolves. */
export function runWolves(options: WolfOptions): WolfReport {
  const { world, villagers, random, season, year } = options;

  // **The dice are not even rolled in the first year**, deliberately: no draw
  // means no stream movement, so a settlement's founding year is bit-for-bit the
  // year it always was and every measurement taken before wolves existed still
  // describes it.
  if (year < FIRST_WOLF_YEAR || PACK_CHANCE[season] === 0) {
    return NO_WOLVES;
  }
  if (random.next() >= PACK_CHANCE[season]) {
    return NO_WOLVES;
  }

  // **The easy meal first.** A pack that finds the harvest lying in a field does
  // not go looking for a woodcutter, which is why hauling it in is a defence as
  // well as an economy.
  const stolen: { resource: ResourceId; amount: number; cell: GridPoint }[] = [];
  for (const heap of exposedFood(world)) {
    const amount = heap.inventory.remove(heap.resource, PACK_APPETITE);
    if (amount <= 0) {
      continue;
    }
    stolen.push({ resource: heap.resource, amount, cell: { ...heap.cell } });
    world.piles.removeIfEmpty(heap.id);
  }
  if (stolen.length > 0) {
    return {
      prowled: true,
      stolen,
      stolenTotal: stolen.reduce((total, take) => total + take.amount, 0),
      killed: [],
      escaped: [],
    };
  }

  const alone = exposedVillager(world, villagers);
  if (!alone) {
    return { prowled: true, stolen: [], stolenTotal: 0, killed: [], escaped: [] };
  }

  if (random.next() < KILL_CHANCE) {
    return { prowled: true, stolen: [], stolenTotal: 0, killed: [alone.id], escaped: [] };
  }
  return { prowled: true, stolen: [], stolenTotal: 0, killed: [], escaped: [alone.id] };
}

/**
 * The heaps a pack would work through, nearest the trees first.
 *
 * Food only — wolves have no use for a pile of stone — and at most
 * {@link PACK_HEAPS} of them, so a settlement that leaves one heap at the
 * treeline and keeps the rest behind a fence loses the one at the treeline.
 * Sorted by distance and then by id, so a settlement replayed from its seed
 * loses the same heaps twice.
 */
function exposedFood(world: World): readonly ResourcePile[] {
  const reachable: { pile: ResourcePile; distance: number }[] = [];
  for (const pile of world.piles.all) {
    if (!isFood(pile.resource) || pile.isEmpty) {
      continue;
    }
    const distance = distanceToWood(world, pile.cell);
    if (distance === null) {
      continue;
    }
    reachable.push({ pile, distance });
  }
  reachable.sort((a, b) => a.distance - b.distance || a.pile.id - b.pile.id);
  return reachable.slice(0, PACK_HEAPS).map((found) => found.pile);
}

/**
 * The villager a pack would take, or `null` when nobody is that exposed.
 *
 * Three conditions, and all three are the player's: near the trees, not behind a
 * fence, and nobody else within {@link COMPANY_RADIUS}. Taken in id order after
 * distance, for the same determinism as the heap.
 */
function exposedVillager(world: World, villagers: readonly Villager[]): Villager | null {
  let best: { villager: Villager; distance: number } | null = null;
  for (const villager of villagers) {
    const distance = distanceToWood(world, villager.cell);
    if (distance === null) {
      continue;
    }
    if (hasCompany(villager, villagers)) {
      continue;
    }
    const closer = best === null || distance < best.distance;
    const tied = best !== null && distance === best.distance && villager.id < best.villager.id;
    if (closer || tied) {
      best = { villager, distance };
    }
  }
  return best?.villager ?? null;
}

function hasCompany(villager: Villager, villagers: readonly Villager[]): boolean {
  for (const other of villagers) {
    if (other.id === villager.id) {
      continue;
    }
    if (
      Math.abs(other.cell.gx - villager.cell.gx) <= COMPANY_RADIUS &&
      Math.abs(other.cell.gy - villager.cell.gy) <= COMPANY_RADIUS
    ) {
      return true;
    }
  }
  return false;
}

/**
 * How far this cell is from the wood a pack could come out of, or `null` when it
 * is out of reach or screened by a palisade.
 *
 * The screen is tested against the *nearest* tree cell, which is the one the pack
 * would come from: a fence between the two and the cell is not worth attacking.
 * Every tree cell within reach is checked rather than only the closest, so a
 * settlement cannot be caught out by a fence that screens one side of a wood and
 * not the other.
 */
function distanceToWood(world: World, cell: GridPoint): number | null {
  let nearest: number | null = null;
  for (let gy = cell.gy - WOLF_REACH; gy <= cell.gy + WOLF_REACH; gy += 1) {
    for (let gx = cell.gx - WOLF_REACH; gx <= cell.gx + WOLF_REACH; gx += 1) {
      if (!world.terrain.contains(gx, gy) || !world.trees.has({ gx, gy })) {
        continue;
      }
      if (world.fences.screens({ gx, gy }, cell)) {
        continue;
      }
      const distance = Math.max(Math.abs(gx - cell.gx), Math.abs(gy - cell.gy));
      if (nearest === null || distance < nearest) {
        nearest = distance;
      }
    }
  }
  return nearest;
}
