/**
 * Fire, which is the settlement's own plan coming back at it.
 *
 * **The rule this file is written around: a fire is never bad luck.** Random
 * destruction is the classic way to make a survival game feel unfair, and the
 * fix is not to make fires rare — it is to make every part of one a consequence
 * of a decision the player made and can see:
 *
 * - **What starts it** is what the buildings do. A hearth burns only on the
 *   nights it is lit, so a summer settlement cannot catch; a forge is hot
 *   whenever somebody is working it. Nothing else in the settlement starts a
 *   fire on its own, however dry the year.
 * - **How likely it is** is how tightly the settlement is built. Every neighbour
 *   within {@link CROWDING_RADIUS} raises the risk, so a village packed shoulder
 *   to shoulder round its forge is asking for it and a spread-out one is not.
 * - **Whether it costs anything** is whether there is water within reach. That is
 *   a Well, or the river, or a channel dug from it — a decision made seasons
 *   before the fire, which is exactly where the decision should live.
 * - **How far it goes** is what the settlement put between its buildings. A road,
 *   a channel or the river breaks the line and the fire stops; bare ground does
 *   not. Roads and ditches were laid for other reasons and now do this as well.
 *
 * - **Whether anybody dies** is who was inside and whether they could get out.
 *   This was the one part of a fire that used to cost nothing: for a long while
 *   the rule here was that a fire took buildings and never a life, because the
 *   game has enough ways to kill people and none of them should be a dice roll.
 *   That reasoning holds; what it got wrong is that this is not a dice roll
 *   either. Every roll above has already been decided by the plan — a fire only
 *   reaches people in a building the settlement could not put out, which is to
 *   say a building the player left out of reach of water, and the number of
 *   people in it is the number the player put there. A settlement that keeps its
 *   houses by the water never loses anybody to a fire at all.
 *
 * So a building that is **lost** endangers the people who belong to it: a
 * household in its beds on the freezing night its own hearth catches, or the
 * workers at the forge that caught while they were working it. Most get out.
 * Whoever was already ill is likelier not to, which is the one place in the game
 * where sickness kills directly, and it kills for a legible reason.
 *
 * Deterministic from the settlement's own stream, like every other slow process:
 * the same seed and the same plan burn on the same night.
 */

import { cellLine } from '@/shared/math/gridLine';
import type { GridPoint } from '@/shared/types/geometry';
import type { Building } from '@/simulation/buildings/Building';
import type { Villager } from '@/simulation/villagers/Villager';
import type { World } from '@/simulation/world/World';

/**
 * Chance a lit hearth sets its own roof alight, per freezing night.
 *
 * Small, and small on purpose: with fourteen freezing days in a year, a village
 * of ten houses sees rather less than one hearth fire a year before crowding is
 * counted. A fire should be a thing a player remembers, not a tax they resent.
 */
export const HEARTH_FIRE_CHANCE = 0.0018;

/**
 * Chance a working forge does, per day, whatever the season.
 *
 * The one fire in the settlement that does not wait for winter — which is what
 * makes *where you put the Blacksmith* a decision rather than a formality.
 */
export const FORGE_FIRE_CHANCE = 0.0012;

/** How close another building has to be to count as crowding, in cells. */
export const CROWDING_RADIUS = 2;

/**
 * What each crowding neighbour adds to the risk.
 *
 * Half again per neighbour: two buildings crammed against a house double its
 * risk, which is enough to be felt across a settlement's lifetime and not enough
 * to make a compact village unplayable. Compactness is worth real hauling time,
 * so this has to be a pressure rather than a prohibition.
 */
export const CROWDING_STEP = 0.5;

/** How far a fire can jump to the next building, in cells. */
export const SPREAD_REACH = 3;

/**
 * Chance somebody inside a building the settlement lost does not get out.
 *
 * A quarter, and the arithmetic behind it matters more than the figure: a house
 * only burns down when there was no water within reach of it, which in a
 * well-planned settlement is never. Ten houses lit through fourteen freezing
 * nights catch about once every four years before crowding is counted, and a
 * household is three or four people — so this is one life every several years in
 * a settlement that built away from water, and none at all in one that did not.
 *
 * Rolled per person rather than once for the building, so a cottage with eight
 * people in it risks twice what a cottage with four risks. That is the crowding
 * decision again, and it is the same decision that made the fire likelier in the
 * first place.
 */
