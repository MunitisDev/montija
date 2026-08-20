/**
 * A scripted player, for measuring difficulty without a browser.
 *
 * Balance is a question about outcomes — does an attentive player survive the
 * first winter, does a careless one die — and outcomes take a simulated year to
 * observe. Judging that by hand in the browser is slow and irreproducible, and
 * a year at 1x is five minutes of watching. Because the simulation is pure
 * TypeScript, the same year runs headlessly in well under a second and is
 * deterministic from the seed, so a balance change can be measured rather than
 * guessed at.
 *
 * The scripted players below are deliberately crude. They are not an AI and are
 * not trying to play well; they stand for recognisable levels of attention, so
 * that "is winter too harsh?" becomes a question with an answer.
 */

import { Simulation } from '@/simulation/Simulation';
import { FOOD_IDS } from '@/data/resources';
import { STARTING_VILLAGERS, WORLD_HEIGHT, WORLD_WIDTH } from '@/app/config';
import type { BuildingId } from '@/data/buildings';
import { buildingDefinition } from '@/data/buildings';
import type { GridPoint } from '@/shared/types/geometry';
import { DAYS_PER_SEASON, TICKS_PER_DAY, TICKS_PER_YEAR } from '@/simulation/seasons/SeasonClock';

export interface DayRecord {
  readonly day: number;
  readonly season: string;
  readonly villagers: number;
  readonly deaths: number;
  readonly food: number;
  readonly firewood: number;
  readonly logs: number;
  readonly looseFood: number;
  readonly foodEaten: number;
  readonly foodShortfall: number;
  readonly firewoodShortfall: number;
  readonly spoiledFood: number;
  readonly lowestHunger: number;
  readonly lowestWarmth: number;
  readonly lowestHealth: number;
}

export interface PlaytestResult {
  readonly survivors: number;
  readonly deaths: number;
  /** Day of the first death, or null if nobody died. */
  readonly firstDeathDay: number | null;
  /** Stores at the moment winter began. */
  readonly atWinter: { food: number; firewood: number };
  /** Lowest food and firewood seen at any point. */
  readonly lowest: { food: number; firewood: number };
  readonly buildings: readonly BuildingId[];
  /** Share of villager-ticks spent in each activity, as percentages. */
  readonly activity: Record<string, number>;
  /** Most production jobs ever running at once, so idle slots are visible. */
  readonly maxConcurrentProduce: number;
  readonly log: readonly DayRecord[];
}

/** Decides what the player does, once per simulated day. */
export type PlayerScript = (simulation: Simulation, day: number) => void;

/**
 * Runs a settlement for a number of days, letting the script act each day.
 *
 * The simulation is driven directly rather than through the clock: balance
 * cares about simulated days, not about frame pacing.
 */
