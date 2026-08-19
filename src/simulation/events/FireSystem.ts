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
 * Nobody is hurt. The game has enough ways to kill people and none of them are a
 * dice roll; a fire takes buildings, which are rebuildable, and never a life.
 *
 * Deterministic from the settlement's own stream, like every other slow process:
 * the same seed and the same plan burn on the same night.
 */

import { cellLine } from '@/shared/math/gridLine';
import type { GridPoint } from '@/shared/types/geometry';
import type { Building } from '@/simulation/buildings/Building';
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
}

export const NO_FIRE: FireReport = { started: null, saved: [], lost: [], spread: [] };

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
  const { world, random, isFreezing, waterAt } = options;

  const saved: number[] = [];
  const lost: number[] = [];
  const spread: number[] = [];

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
    const next = nearestCatch(world, building);
    if (next) {
      next.burning = true;
      spread.push(next.id);
    }
  }

  // Nothing new while something is still alight: one fire at a time is what
  // keeps a bad night from being an unrecoverable one.
  if (spread.length > 0) {
    return { started: null, saved, lost, spread };
  }

  const started = ignite(world, random, isFreezing);
  return { started, saved, lost, spread };
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