export const TRAPPED_CHANCE = 0.25;

/**
 * How much likelier somebody already ill is not to get out.
 *
 * Twice, and this is the only place in the game where illness kills anybody
 * directly. It is worth the exception because it is not a hidden roll: a player
 * who can see who is unwell and can see which houses have no water can see this
 * coming, which is the whole difference between a consequence and a punishment.
 */
export const ILL_TRAPPED_MULTIPLIER = 2;

/** What happened to the settlement's buildings today. */
export interface FireReport {
  /** The building that caught tonight, or `null` on the ordinary night. */
  readonly started: number | null;
  /** Burning buildings the water reached. They stand. */
  readonly saved: readonly number[];
  /** Burning buildings nobody could reach. They are gone. */
  readonly lost: readonly number[];
  /** Buildings the fire jumped to, which burn tomorrow. */
  readonly spread: readonly number[];
  /**
   * Villagers who were inside a building that was lost and did not get out.
   *
   * Ids rather than the villagers themselves, because this system decides and
   * `Simulation` owns what a death means for the settlement's roll, its jobs and
   * its households.
   */
  readonly trapped: readonly number[];
}

export const NO_FIRE: FireReport = {
  started: null,
  saved: [],
  lost: [],
  spread: [],
  trapped: [],
};

export interface FireOptions {
  readonly world: World;
  /**
   * Where the night's luck comes from.
   *
   * Narrowed to the one method this system uses, so a test can hand it a night
   * that always catches or one that never does — which is the only way to hold a
   * rule that fires once every four years to account.
   */
  readonly random: { next(): number };
  /** `true` on the nights hearths are lit. */
  readonly isFreezing: boolean;
  /** Whether water can be fetched to a cell. See `world/Water.ts`. */
  readonly waterAt: (cell: GridPoint) => boolean;
  /**
   * Everybody in the settlement, so the system can work out who was indoors.
   *
   * Handed the whole list rather than a per-building lookup because who counts
   * as inside a burning building is a fire rule, and fire rules live here.
   */
  readonly villagers: readonly Villager[];
}

/**
 * Runs one day of fire: resolves what is already burning, then lights at most
 * one new fire.
 *
 * **Resolution first, and only one ignition a day.** A settlement that could
 * lose three buildings in a night is a settlement the player cannot plan
 * against, and the point of the whole system is that the plan is what decides
 * the outcome.
 *
 * The caller does the destroying: this system decides, and `Simulation` owns
 * what pulling a building down means for its people, its jobs and its yard.
 */
export function runFire(options: FireOptions): FireReport {
  const { world, random, isFreezing, waterAt, villagers } = options;

  const saved: number[] = [];
  const lost: number[] = [];
  const spread: number[] = [];
  const trapped: number[] = [];

  // **Snapshotted before anything is resolved**, and it has to be: a fire that
  // jumps sets its neighbour alight, and walking the registry live meant the loop
  // reached that neighbour a moment later, burned it down too, and chained across
  // a settlement in a single night. What catches tonight burns tomorrow.
  const alight = [...world.buildings.all].filter((building) => building.burning);

  for (const building of alight) {
    building.burning = false;

    if (waterAt(building.accessCell)) {
      // Buckets from the well, and the roof survives. What it cost is the
      // building's own stores — a workshop's raw material and whatever was
      // waiting to be built with — which is the fright rather than the disaster.
      building.input.clear();
      building.materials.clear();
      saved.push(building.id);
      continue;
    }

    lost.push(building.id);
    // The roof is gone, and the people under it have to get themselves out.
    // Before the fire jumps, so the order the report reads in is the order the
    // night happened in.
    for (const villager of occupants(villagers, building)) {
      const risk = TRAPPED_CHANCE * (villager.isIll ? ILL_TRAPPED_MULTIPLIER : 1);
      if (random.next() < risk) {
        trapped.push(villager.id);
      }
    }

    const next = nearestCatch(world, building);
    if (next) {
      next.burning = true;
      spread.push(next.id);
    }
  }

  // Nothing new while something is still alight: one fire at a time is what
  // keeps a bad night from being an unrecoverable one.
  if (spread.length > 0) {
    return { started: null, saved, lost, spread, trapped };
  }

  const started = ignite(world, random, isFreezing);
  return { started, saved, lost, spread, trapped };
}