export function playtest(options: {
  seed: number;
  days: number;
  script: PlayerScript;
  villagers?: number;
}): PlaytestResult {
  // Founded exactly as the game founds it, or the measurement is of something
  // the player never plays.
  const simulation = new Simulation({
    seed: options.seed,
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    startingVillagers: options.villagers ?? STARTING_VILLAGERS,
  });
  const log: DayRecord[] = [];

  let firstDeathDay: number | null = null;
  let atWinter: { food: number; firewood: number } | null = null;
  let lowestFood = Infinity;
  let lowestFirewood = Infinity;

  const activityTicks = new Map<string, number>();
  let sampled = 0;
  let maxConcurrentProduce = 0;

  for (let day = 1; day <= options.days; day++) {
    options.script(simulation, day);

    for (let i = 0; i < TICKS_PER_DAY; i++) {
      simulation.update(simulation.tick + 1, 0.1);
      let producing = 0;
      for (const villager of simulation.villagers.all) {
        const job =
          villager.currentJobId === null ? null : simulation.jobs.get(villager.currentJobId);
        const key = job ? `${job.type}:${job.state === 'inProgress' ? 'work' : 'travel'}` : 'idle';
        activityTicks.set(key, (activityTicks.get(key) ?? 0) + 1);
        sampled += 1;
        if (job?.type === 'produce') {
          producing += 1;
        }
      }
      maxConcurrentProduce = Math.max(maxConcurrentProduce, producing);
    }

    const snapshot = simulation.snapshot();
    // **The larder, not one kind of it.** There are five foods now and a
    // settlement lives on the sum; measuring one of them would report a famine
    // every time the settlement changed what it grew.
    lowestFood = Math.min(lowestFood, snapshot.food.stored);
    lowestFirewood = Math.min(lowestFirewood, snapshot.stored.firewood);

    if (snapshot.deaths > 0 && firstDeathDay === null) {
      firstDeathDay = day;
    }
    if (snapshot.season === 'winter' && atWinter === null) {
      atWinter = { food: snapshot.food.stored, firewood: snapshot.stored.firewood };
    }

    log.push({
      day,
      season: snapshot.season,
      villagers: snapshot.villagerCount,
      deaths: snapshot.deaths,
      food: snapshot.food.stored,
      firewood: snapshot.stored.firewood,
      logs: snapshot.stored.logs,
      looseFood: snapshot.food.loose,
      foodEaten: snapshot.lastDay.foodEaten,
      foodShortfall: snapshot.lastDay.foodShortfall,
      firewoodShortfall: snapshot.lastDay.firewoodShortfall,
      spoiledFood: FOOD_IDS.reduce((sum, id) => sum + (snapshot.spoiled.lost[id] ?? 0), 0),
      lowestHunger: lowestNeed(simulation, 'hunger'),
      lowestWarmth: lowestNeed(simulation, 'warmth'),
      lowestHealth: snapshot.lowestHealth,
    });
  }

  const final = simulation.snapshot();
  return {
    survivors: final.villagerCount,
    deaths: final.deaths,
    firstDeathDay,
    atWinter: atWinter ?? { food: 0, firewood: 0 },
    lowest: { food: lowestFood, firewood: lowestFirewood },
    buildings: [...simulation.world.buildings.all].map((building) => building.definition.id),
    maxConcurrentProduce,
    activity: Object.fromEntries(
      [...activityTicks.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, ticks]) => [key, Math.round((ticks / Math.max(1, sampled)) * 100)])
        .filter(([, share]) => (share as number) > 0),
    ),
    log,
  };
}

/** The day a given season starts, counting from day 1 of the first spring. */
export function firstDayOf(season: 'spring' | 'summer' | 'autumn' | 'winter'): number {
  const index = ['spring', 'summer', 'autumn', 'winter'].indexOf(season);
  return index * DAYS_PER_SEASON + 1;
}

export const DAYS_PER_YEAR = TICKS_PER_YEAR / TICKS_PER_DAY;

/**
 * Marks up to `count` trees nearest the settlement centre for felling.
 *
 * Stands for a player tapping trees near home rather than hunting for the
 * closest one, which is what the felling and hauling distances should be
 * balanced against.
 */
export function designateNearbyTrees(simulation: Simulation, count: number): number {
  const centre = settlementCentre(simulation);
  let marked = 0;

  for (const cell of spiral(centre, 30)) {
    if (marked >= count) {
      break;
    }
    if (canReach(simulation, cell) && simulation.designateTreeForFelling(cell)) {
      marked += 1;
    }
  }
  return marked;
}

/** Marks up to `count` stone deposits near the settlement. */
export function designateNearbyStone(simulation: Simulation, count: number): number {
  const centre = settlementCentre(simulation);
  let marked = 0;

  for (const cell of spiral(centre, 40)) {
    if (marked >= count) {
      break;
    }
    if (canReach(simulation, cell) && simulation.designateStoneForMining(cell)) {
      marked += 1;
    }
  }
  return marked;
}

/**
 * Places a building on the first workable spot near the settlement.
 *
 * Returns false when nothing nearby will take it, which is itself a balance
 * signal: a settlement that cannot find room for a hut has a different problem
 * from one that cannot afford it.
 */
export function buildNearby(
  simulation: Simulation,
  buildingId: BuildingId,
  /**
   * How far out to look, in cells.
   *
   * Default for anything that can stand on open ground. A Quarry and a Mine must
   * touch a rock face, and on some seeds the nearest one is a long way off — so
   * those need a wider search or they silently never get built, which reads in
   * the results as "the quarry did not help" rather than "there was no quarry".
   */
  radius = 30,
): boolean {
  const centre = settlementCentre(simulation);
  const { footprint } = buildingDefinition(buildingId);

  for (const cell of spiral(centre, radius)) {
    // Keep a gap around the centre so buildings do not wall in the yard.
    if (simulation.canPlaceBuilding(buildingId, cell).ok) {
      return simulation.placeBuilding(buildingId, cell) !== null;
    }
    // Trees are cleared by felling, not by placement, so a cell full of trees
    // is skipped rather than waited on.
    void footprint;
  }
  return false;
}

/** How many buildings of a type exist, finished or not. */
export function countOf(simulation: Simulation, buildingId: BuildingId): number {
  return [...simulation.world.buildings.all].filter(
    (building) => building.definition.id === buildingId,
  ).length;
}

/** True once a building of this type is standing and finished. */
export function has(simulation: Simulation, buildingId: BuildingId): boolean {
  return [...simulation.world.buildings.all].some(
    (building) => building.definition.id === buildingId && building.isComplete,
  );
}

/** True once one is standing or being built, so it is not ordered twice. */
export function ordered(simulation: Simulation, buildingId: BuildingId): boolean {
  return [...simulation.world.buildings.all].some(
    (building) => building.definition.id === buildingId,
  );
}

function lowestNeed(simulation: Simulation, key: 'hunger' | 'warmth'): number {
  let lowest = 100;
  for (const villager of simulation.villagers.all) {
    lowest = Math.min(lowest, villager.needs[key]);
  }
  return lowest;
}

/**
 * Whether somebody in the settlement could walk to a cell, or beside it.
 *
 * **What the river added to every one of these helpers.** They stand in for a
 * player, and a player can see that the trees on the far bank are across the
 * water; a spiral search cannot. Without this the helpers mark forty trees, half
 * of them unreachable, and the settlement looks lazy while it is in fact
 * standing on the wrong side of a river.
 *
 * Answered of the cell or any of its neighbours, because the things worth
 * marking — a tree, a rock face — are not walkable themselves. Somebody has to
 * be able to stand next to them.
 */
export function canReach(simulation: Simulation, cell: GridPoint): boolean {
  const heart = simulation.world.heartCell;
  const navigation = simulation.world.navigation;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (navigation.connects(heart, { gx: cell.gx + dx, gy: cell.gy + dy })) {
        return true;
      }
    }
  }
  return false;
}

/** The nearest tree the settlement could actually walk to. */
export function reachableTree(simulation: Simulation): GridPoint {
  const found = nearbyTrees(simulation, 1)[0];
  if (!found) {
    throw new Error('No tree within reach of the settlement');
  }
  return found;
}

/**
 * The nearest `count` trees the settlement could walk to, nearest first.
 *
 * Returned rather than marked, because half these tests want the tree ids to
 * check afterwards which of them actually came down.
 */
export function nearbyTrees(simulation: Simulation, count: number): GridPoint[] {
  const cells: GridPoint[] = [];
  for (const cell of spiral(settlementCentre(simulation), 40)) {
    if (cells.length >= count) {
      break;
    }
    if (simulation.world.trees.has(cell) && canReach(simulation, cell)) {
      cells.push(cell);
    }
  }
  return cells;
}

function settlementCentre(simulation: Simulation): GridPoint {
  const yard = simulation.storages.all[0];
  if (yard) {
    return yard.cell;
  }
  return {
    gx: Math.floor(simulation.world.width / 2),
    gy: Math.floor(simulation.world.height / 2),
  };
}

/** Cells in rings outward from a centre, so "nearby" means what it says. */
function* spiral(centre: GridPoint, radius: number): Generator<GridPoint> {
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Only the newly added ring, so cells are visited nearest-first.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) {
          continue;
        }
        yield { gx: centre.gx + dx, gy: centre.gy + dy };
      }
    }
  }
}