/**
 * The people who were inside a building when it went.
 *
 * Two kinds, and between them they cover every building that has anybody in it:
 * the **household**, who are in their beds on the freezing night their own
 * hearth catches, and the **workers**, who are at the bench of a forge that only
 * catches while somebody is working it. A hearth fire is a night fire and a forge
 * fire a working-hours one, so in both cases the people who belong to the
 * building are the people who are in it.
 *
 * Anyone whose home *and* workplace this was is counted once.
 */
function occupants(villagers: readonly Villager[], building: Building): readonly Villager[] {
  return villagers.filter(
    (villager) => villager.homeId === building.id || villager.employerId === building.id,
  );
}

/**
 * Rolls for tonight's fire, and returns the building that caught.
 *
 * Every candidate is rolled for rather than one being chosen and then rolled,
 * so the settlement's risk grows with the number of hearths it lights — which is
 * the honest reading of "more houses, more chances". The first to catch is the
 * only one: see {@link runFire}.
 */
function ignite(world: World, random: { next(): number }, isFreezing: boolean): number | null {
  for (const building of world.buildings.all) {
    const risk = building.definition.fireRisk;
    if (!risk || !building.isComplete) {
      continue;
    }
    // A hearth is only a fire on the nights it is lit, and a forge only while
    // somebody is working it.
    if (risk === 'hearth' && !isFreezing) {
      continue;
    }
    if (risk === 'forge' && building.workers.length === 0) {
      continue;
    }

    const base = risk === 'hearth' ? HEARTH_FIRE_CHANCE : FORGE_FIRE_CHANCE;
    const chance = base * (1 + CROWDING_STEP * neighbours(world, building));
    if (random.next() < chance) {
      building.burning = true;
      return building.id;
    }
  }

  return null;
}

/** How many other finished buildings crowd this one. */
function neighbours(world: World, building: Building): number {
  let count = 0;
  for (const other of world.buildings.all) {
    if (other.id === building.id || !other.isComplete) {
      continue;
    }
    if (within(building.accessCell, other.accessCell, CROWDING_RADIUS)) {
      count += 1;
    }
  }
  return count;
}

/**
 * The building a fire would take next, or `null` when it has nowhere to go.
 *
 * The nearest one within reach that is **not screened**: a road, a channel or
 * the river anywhere on the line between the two stops it. That is the firebreak,
 * and it is deliberately the same roads and ditches the settlement laid for
 * hauling and for water — a rule the player already understands, doing a second
 * job.
 */
function nearestCatch(world: World, source: Building): Building | null {
  let best: Building | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const other of world.buildings.all) {
    if (other.id === source.id || !other.isComplete || other.burning) {
      continue;
    }
    if (!within(source.accessCell, other.accessCell, SPREAD_REACH)) {
      continue;
    }
    if (screened(world, source.accessCell, other.accessCell)) {
      continue;
    }
    const distance =
      Math.abs(source.accessCell.gx - other.accessCell.gx) +
      Math.abs(source.accessCell.gy - other.accessCell.gy);
    // Ties broken by id, so a settlement replayed from its seed burns the same
    // way twice.
    if (
      distance < bestDistance ||
      (distance === bestDistance && best !== null && other.id < best.id)
    ) {
      best = other;
      bestDistance = distance;
    }
  }

  return best;
}

/** `true` when a road, a channel or the river lies between two cells. */
function screened(world: World, from: GridPoint, to: GridPoint): boolean {
  for (const cell of cellLine(from, to)) {
    if (world.roads.hasAt(cell)) {
      return true;
    }
    if (world.terrain.contains(cell.gx, cell.gy) && world.terrainAt(cell) === 'ditch') {
      return true;
    }
    if (world.terrain.contains(cell.gx, cell.gy) && world.terrainAt(cell) === 'water') {
      return true;
    }
  }
  return false;
}

function within(a: GridPoint, b: GridPoint, radius: number): boolean {
  return Math.abs(a.gx - b.gx) <= radius && Math.abs(a.gy - b.gy) <= radius;
}
