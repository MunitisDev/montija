/**
 * The authoritative game state.
 *
 * Status: Phase 8. Owns the seed, the RNG, the tick counter, the world, the
 * villagers, the job board, the storage yards, the calendar and survival.
 *
 * Rules for everything added here later:
 * - no Phaser, no DOM, no `Math.random()` (all enforced by ESLint);
 * - all mutation happens inside `update()`, driven by the SimulationClock;
 * - the renderer reads, never writes. Player intent arrives as commands.
 */

import type { GridPoint } from '@/shared/types/geometry';
import { SeededRandom, deriveSeed, type RandomSource } from '@/shared/math/random';
import { STARTING_RESOURCES } from '@/app/config';
import type { BuildingId } from '@/data/buildings';
import { recipe as findRecipe } from '@/data/recipes';
import { RESOURCE_IDS, resourceDefinition, type ResourceId } from '@/data/resources';
import { SKILL_WORK_BONUS } from '@/data/skills';
import type { Building } from './buildings/Building';
import type { PlacementCheck } from './buildings/BuildingRegistry';
import { isFinished, JobPriority } from './jobs/Job';
import { JobManager } from './jobs/JobManager';
import { StorageRegistry } from './logistics/Storage';
import {
  AUTOMATIC_TRADE,
  NO_TRADE,
  runTrade,
  type TradeOrder,
  type TradeReport,
} from './logistics/TradeSystem';
import { newChronicle, type Chronicle } from './history/Chronicle';
import { causeOfDeath, Necrology, type DeathRecord } from './history/Necrology';
import type { ResourcePile } from './resources/ResourcePile';
import { WearLedger } from './resources/wear';

import {
  DAYS_PER_SEASON,
  SEASONAL_YIELD,
  TICKS_PER_DAY,
  isDayBoundary,
  yearStateAt,
  type Season,
  type YearState,
} from './seasons/SeasonClock';
import {
  NO_POPULATION_CHANGE,
  runPopulationDay,
  type PopulationReport,
} from './population/PopulationSystem';
import {
  NO_EMPLOYMENT_CHANGE,
  runEmployment,
  type EmploymentReport,
} from './population/EmploymentSystem';
import {
  NO_SKILL_CHANGE,
  inheritTrades,
  runSkillDay,
  type SkillReport,
} from './population/SkillSystem';
import {
  HERBS_PER_PATIENT_PER_DAY,
  NO_ILLNESS,
  runIllness,
  type IllnessReport,
} from './population/IllnessSystem';
import { NO_SPOILAGE, runSpoilage, type SpoilageReport } from './resources/SpoilageSystem';
import {
  EMPTY_REPORT,
  runDay,
  spiritWorkBonus,
  TOOL_WORK_BONUS,
  type DailyReport,
} from './seasons/SurvivalSystem';
import { VillagerSystem } from './villagers/VillagerSystem';
import { CARRY_CAPACITY, type WorkPreference } from './villagers/Villager';
import { World } from './world/World';
import { NO_FOREST_CHANGE, runForestRegrowth, type ForestReport } from './world/ForestSystem';
import { Woodland } from './world/Woodland';
import type { TreeInstance } from './world/WorldGenerator';

/**
 * Ticks between forestry passes.
 *
 * Counting the trees in a lodge's range is the one genuinely superlinear thing
 * in this file, and no forestry decision changes meaningfully inside two and a
 * half seconds of play.
 */
const FORESTRY_INTERVAL_TICKS = 25;

/** Felling jobs a single lodge may post in one pass. */
const FELLING_PER_PASS = 3;

/**
 * Unworked felling orders a lodge is allowed to have standing at once.
 *
 * **This is the fix to a bug a player found by looking at the screen.** The
 * per-pass cap below limits the *rate* a lodge posts work at and says nothing
 * about the backlog, so a lodge in a dense wood — where the standing count is
 * three hundred against a target of a hundred and ten — added three more orders
 * every two and a half seconds for as long as it stood. Villagers fell far
 * slower than that, so the marks piled up without bound and the map filled with
 * felling crosses nobody had asked for. From the outside it looked exactly like
 * the trees were being cut down on their own.
 *
 * A standing order instead: top up to a handful, and post nothing more until
 * somebody has worked them. The lodge still clears its surplus at exactly the
 * rate the settlement can actually cut, which is the only rate that was ever
 * real.
 */
const OUTSTANDING_FELLING_PER_LODGE = 4;

/** Ticks between employment passes. Nobody changes job inside two seconds. */
const EMPLOYMENT_INTERVAL_TICKS = 25;

/** The share of a building's cost that comes back when it is pulled down. */
const SALVAGE_SHARE = 0.5;

/**
 * How far the founding yard reaches from the cell it is recorded at.
 *
 * The settlers' stores are a single point in the simulation and three cells
 * across on screen, and that discrepancy has to be agreed on by everything that
 * cares: the ground it clears, the taps it answers to, and the sprite drawn for
 * it. One radius here rather than three copies that can drift apart.
 */
export const FOUNDING_YARD_RADIUS = 1;

/**
 * What the settlement most needs to hear about, or `null` when all is well.
 *
 * The simulation reports the condition; whether and how to show it is the UI's
 * business, and the wording is the translation layer's.
 */
export type Advice =
  | 'starving'
  | 'freezing'
  /** Sites are standing half-built waiting for a material nobody has any of. */
  | 'siteStalled'
  /** Nothing in the settlement fells trees, so no timber is ever coming. */
  | 'noFeller'
  /** Goods are lying in the field with no yard that will take them. */
  | 'storageFull'
  /** The yards are nearly full, and will start turning goods away. */
  | 'storageFilling'
  /** The larders are nearly full, and the next harvest has nowhere to go. */
  | 'larderFilling'
  | 'noShelter'
  | 'foodLow'
  | 'needMoreHuts'
  | 'foodSpoiling'
  | 'firewoodLow'
  | 'firewoodShort'
  | null;

/**
 * How full a set of stores has to be before the settlement is warned.
 *
 * Nine tenths, because the warning has to arrive while there is still time to do
 * something: a yard that has actually filled is already turning goods away, and
 * by then the answer is "you needed another one yesterday".
 */
export const STORAGE_WARNING_FRACTION = 0.9;

/**
 * Days a heap may lie on the ground before carrying it beats making more.
 *
 * Twelve, which is a season — the player's own figure, and the right one: it is
 * long enough that an ordinary busy day, or a hauler taking the long way round,
 * never trips it, and short enough that a settlement cannot spend a whole season
 * producing onto ground nobody clears.
 *
 * What it guards against is a specific and previously fatal shape: every pair of
 * hands employed, so nothing is left to haul, and a workshop's own work being
 * `urgent` means its people keep making more. See `haulWorth`.
 */
export const STALE_PILE_DAYS = 12;

/**
 * How far from its doorway a workshop's own output can land, in cells.
 *
 * Output is dropped at the doorway and spills to the next free cell when that
 * one is taken, so three covers a busy doorway and takes in nothing that the
 * workshop did not make.
 */
const OUTPUT_RADIUS = 3;

/** `true` when a set of stores exists and is nearly full. */
function nearlyFull(fill: { readonly used: number; readonly capacity: number }): boolean {
  // Capacity of nothing is not fullness — a settlement with no larder at all is
  // a different problem with a different sentence.
  return fill.capacity > 0 && fill.used / fill.capacity >= STORAGE_WARNING_FRACTION;
}

/**
 * Roughly how many villagers one Gatherer Hut keeps fed.
 *
 * Measured rather than assumed: a two-slot hut yields around six food a day
 * across the growing seasons, against one eaten per villager per day. It is
 * used only for advice, so being approximate is fine — but it must track the
 * recipe, or the game will tell the player something untrue.
 */
export const VILLAGERS_FED_PER_GATHERER_HUT = 6;

/** A read-only view of the simulation, safe to hand to the renderer and HUD. */
export interface SimulationSnapshot {
  readonly seed: number;
  readonly tick: number;
  readonly villagerCount: number;
  readonly treeCount: number;
  readonly walkingCount: number;
  readonly workingCount: number;
  readonly pathRequests: number;
  readonly pathFailures: number;
  readonly jobsAvailable: number;
  readonly jobsAssigned: number;
  readonly jobsCompleted: number;
  readonly pileCount: number;
  readonly buildingCount: number;
  readonly sitesUnderConstruction: number;
  readonly housingCapacity: number;
  readonly season: Season;
  readonly year: number;
  readonly dayOfSeason: number;
  readonly temperature: number;
  /** What the settlement ate and burned on the last day that passed. */
  readonly lastDay: DailyReport;
  /** What went bad overnight, so the HUD can explain a falling total. */
  readonly spoiled: SpoilageReport;
  /** Births, old age, homelessness and the split between adults and children. */
  readonly population: PopulationReport;
  /** Saplings that took root overnight, so a recovering wood is legible. */
  readonly forest: ForestReport;
  /** Who is employed where, so the HUD can show labourers and vacancies. */
  readonly employment: EmploymentReport;
  /** What the merchant did today, and whether one is here at all. */
  readonly trade: TradeReport;
  /** Who is unwell, and how much of it the settlement is able to treat. */
  readonly illness: IllnessReport;
  /** Who reached a new level at their trade today, so the HUD can say so. */
  readonly skills: SkillReport;
  /** Lifetime totals: the settlement's own history, recorded as it happens. */
  readonly chronicle: Readonly<Chronicle>;
  /** The roll of the dead: who, how old, and of what. Oldest entry first. */
  readonly necrology: readonly DeathRecord[];
  readonly deaths: number;
  /** Lowest health among the living, so the HUD can warn before people die. */
  readonly lowestHealth: number;
  /**
   * The single most urgent thing wrong, or `null` when nothing is.
   *
   * One warning at a time on purpose: a stack of advice is noise, and the
   * player needs to know what to do *next*, not everything that could ever go
   * wrong.
   */
  readonly advice: Advice;
  /**
   * The material stalling construction, when `advice` is `siteStalled`.
   *
   * Carried alongside rather than baked into the advice, because "waiting for
   * stone" and "waiting for iron" are the same condition and the player needs
   * the noun. An advice that could not name it would send them looking.
   */
  readonly stalledMaterial: ResourceId | null;
  /**
   * `true` once the last villager is gone.
   *
   * The simulation has always known this and nothing ever asked. The MVP's
   * final requirement is "survive or fail in winter", and a failure nobody
   * reports is a game that simply stops meaning anything while still running.
   */
  readonly hasFailed: boolean;
  /**
   * Stored totals per resource.
   *
   * A **cached summary** of what the storage yards physically hold. Resources
   * lying on the ground are deliberately excluded, so felling a tree does not
   * move the counter until someone has carried the logs in.
   */
  readonly stored: Readonly<Record<ResourceId, number>>;
  /** Units lying on the ground, waiting to be hauled. */
  readonly loose: Readonly<Record<ResourceId, number>>;
}

export interface SimulationOptions {
  readonly seed: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** Founding population. The MVP starts with roughly ten. */
  readonly startingVillagers: number;
}

/**
 * The reservation id for "this site's next load of a material".
 *
 * Offset well clear of the pile ids, which are small integers counted from one.
 * They share the `haul` reservation namespace, and a settlement that had felled a
 * hundred trees would have a pile whose id collided with a site's stone
 * reservation — at which point one of the two silently stops being posted, which
 * is a bug that looks like a stalled building.
 */
const MATERIAL_RESERVATION_BASE = 250_000;

/**
 * How far from a walled-in store to look for a new doorway.
 *
 * Generous, because the alternative is a store nobody can fetch from: a camp
 * boxed in on every side by the player's own first three buildings still has open
 * ground a few cells further out, and reaching it around the outside of them is a
 * short walk rather than an impossibility.
 */
const DOORWAY_RESCUE = 8;

function materialReservation(siteId: number, resource: ResourceId): number {
  return MATERIAL_RESERVATION_BASE + siteId * 100 + RESOURCE_IDS.indexOf(resource);
}

export class Simulation {
  public readonly world: World;
  public readonly villagers: VillagerSystem;
  public readonly jobs: JobManager;
  public readonly storages = new StorageRegistry();

  private readonly seed: number;
  private readonly tickRandom: RandomSource;
  private currentTick = 0;
  private lastDayReport: DailyReport = EMPTY_REPORT;
  private lastSpoilage: SpoilageReport = NO_SPOILAGE;
  private lastPopulation: PopulationReport = NO_POPULATION_CHANGE;
  private lastForest: ForestReport = NO_FOREST_CHANGE;
  private lastEmployment: EmploymentReport = NO_EMPLOYMENT_CHANGE;
  private lastTrade: TradeReport = NO_TRADE;
  private lastIllness: IllnessReport = NO_ILLNESS;
  /**
   * What the player has told the post to trade, if anything.
   *
   * Settlement-wide rather than per post: two posts trading against each other
   * is a puzzle nobody asked for, and the interesting decision is *what* to
   * swap rather than *where*.
   */
  private tradeOrder: TradeOrder = AUTOMATIC_TRADE;
  private totalDeaths = 0;

  /**
   * What was felled where, and whether it grows back.
   *
   * Public because the renderer has nothing to draw from it but the ledger has:
   * a settlement's cleared ground is part of its state and goes in the save.
   */
  public readonly woodland = new Woodland();

  /** Lifetime tallies. Recorded as they happen; the present cannot be asked. */
  private readonly chronicle: Chronicle = newChronicle();
  /**
   * Every death, with an age and a cause.
   *
   * Public because it is read as a whole rather than through a summary: the end
   * screen lists the roll, and the ledger counts it by cause. Writing to it
   * belongs to this class alone.
   */
  public readonly necrology = new Necrology();
  /**
   * The woods' own random stream.
   *
   * Separate from every other, so that adding a roll to regrowth cannot shift
   * where a villager wanders or which name a child is given. Determinism only
   * survives contact with new features if the streams stay apart.
   */
  private readonly forestRandom: SeededRandom;
  /** Sickness gets its own stream, for the same reason the woods do. */
  private readonly illnessRandom: SeededRandom;

  /** Who reached a new level at their trade today. */
  private lastSkills: SkillReport = NO_SKILL_CHANGE;

  /**
   * What the settlement owes in fractions of a tool, a coat and a bundle.
   *
   * Three things wear out at less than one a day, and a yard holds whole things.
   * The remainder is kept here rather than rounded away, so the long-run rate is
   * exactly the rate the data says — see `resources/wear.ts`.
   */
  private readonly wear = new WearLedger();

  constructor(options: SimulationOptions) {
    this.seed = options.seed >>> 0;
    this.tickRandom = new SeededRandom(deriveSeed(this.seed, 'tick'));

    this.world = new World({
      width: options.worldWidth,
      height: options.worldHeight,
      seed: this.seed,
    });

    this.forestRandom = new SeededRandom(deriveSeed(this.seed, 'forest'));
    this.illnessRandom = new SeededRandom(deriveSeed(this.seed, 'illness'));
    this.jobs = new JobManager();

    // Villagers get their own RNG stream, so adding a call here cannot shift
    // the terrain or the tree layout.
    this.villagers = new VillagerSystem(
      this.world,
      this.jobs,
      this.storages,
      new SeededRandom(deriveSeed(this.seed, 'villagers')),
    );

    // **What "reachable" is measured from.** The people and their stores, rather
    // than one cell at the camp — see `World.anchors` for the bug that taught it.
    this.world.anchors = () => this.reachAnchors();

    this.foundStorageYard();
    // Beside their stores, not in the middle of the map: they set their bundles
    // down where they stopped walking, and then camped around them.
    this.villagers.spawnNear(this.world.landfallCell, options.startingVillagers);

    // Everything that comes out of the ground follows the calendar, and the
    // curves differ: foraging trickles through the growing seasons, a field is
    // worth having in autumn, an orchard only then.
    this.villagers.productionScaleProvider = (profile) => SEASONAL_YIELD[profile][this.year.season];
    // Tools make every job quicker. With none, this is exactly 1.
    // Tools and spirit compose: a well-equipped, settled village is
    // meaningfully quicker than a miserable ill-equipped one, and neither of
    // the two low states is a penalty — both are simply the speed the game has
    // always run at.
    this.villagers.workRateProvider = () =>
      (1 + TOOL_WORK_BONUS * this.lastDayReport.toolFraction) *
      spiritWorkBonus(this.lastDayReport.spirit);
    // And experience, which is one person's rather than the settlement's. A
    // master is half again as quick **at her own trade** and exactly ordinary at
    // everything else, which is what makes moving a specialist cost something.
    this.villagers.skillRateProvider = (villager, job) => {
      if (job.type !== 'produce' || job.targetEntityId === null) {
        return 1;
      }
      const building = this.world.buildings.getById(job.targetEntityId);
      return building ? SKILL_WORK_BONUS[villager.skillAt(building.definition.id)] : 1;
    };
    this.villagers.isCutOff = (cell) => this.isCutOff(cell);
    this.villagers.onDemolished = (buildingId) => this.completeDemolition(buildingId);
    this.villagers.onTreeFelled = (cell, playerOrdered) => this.recordFelling(cell, playerOrdered);
    // A lodge planting on ground the player cleared reclaims it: the last thing
    // done to a cell is what it remembers.
    this.villagers.onTreePlanted = (cell) => this.woodland.planted(cell);
    // Counted when the wall goes up rather than counted off the map later: a
    // building that was raised and then pulled down was still raised.
    this.world.buildings.onCompleted = () => {
      this.chronicle.buildingsRaised += 1;
    };
  }

  public get worldSeed(): number {
    return this.seed;
  }

  public get tick(): number {
    return this.currentTick;
  }

  /** Advances the world by exactly one fixed tick. */
  public update(tick: number, tickSeconds: number): void {
    this.currentTick = tick;

    // A day's supplies are consumed at the day boundary, before work is done,
    // so a settlement that ran out overnight feels it immediately.
    if (isDayBoundary(tick)) {
      this.runDailyUpkeep();
    }

    this.openFinishedStorages();
    this.refreshStorageDoorways();
    this.reconcileEmployment();
    this.createConstructionJobs();
    this.createProductionJobs();
    this.createForestryJobs();
    this.createHaulJobs();
    this.escalateStaleHauls();
    this.villagers.update(tickSeconds);
    // Phase 7+ : production, seasons.
  }

  /**
   * Marks a tree for felling, creating the job that does it.
   *
   * A command, not a mutation: the player expresses intent and the simulation
   * decides what happens. Returns `false` when the tree is gone or already
   * designated, so the UI can tell the difference between "done" and "no".
   */
  public designateTreeForFelling(cell: GridPoint): boolean {
    const tree = this.world.trees.getAt(cell);
    if (!tree) {
      return false;
    }

    const job = this.jobs.create({
      type: 'chop-tree',
      target: { gx: tree.gx, gy: tree.gy },
      priority: JobPriority.normal,
      targetEntityId: tree.id,
      // The player is clearing ground, not cropping a coppice. What that costs
      // the woodland is decided when the axe actually falls — see `onFelled`.
      playerOrdered: true,
    });

    return job !== null;
  }

  /** Cancels a felling designation, if the tree has one. */
  public cancelTreeDesignation(cell: GridPoint): boolean {
    const tree = this.world.trees.getAt(cell);
    if (!tree) {
      return false;
    }

    const job = this.jobs.findByTarget('chop-tree', tree.id);
    if (!job) {
      return false;
    }

    this.jobs.cancel(job.id);
    this.releaseVillagersFrom(job.id);
    return true;
  }

  /** `true` when this cell's tree is already marked for felling. */
  public isTreeDesignated(cell: GridPoint): boolean {
    const tree = this.world.trees.getAt(cell);
    return tree !== null && this.jobs.isTargetReserved('chop-tree', tree.id);
  }

  public snapshot(): SimulationSnapshot {
    const villagerStats = this.villagers.stats();
    const jobStats = this.jobs.stats();
    const year = this.year;
    return {
      seed: this.seed,
      tick: this.currentTick,
      villagerCount: this.villagers.count,
      treeCount: this.world.trees.count,
      walkingCount: villagerStats.walking,
      workingCount: villagerStats.working,
      pathRequests: villagerStats.pathRequests,
      pathFailures: villagerStats.pathFailures,
      jobsAvailable: jobStats.available,
      jobsAssigned: jobStats.assigned,
      jobsCompleted: jobStats.completed,
      pileCount: this.world.piles.count,
      buildingCount: this.world.buildings.count,
      sitesUnderConstruction: this.world.buildings.underConstruction().length,
      housingCapacity: this.world.buildings.housingCapacity,
      season: year.season,
      year: year.year,
      dayOfSeason: year.dayOfSeason,
      temperature: year.temperature,
      lastDay: this.lastDayReport,
      spoiled: this.lastSpoilage,
      population: this.lastPopulation,
      forest: this.lastForest,
      employment: this.lastEmployment,
      trade: this.lastTrade,
      illness: this.lastIllness,
      skills: this.lastSkills,
      deaths: this.totalDeaths,
      advice: this.adviseOn(year),
      stalledMaterial: this.stalledMaterial(),
      hasFailed: this.hasFailed,
      lowestHealth: this.villagers.all.reduce(
        (lowest, villager) => Math.min(lowest, villager.needs.health),
        this.villagers.count === 0 ? 0 : 100,
      ),
      stored: this.totalsFrom((resource) => this.storages.totalOf(resource)),
      loose: this.totalsFrom((resource) => this.world.piles.totalOf(resource)),
      chronicle: this.chronicle,
      necrology: this.necrology.all,
    };
  }

  private totalsFrom(read: (resource: ResourceId) => number): Record<ResourceId, number> {
    const totals = {} as Record<ResourceId, number>;
    for (const resource of RESOURCE_IDS) {
      totals[resource] = read(resource);
    }
    return totals;
  }

  /** Marks a stone deposit for mining. */
  public designateStoneForMining(cell: GridPoint): boolean {
    if (this.world.terrainAt(cell) !== 'stone') {
      return false;
    }
    // Deposits have no entity id, so the cell itself is the exclusive target.
    const cellId = cell.gy * this.world.width + cell.gx;
    const job = this.jobs.create({
      type: 'gather-stone',
      target: cell,
      priority: JobPriority.normal,
      targetEntityId: cellId,
    });
    return job !== null;
  }

  public cancelStoneDesignation(cell: GridPoint): boolean {
    const cellId = cell.gy * this.world.width + cell.gx;
    const job = this.jobs.findByTarget('gather-stone', cellId);
    if (!job) {
      return false;
    }
    this.jobs.cancel(job.id);
    this.releaseVillagersFrom(job.id);
    return true;
  }

  public isStoneDesignated(cell: GridPoint): boolean {
    const cellId = cell.gy * this.world.width + cell.gx;
    return this.jobs.isTargetReserved('gather-stone', cellId);
  }

  /**
   * Orders a road laid on a cell.
   *
   * Roads are the first thing the player can build that improves the settlement
   * rather than adding to it. Every economic problem this game has turned out to
   * be a hauling problem, and priorities only ever decide *what* gets carried —
   * never how long the carrying takes. A road is the answer to the second half,
   * and the first decision that is about the *shape* of a settlement rather than
   * its contents.
   *
   * It costs labour and no materials on purpose: a beaten track is work, not
   * goods, so nothing here has to invent a resource transfer that never
   * physically happened.
   */
  public designateRoad(cell: GridPoint): boolean {
    if (!this.world.canPave(cell)) {
      return false;
    }

    const cellId = cell.gy * this.world.width + cell.gx;
    const job = this.jobs.create({
      type: 'pave-road',
      target: cell,
      // **`low` meant never.** The idea was that roads get built with the hours
      // nobody else needed, and the flaw is that there are no such hours: a
      // running settlement always has a tree marked or a load to carry, so
      // paving sat at the bottom of the board for ever and not one road was ever
      // laid. A player reported it as "nobody makes roads", which is exactly what
      // it was.
      //
      // `normal` puts paving alongside felling, where the nearest job wins — so
      // a road the player asked for gets laid within a day or two. It still
      // loses to hauling at `high`, which keeps the rule that actually mattered:
      // the settlement never paves a path while its food sits in the field.
      priority: JobPriority.normal,
      targetEntityId: cellId,
    });
    return job !== null;
  }

  /**
   * Orders a channel dug from the water into a cell.
   *
   * The second thing the player can build that changes the *shape* of the
   * settlement rather than adding to it, and the more interesting one: a road
   * makes hauling quicker, a ditch decides where an orchard can stand. The
   * water has to be led there one cell at a time, from the river or from a
   * channel already cut, so the line is the player's rather than the map's.
   *
   * Labour and no materials, like paving: digging is work, not goods.
   */
  public designateDitch(cell: GridPoint): boolean {
    if (!this.world.canDig(cell)) {
      return false;
    }

    const cellId = cell.gy * this.world.width + cell.gx;
    const job = this.jobs.create({
      type: 'dig-ditch',
      target: cell,
      // Alongside paving and felling, for the same reason: the nearest job wins,
      // so a ditch the player asked for is dug within a day or two, and it still
      // loses to hauling — the settlement never digs while its food is in the
      // field.
      priority: JobPriority.normal,
      targetEntityId: cellId,
    });
    return job !== null;
  }

  /** Cancels a pending digging order. */
  public cancelDitchDesignation(cell: GridPoint): boolean {
    const cellId = cell.gy * this.world.width + cell.gx;
    const job = this.jobs.findByTarget('dig-ditch', cellId);
    if (!job) {
      return false;
    }
    this.jobs.cancel(job.id);
    this.releaseVillagersFrom(job.id);
    return true;
  }

  public isDitchDesignated(cell: GridPoint): boolean {
    const cellId = cell.gy * this.world.width + cell.gx;
    return this.jobs.isTargetReserved('dig-ditch', cellId);
  }

  public hasDitch(cell: GridPoint): boolean {
    return this.world.terrainAt(cell) === 'ditch';
  }

  /** Fills a channel in again. Immediate, like taking up a road. */
  public fillDitch(cell: GridPoint): boolean {
    return this.world.fillDitch(cell);
  }

  /** Cancels a pending paving order. */
  public cancelRoadDesignation(cell: GridPoint): boolean {
    const cellId = cell.gy * this.world.width + cell.gx;
    const job = this.jobs.findByTarget('pave-road', cellId);
    if (!job) {
      return false;
    }
    this.jobs.cancel(job.id);
    this.releaseVillagersFrom(job.id);
    return true;
  }

  public isRoadDesignated(cell: GridPoint): boolean {
    const cellId = cell.gy * this.world.width + cell.gx;
    return this.jobs.isTargetReserved('pave-road', cellId);
  }

  public hasRoad(cell: GridPoint): boolean {
    return this.world.roads.hasAt(cell);
  }

  /**
   * Takes a laid road up again.
   *
   * Immediate rather than a job. Lifting is the player correcting a route they
   * no longer want, and making them wait for a villager to come and un-beat a
   * track would be ceremony rather than a decision.
   */
  public liftRoad(cell: GridPoint): boolean {
    // Not a bridge. A crossing is paved by the building that carries it, and
    // lifting those boards by hand would leave a bridge standing over water
    // nobody could cross — pull the bridge down instead.
    if (this.world.buildings.getAt(cell) !== null) {
      return false;
    }
    return this.world.liftRoad(cell);
  }

  /**
   * Restores the clock and the death toll after a save is loaded.
   *
   * Everything else is restored by the serialiser through the registries; this
   * is the small amount of state the Simulation itself owns.
   */
  public restoreChronicle(chronicle: Readonly<Chronicle>): void {
    Object.assign(this.chronicle, chronicle);
  }

  /**
   * Puts the roll of the dead back after a load.
   *
   * A settlement that forgot its dead on every reload would report a clean
   * history and an unexplained population, which is worse than no roll at all.
   */
  public restoreNecrology(records: readonly DeathRecord[]): void {
    this.necrology.restore(records);
  }

  /** What the settlement owes in fractional wear, for the serialiser. */
  public get wearDebt(): readonly (readonly [ResourceId, number])[] {
    return this.wear.state();
  }

  public restoreWearDebt(pairs: readonly (readonly [ResourceId, number])[]): void {
    this.wear.restore(pairs);
  }

  public restoreClock(tick: number, deaths: number): void {
    this.currentTick = tick;
    this.totalDeaths = deaths;
    this.lastDayReport = EMPTY_REPORT;
    // The chronicle is not reset here: a load restores it explicitly, and
    // clearing it from the clock would wipe a whole history every time a
    // settlement was reloaded.
    this.lastSpoilage = NO_SPOILAGE;
    this.lastPopulation = NO_POPULATION_CHANGE;
    this.lastForest = NO_FOREST_CHANGE;
    this.lastEmployment = NO_EMPLOYMENT_CHANGE;
    this.lastTrade = NO_TRADE;
    this.tradeOrder = AUTOMATIC_TRADE;
    this.lastIllness = NO_ILLNESS;
  }

  /**
   * What the settlement most needs to hear about.
   *
   * Thresholds are in days of supply rather than raw amounts, so the advice
   * stays right as the population changes.
   */
  private adviseOn(year: YearState): Advice {
    const people = this.villagers.count;
    if (people === 0) {
      return null;
    }

    // Real hunger, not a missed delivery. A settlement living hand to mouth has
    // shortfall days routinely while nobody is any thinner, and an alarm that
    // cries wolf every other day is one the player stops reading.
    const hungriest = this.villagers.all.reduce(
      (lowest, villager) => Math.min(lowest, villager.needs.hunger),
      100,
    );
    if (hungriest <= 25) {
      return 'starving';
    }

    const coldest = this.villagers.all.reduce(
      (lowest, villager) => Math.min(lowest, villager.needs.warmth),
      100,
    );
    if (coldest <= 25) {
      return 'freezing';
    }

    // A roof is the difference between surviving winter and not, and it is the
    // least obvious of the settlement's needs: a player watching full yards and
    // a healthy woodpile has no way to guess that the wood is not being burned
    // for anyone. Said before the cold rather than during it.
    const winterIsNear = year.season === 'autumn' || year.season === 'winter';
    if (this.lastPopulation.homeless > 0 && winterIsNear && !this.hasHousingUnderway()) {
      return 'noShelter';
    }

    // A site waiting for a material the settlement has none of will wait for
    // ever, and nothing on screen says so. Reported *after* the two that kill
    // people and before everything else, because it is the one condition where
    // the settlement looks busy and is not: villagers walk logs to a house that
    // cannot be finished, and the player watches work happening and nothing
    // being built.
    const stalled = this.stalledMaterial();
    if (stalled) {
      // **Say who cuts the wood, not just that the wood is missing.** "Nothing
      // is being built without Logs" is true and useless: a player who has a
      // Woodcutter standing reasonably believes somebody is already on it, and
      // the settlement will wait for ever without either of them learning
      // otherwise. This was reported from a real game — the works stopped for
      // want of timber with a Woodcutter built and no Feller anywhere.
      if (stalled === 'logs' && !this.hasFelling()) {
        return 'noFeller';
      }
      return 'siteStalled';
    }

    // The other silent dead end, and the same class of failure: a pile with
    // nowhere to go is simply left where it lies, so the settlement quietly
    // stops carrying anything in and nothing on screen says why.
    if (this.hasHomelessPile()) {
      return 'storageFull';
    }

    // Said *before* it happens, which is the whole difference. A yard that has
    // just filled has already begun leaving goods in the field; a yard at nine
    // tenths is a building the player still has time to raise. Food first: a
    // full larder in autumn is a winter's harvest left to rot.
    // Only once a larder exists. Before that the founding yard is the food store
    // *and* the timber store, and telling the player their larders are full when
    // they have none reads as a bug — the yard warning below covers it.
    if (this.storages.hasLarder && nearlyFull(this.storages.fill('food'))) {
      return 'larderFilling';
    }
    if (nearlyFull(this.storages.fill('logs'))) {
      return 'storageFilling';
    }

    const huts = this.world.buildings.countOf('gatherer-hut');
    if (huts === 0) {
      return 'foodLow';
    }

    // One hut cannot feed everyone, and the settlement that has one usually
    // believes it has solved food. Saying so is the difference between losing
    // to the game and losing to an invisible rule.
    if (huts * VILLAGERS_FED_PER_GATHERER_HUT < people) {
      return 'needMoreHuts';
    }

    // Losing food to rot is invisible otherwise: the total simply fails to grow,
    // and a player watching two huts work hard has no way to tell why. Only
    // worth saying once there is enough food for the loss to matter.
    const hasLarder = this.storages.all.some(
      (storage) => storage.preservation < 1 && storage.accepts('food'),
    );
    if (!hasLarder && (this.lastSpoilage.lost.food ?? 0) >= 3) {
      return 'foodSpoiling';
    }

    // Firewood only matters once the cold is in sight; warning in spring would
    // be noise the player learns to ignore.
    if (winterIsNear) {
      const firewoodDays = this.storages.totalOf('firewood') / people;
      if (this.world.buildings.countOf('woodcutter') === 0) {
        return 'firewoodLow';
      }
      // A Woodcutter with nothing to split is a building the player will watch
      // idling all winter without ever being told why.
      if (this.storages.totalOf('logs') <= 0 && !this.hasFelling()) {
        return 'noFeller';
      }
      if (firewoodDays < DAYS_PER_SEASON) {
        return 'firewoodShort';
      }
    }

    return null;
  }

  /** The calendar at the current tick. */
  public get year(): YearState {
    return yearStateAt(this.currentTick);
  }

  /**
   * `true` when something in the settlement is cutting trees down.
   *
   * A building with a `felling` order of its own — the Feller's Hut — or a Lodge
   * thinning its wood, or the player's own standing marks. Any of the three is
   * timber on its way; none of them is a settlement that will never see another
   * log however long it waits.
   */
  private hasFelling(): boolean {
    for (const building of this.world.buildings.all) {
      if (!building.isComplete) {
        continue;
      }
      if (building.definition.felling || building.definition.forestry) {
        return true;
      }
    }
    for (const job of this.jobs.all) {
      if (job.type === 'chop-tree') {
        return true;
      }
    }
    return false;
  }

  /**
   * A material every stalled site is waiting for and the settlement has none of.
   *
   * `null` when nothing is stuck. Deliberately only fires on **zero in store**:
   * a site short of stone while a quarry is cutting it is not stalled, it is
   * waiting, and the player does not need telling.
   */
  public stalledMaterial(): ResourceId | null {
    for (const site of this.world.buildings.underConstruction()) {
      for (const cost of site.definition.constructionCost) {
        if (site.stillNeeds(cost.resource) > 0 && this.storages.totalOf(cost.resource) <= 0) {
          return cost.resource;
        }
      }
    }
    return null;
  }

  /**
   * The nearest-listed site still owing this material, or `null`.
   *
   * Used only when the yards are full — see `createHaulJobs`. First match
   * rather than nearest: this is a rescue from a stalled settlement, and any
   * site that wants the goods ends the stall.
   */
  private siteNeeding(resource: ResourceId): Building | null {
    for (const site of this.world.buildings.underConstruction()) {
      if (site.stillNeeds(resource) > 0) {
        return site;
      }
    }
    return null;
  }

  /**
   * `true` when something is lying in the field that no yard will accept.
   *
   * Either the settlement has no yard for it or every yard that would take it
   * is full. `createHaulJobs` leaves such a pile alone — correctly, there is
   * nothing to be done with it — and until now said nothing about it.
   */
  private hasHomelessPile(): boolean {
    for (const pile of this.world.piles.all) {
      if (pile.isEmpty) {
        continue;
      }
      if (
        !this.storages.findNearestAccepting(pile.cell, pile.resource) &&
        !this.siteNeeding(pile.resource)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * `true` when houses are already on their way up.
   *
   * Telling a player to build Houses while a dozen stand half-built is the
   * game lying to them about what is wrong, and it is exactly what happened:
   * every site was waiting on stone and the banner kept asking for more
   * houses. What they needed to hear was about the stone.
   */
  private hasHousingUnderway(): boolean {
    for (const site of this.world.buildings.underConstruction()) {
      if ((site.definition.housing ?? 0) > 0) {
        return true;
      }
    }
    return false;
  }

  /** `true` when everyone has died. The settlement has failed. */
  public get hasFailed(): boolean {
    return this.villagers.count === 0;
  }

  /**
   * How much of the settlement's need for solace its buildings answer, `0..1`.
   *
   * Summed from whatever declares a `solace` share, so adding a third such
   * building later is a row in a data file. Worked out here rather than in the
   * survival system for the same reason the healer's capacity is: how a
   * building is staffed is not that system's business.
   */
  public get solace(): number {
    let share = 0;
    for (const building of this.world.buildings.all) {
      const solace = building.definition.solace;
      if (!solace || !building.isComplete) {
        continue;
      }
      if (solace.needsWorker && building.workers.length === 0) {
        continue;
      }
      share += solace.share;
    }
    return Math.min(1, share);
  }

  /**
   * Eats, burns firewood, and buries whoever did not make it.
   *
   * Deaths remove the villager outright. There is no illness model — the brief
   * asks for consequences, not a medical simulation.
   */
  private runDailyUpkeep(): void {
    const { report, dead } = runDay(
      this.villagers.all,
      this.storages,
      this.year,
      this.solace,
      this.wear,
    );
    this.lastDayReport = report;

    // The roll is written before the villager is removed, because everything it
    // records — their age, their trade, which need had run out — only exists
    // while they do.
    const when = this.year;
    for (const villager of dead) {
      this.necrology.record(villager, causeOfDeath(villager), when);
      this.villagers.remove(villager.id);
      this.totalDeaths += 1;
      this.chronicle.died += 1;
    }

    // People eat before anything turns. A settlement should never starve on a
    // day it had food, only to watch that same food rot the same night.
    this.lastSpoilage = runSpoilage(this.storages, this.world.piles);

    // And every heap on the ground is a day older. What that buys is the rule
    // below it: goods nobody has carried in twelve days outrank the work of
    // making more of them.
    this.world.piles.ageByADay();

    // Sickness, after people have eaten and burned: whether somebody is hungry
    // or cold today is what decides whether they fall ill today.
    this.lastIllness = this.runSickness();

    // Stumps first: a tree the settlement cropped five years ago is owed, and
    // owing it before the wild spread runs means the returning wood counts
    // towards the ceiling rather than competing with it.
    this.runRegrowth();

    // The woods creep back. Slowly, and never over the settlement itself.
    this.lastForest = runForestRegrowth(this.world, this.forestRandom, (cell) =>
      this.woodland.isBarren(cell),
    );

    // And a merchant may be at the post. Last, so a day's trade is done with
    // what survived the day's eating and rotting rather than with a stock the
    // settlement is about to lose anyway.
    this.lastTrade = runTrade({
      storages: this.storages,
      day: Math.floor(this.currentTick / TICKS_PER_DAY),
      season: this.year.season,
      posts: this.world.buildings.countOf('trading-post'),
      order: this.tradeOrder,
    });

    this.runPopulationUpkeep();

    // Trades last, after the population is settled: somebody who died today
    // learned nothing, and somebody who turned fourteen today should collect
    // what their parents' mastery is worth on the same day.
    inheritTrades(this.villagers.all);
    this.lastSkills = runSkillDay(this.villagers.all, this.world.buildings);

    this.recordTheDay();
  }

  /**
   * Writes the day into the chronicle, and looks to the horizon.
   *
   * Last in the day on purpose: everything it records has already happened, and
   * a ship that lands before the settlement has eaten would be reporting a
   * population that is about to change.
   */
  private recordTheDay(): void {
    this.chronicle.foodEaten += this.lastDayReport.foodEaten;
    this.chronicle.firewoodBurned += this.lastDayReport.firewoodBurned;
    this.chronicle.roughNights += this.lastDayReport.sleepingRough;
    this.chronicle.coldest = Math.min(this.chronicle.coldest, this.year.temperature);
  }

  /**
   * A day of ageing, housing and births.
   *
   * Runs after eating, so a birth is judged on the stores the settlement
   * actually has left rather than on what it had before breakfast.
   */
  private runPopulationUpkeep(): void {
    const people = this.villagers.count;
    const day = runPopulationDay({
      villagers: this.villagers.all,
      buildings: this.world.buildings,
      random: this.villagers.random,
      foodDaysPerPerson: people === 0 ? 0 : this.storages.totalOf('food') / people,
    });

    const when = this.year;
    for (const villager of day.died) {
      this.necrology.record(villager, 'oldAge', when);
      this.villagers.remove(villager.id);
      this.totalDeaths += 1;
      this.chronicle.died += 1;
    }

    for (const { home, parents, familyName } of day.born) {
      this.villagers.bear(home.accessCell, home.id, parents, familyName);
      this.chronicle.born += 1;
    }

    // Newcomers arrive at the edge of the settlement rather than in a bed:
    // they walk in, and the housing pass on the next day finds them a room.
    for (let i = 0; i < day.arrivals; i += 1) {
      this.villagers.welcome(this.world.centreCell);
      this.chronicle.arrived += 1;
    }

    this.lastPopulation = day.report;
    this.chronicle.peakPopulation = Math.max(this.chronicle.peakPopulation, this.villagers.count);
  }

  /** Whether a building may be placed here. Used by the ghost and the command. */
  public canPlaceBuilding(buildingId: BuildingId, origin: GridPoint): PlacementCheck {
    return this.world.buildings.canPlace(this.world, buildingId, origin);
  }

  /**
   * Places a construction site.
   *
   * A command: the player states intent and the simulation decides. Nothing is
   * built here — the site starts empty and needs materials carried to it.
   */
  public placeBuilding(buildingId: BuildingId, origin: GridPoint): Building | null {
    return this.world.buildings.place(this.world, buildingId, origin);
  }

  /**
   * Keeps construction sites supplied and staffed.
   *
   * Materials first: a site that still needs logs gets haul jobs pointed at it,
   * sourced from the storage yards rather than from thin air. Only once
   * everything has physically arrived is a build job posted.
   */
  private createConstructionJobs(): void {
    for (const site of this.world.buildings.underConstruction()) {
      if (!site.hasAllMaterials) {
        this.requestMaterialsFor(site);
        continue;
      }

      if (!this.jobs.isTargetReserved('build', site.id)) {
        this.jobs.create({
          type: 'build',
          target: site.accessCell,
          priority: JobPriority.high,
          targetEntityId: site.id,
          workTicks: site.definition.buildTicks,
        });
      }
    }
  }

  /**
   * Posts haul jobs that bring a site the materials it still owes.
   *
   * **Whatever is nearest, off a shelf or off the ground.** A site used to be
   * suppliable only from a yard, which meant a felled tree lying twenty paces
   * away had to be carried *past* the site into a store and then carried back out
   * again — two journeys where one would do, and the settlers' own bundle could
   * not be touched until somebody had tidied it away. Anything the settlement
   * physically has and can walk to is fair game; the nearest source wins, which is
   * what a person would do.
   *
   * A site still cannot be built out of resources the settlement does not have,
   * which is what makes gathering matter.
   *
   * One delivery run per material at a time: the next is posted after this one
   * lands, which keeps the board short and the reservation simple.
   */
  private requestMaterialsFor(site: Building): void {
    for (const cost of site.definition.constructionCost) {
      if (site.stillNeeds(cost.resource) <= 0) {
        continue;
      }
      const reservationId = materialReservation(site.id, cost.resource);
      if (this.jobs.isTargetReserved('haul', reservationId)) {
        continue;
      }

      const source = this.nearestMaterial(
        site.accessCell,
        cost.resource,
        site.stillNeeds(cost.resource),
      );
      if (!source) {
        continue;
      }

      this.jobs.create({
        type: 'haul',
        target: source.cell,
        deliverTo: site.accessCell,
        priority: JobPriority.high,
        targetEntityId: reservationId,
        haulSource: source.pileId === null ? 'storage' : 'pile',
        haulResource: cost.resource,
        ...(source.pileId === null ? {} : { haulPileId: source.pileId }),
      });
    }
  }

  /**
   * Where to fetch a material from, for one trip.
   *
   * Piles and yards are considered together, because to the villager carrying it
   * they are the same errand: a shelf and a heap on the ground are both somewhere
   * to pick logs up. Reachability is checked here rather than left to the
   * pathfinder — a pile on the far bank of the river is not a source, and posting
   * a job for it would have somebody claim it, fail to route, and hand it back
   * for ever.
   *
   * **A full load beats a near one, and getting that wrong broke the whole game.**
   * This was nearest-first and nothing else, which sounds harmless and is not: a
   * pile holding *one* log three cells away won against a yard holding a hundred
   * and seventy ten cells away, and only one errand per site and material is on
   * the board at a time. So a Woodcutter costing eight logs took a trip per log,
   * with a season's timber on the shelf the whole while. Measured on the
   * reference settlement: the site was ordered on day 8 and still stood
   * half-finished on day 24, the settlement made no firewood at all, and everyone
   * froze in the first winter.
   *
   * The rule is therefore in two tiers. A source that can fill the trip settles
   * it, and among those the nearest wins; a source that cannot is used only when
   * nothing better exists, which is what keeps "build straight off the ground"
   * working when the stores are empty. Both walks cost the same — the difference
   * is whether the errand ends.
   *
   * @param wanted how much this trip is for. Capped at a load, because that is
   *   all one person can carry however much is needed.
   */
  private nearestMaterial(
    to: GridPoint,
    resource: ResourceId,
    wanted: number,
  ): { cell: GridPoint; pileId: number | null } | null {
    const load = Math.max(1, Math.min(wanted, resourceDefinition(resource).carryLimit));
    let best: { cell: GridPoint; pileId: number | null } | null = null;
    let bestDistance = Infinity;
    let bestFills = false;

    const consider = (cell: GridPoint, pileId: number | null, available: number): void => {
      if (!this.world.navigation.connects(to, cell)) {
        return;
      }
      const fills = available >= load;
      if (bestFills && !fills) {
        return;
      }
      const distance = Math.hypot(cell.gx - to.gx, cell.gy - to.gy);
      if ((fills && !bestFills) || distance < bestDistance) {
        best = { cell, pileId };
        bestDistance = distance;
        bestFills = fills;
      }
    };

    for (const storage of this.storages.all) {
      const held = storage.inventory.count(resource);
      if (held > 0) {
        consider(storage.cell, null, held);
      }
    }
    for (const pile of this.world.piles.all) {
      if (pile.resource === resource && !pile.isEmpty) {
        consider(pile.cell, pile.id, pile.amount);
      }
    }

    return best;
  }

  /**
   * Keeps production buildings supplied and working.
   *
   * A workshop that needs logs gets them hauled in from storage first; only
   * then is a production job posted. Nothing is produced from an empty store.
   */
  /**
   * Keeps every forester's lodge managing the wood around it.
   *
   * The rule is one line long and does the whole job: **below its target the
   * lodge plants, at or above it the lodge fells.** No hysteresis and no state —
   * the count of trees in range is the state, and it moves slowly enough that
   * the two behaviours cannot chatter.
   *
   * Felling is posted as ordinary `chop-tree` work rather than as something
   * special, so a forester's timber flows through exactly the same
   * fell → logs on the ground → haul → yard pipeline the player's own
   * designations do. Nothing about the economy has to know a lodge exists.
   *
   * Run on a cadence rather than every tick: counting trees in a radius is the
   * one genuinely superlinear thing in this file, and forestry decisions do not
   * change meaningfully inside two and a half seconds.
   */
  private createForestryJobs(): void {
    if (this.currentTick % FORESTRY_INTERVAL_TICKS !== 0) {
      return;
    }

    for (const building of this.world.buildings.all) {
      if (!building.isComplete) {
        continue;
      }

      // A woodcutter crops its own timber. Nothing else about the economy has
      // to know: the trees it marks go through the same fell → logs → haul
      // pipeline the player's own marks do, and the ground grows back because
      // nobody said otherwise — see `recordFelling`.
      // **Counted against what the settlement has, not what it has tidied
      // away.** The target used to read the shelves alone, so a Feller went on
      // cutting with nine hundred logs already lying in the wood — measured, and
      // it is what carpets a working settlement in timber. A thousand logs on the
      // ground are a thousand logs; the wood is better left standing until
      // somebody has carried them in.
      const felling = building.definition.felling;
      if (felling && this.logsInHand() < felling.logTarget) {
        this.cropTimber(building, felling.radius, felling.outstanding);
      }

      const forestry = building.definition.forestry;
      if (!forestry) {
        continue;
      }

      const standing = this.treesWithin(building.accessCell, forestry.radius);
      if (standing.length >= forestry.targetTrees) {
        this.fellSurplus(standing, standing.length - forestry.targetTrees);
        continue;
      }

      const slot = this.jobs.firstFreeSlot('plant-tree', building.id, building.workers.length);
      if (slot === null) {
        continue;
      }

      const cell = this.findPlantingCell(building.accessCell, forestry.radius);
      if (!cell) {
        continue;
      }

      this.jobs.create({
        type: 'plant-tree',
        target: cell,
        // Above ordinary felling, below food and hauling. Planting is the work
        // that keeps the settlement alive in ten years' time, and it must never
        // be the reason it starves this winter.
        priority: JobPriority.normal,
        targetEntityId: building.id,
        reservationSlot: slot,
      });
    }
  }

  /**
   * Keeps a few felling orders standing for a workshop that cuts its own wood.
   *
   * **The orders belong to that workshop's own people**, at the priority their
   * workshop's work gets. Posted as open work at ordinary priority they were
   * never done: a settlement with a hundred loads lying about always has
   * something more urgent than cutting a tree, so `chop-tree` sat `available` for
   * ever, no timber came in, and the player was told the works had stopped for
   * want of logs while a hut full of cutters stood idle. Measured on a two-year
   * run: four standing orders, none of them ever worked.
   *
   * The backlog is capped rather than the rate, which is what stops a hut in
   * dense woodland burying the map in crosses nobody can work through. Nearest
   * first, so the settlement works outwards from the hut rather than sending
   * somebody across the valley for whatever the scan found first.
   */
  private cropTimber(workshop: Building, radius: number, outstanding: number): void {
    const centre = workshop.accessCell;
    const standing = this.treesWithin(centre, radius);

    let live = 0;
    const free: TreeInstance[] = [];
    for (const tree of standing) {
      if (this.jobs.isTargetReserved('chop-tree', tree.id)) {
        live += 1;
      } else {
        free.push(tree);
      }
    }
    if (live >= outstanding) {
      return;
    }

    const distance = (tree: TreeInstance): number =>
      Math.abs(tree.gx - centre.gx) + Math.abs(tree.gy - centre.gy);
    free.sort((a, b) => distance(a) - distance(b));

    for (const tree of free.slice(0, outstanding - live)) {
      this.jobs.create({
        type: 'chop-tree',
        target: { gx: tree.gx, gy: tree.gy },
        // Its own workshop's work, so it wins the same way a recipe does. Posted
        // as open work at ordinary priority it was never done at all: a
        // settlement with a hundred loads on the ground always has something
        // more urgent than cutting a tree, so four standing orders sat unworked
        // for a measured two years and no timber ever came in.
        priority: JobPriority.urgent,
        targetEntityId: tree.id,
        employerId: workshop.id,
      });
    }
  }

  /**
   * Every log the settlement owns: on the shelves and on the ground.
   *
   * A pile in the wood is not yet useful, but it is not another reason to fell
   * either — and reading only the store is what let a Feller's Hut answer a
   * shortage of *hauling* by cutting more trees down.
   */
  private logsInHand(): number {
    let total = this.storages.totalOf('logs');
    for (const pile of this.world.piles.all) {
      if (pile.resource === 'logs') {
        total += pile.amount;
      }
    }
    return total;
  }

  /** Every tree standing inside a lodge's range. */
  private treesWithin(centre: GridPoint, radius: number): TreeInstance[] {
    const found: TreeInstance[] = [];
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const tree = this.world.trees.getAt({ gx: centre.gx + dx, gy: centre.gy + dy });
        if (tree) {
          found.push(tree);
        }
      }
    }
    return found;
  }

  /**
   * Posts felling work for a lodge that has more wood than it wants.
   *
   * Capped two ways, and the second one matters more than the first. The
   * per-pass cap stops a lodge dumping forty jobs on the board at once; the
   * standing-order cap stops it quietly adding three more every pass for ever.
   * Without the second, a lodge in a dense wood marked trees far faster than
   * anybody could cut them and buried the map in crosses — see
   * {@link OUTSTANDING_FELLING_PER_LODGE}.
   */
  private fellSurplus(standing: readonly TreeInstance[], surplus: number): void {
    // What this lodge already has out. Counted from the trees rather than from
    // the job board, because a job does not record which lodge posted it — and
    // trees in range with a live order against them is the same question.
    let outstanding = 0;
    for (const tree of standing) {
      if (this.jobs.isTargetReserved('chop-tree', tree.id)) {
        outstanding += 1;
      }
    }
    if (outstanding >= OUTSTANDING_FELLING_PER_LODGE) {
      return;
    }

    const room = Math.min(surplus, FELLING_PER_PASS, OUTSTANDING_FELLING_PER_LODGE - outstanding);

    let posted = 0;
    for (const tree of standing) {
      if (posted >= room) {
        return;
      }
      if (this.jobs.isTargetReserved('chop-tree', tree.id)) {
        continue;
      }
      const job = this.jobs.create({
        type: 'chop-tree',
        target: { gx: tree.gx, gy: tree.gy },
        priority: JobPriority.normal,
        targetEntityId: tree.id,
      });
      if (job) {
        posted += 1;
      }
    }
  }

  /**
   * Somewhere inside a lodge's range for the next sapling.
   *
   * Spirals outward from the lodge so a new coppice fills in around it rather
   * than appearing at the far edge of the range first — which reads as a wood
   * growing, and also keeps the walk short while the lodge is young.
   */
  private findPlantingCell(centre: GridPoint, radius: number): GridPoint | null {
    for (let ring = 1; ring <= radius; ring += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        for (let dx = -ring; dx <= ring; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) {
            continue;
          }
          const cell = { gx: centre.gx + dx, gy: centre.gy + dy };
          if (!this.world.canGrowTree(cell)) {
            continue;
          }
          // A cell somebody is already walking to plant is not a free cell.
          const cellId = cell.gy * this.world.width + cell.gx;
          if (this.jobs.isTargetReserved('plant-tree', cellId)) {
            continue;
          }
          if (this.plantingPending(cell)) {
            continue;
          }
          return cell;
        }
      }
    }
    return null;
  }

  /** `true` when a sapling is already on its way to this cell. */
  private plantingPending(cell: GridPoint): boolean {
    for (const job of this.jobs.all) {
      if (
        job.type === 'plant-tree' &&
        job.target.gx === cell.gx &&
        job.target.gy === cell.gy &&
        !isFinished(job)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Keeps every post filled, and every villager in a post that still exists.
   *
   * On a cadence rather than every tick: employment changes when a building is
   * finished, a quota moves or somebody dies, none of which needs answering
   * inside two and a half seconds of play. It is a full reconciliation each
   * time, because a villager can lose a post for four unrelated reasons and a
   * system that hooks each one separately is a system that misses the fifth.
   */
  private reconcileEmployment(): void {
    if (this.currentTick % EMPLOYMENT_INTERVAL_TICKS !== 0) {
      return;
    }
    this.lastEmployment = runEmployment(this.villagers.all, this.world.buildings);
  }

  /** What the post has been told to trade. Nulls mean "you decide". */
  public get trading(): TradeOrder {
    return this.tradeOrder;
  }

  /**
   * Names what the post should sell and buy.
   *
   * A command like every other player intent, and one that cannot make the
   * settlement do anything unsafe: a named good still has to clear the surplus
   * floor, and food and firewood are still never sold.
   */
  public setTradeOrder(order: TradeOrder): void {
    this.tradeOrder = order;
  }

  /**
   * Posts a villager to a building, keeps them a labourer, or hands them back
   * to automatic employment.
   *
   * Quotas already said *how many* people a workshop should have; this says
   * *who*. They are different questions, and a player who wanted one particular
   * villager at the new forge previously had to turn quotas down across the
   * settlement and hope the nearest-first rule picked the right body.
   *
   * The instruction is stored and acted on by the next employment pass rather
   * than applied here, so there is one place that decides who works where and
   * one set of rules — a command that reached in and set `employerId` itself
   * would be undone by the next reconciliation.
   *
   * @returns `false` when there is no such villager, or the named building
   *   cannot employ anyone.
   */
  public setWorkPreference(villagerId: number, preference: WorkPreference): boolean {
    const villager = this.villagers.all.find((candidate) => candidate.id === villagerId);
    if (!villager) {
      return false;
    }

    if (typeof preference === 'number') {
      const building = this.world.buildings.getById(preference);
      // An unfinished building is a legitimate posting — "when it opens" is a
      // reasonable thing to mean. One that could never employ anybody is not.
      if (!building || building.definition.workerSlots === 0) {
        return false;
      }
    }

    villager.workPreference = preference;
    return true;
  }

  /**
   * Orders a building pulled down, or takes the order back.
   *
   * Nothing in this game could be un-built until now, which mattered more the
   * moment quarries and mines arrived: a permanent building in the wrong place
   * was a permanent mistake, and a settlement's first hour is exactly when a
   * player makes those.
   *
   * A **construction site is cancelled at once** and hands back whatever was
   * delivered to it. There is nothing standing to pull down, and a player who
   * misplaced a ghost wants it gone, not scheduled.
   *
   * A **finished building is a job**, like everything else that changes the
   * world: somebody walks over and tears it down, and half the materials come
   * back as salvage on the plot. Ordering it again cancels the order, which
   * makes the button its own undo.
   */
  public toggleDemolition(buildingId: number): boolean {
    const building = this.world.buildings.getById(buildingId);
    if (!building) {
      return false;
    }

    if (!building.isComplete) {
      this.cancelSite(building);
      return true;
    }

    const pending = this.jobs.findByTarget('demolish', buildingId);
    if (pending) {
      this.jobs.cancel(pending.id);
      this.releaseVillagersFrom(pending.id);
      return true;
    }

    return (
      this.jobs.create({
        type: 'demolish',
        target: building.accessCell,
        // The lowest priority in the game, alongside roads. Tearing something
        // down is never more urgent than feeding the people who live there.
        priority: JobPriority.low,
        targetEntityId: buildingId,
      }) !== null
    );
  }

  /** `true` when this building is waiting to be pulled down. */
  public isDemolitionOrdered(buildingId: number): boolean {
    return this.jobs.isTargetReserved('demolish', buildingId);
  }

  /**
   * Takes an unfinished building off the map and returns its materials.
   *
   * The materials are dropped on the plot rather than credited to a yard: they
   * physically arrived there on somebody's back, and the rule that resources
   * exist in the world does not get suspended because the player changed their
   * mind.
   */
  private cancelSite(building: Building): void {
    for (const { resource, amount } of building.materials.contents) {
      this.world.dropNear(building.accessCell, resource, amount);
    }
    this.retireBuilding(building);
  }

  /**
   * Removes a building and unpicks everything pointing at it.
   *
   * Five things hold a reference — its plot in the navigation grid, its staff,
   * its yard, the jobs aimed at it and anyone walking to one — and a demolition
   * that misses any of them leaves a ghost the player cannot see and cannot
   * fix.
   */
  private retireBuilding(building: Building): void {
    for (const job of this.jobs.all) {
      const aimedHere =
        job.targetEntityId === building.id &&
        (job.type === 'produce' ||
          job.type === 'build' ||
          job.type === 'plant-tree' ||
          job.type === 'demolish');
      const deliveringHere =
        job.deliverTo !== null &&
        job.deliverTo.gx === building.accessCell.gx &&
        job.deliverTo.gy === building.accessCell.gy;

      if ((aimedHere || deliveringHere) && !isFinished(job)) {
        this.jobs.cancel(job.id);
        this.releaseVillagersFrom(job.id);
      }
    }

    for (const villager of this.villagers.all) {
      if (villager.employerId === building.id) {
        villager.employerId = null;
      }
      // A posting to a building that no longer exists would keep somebody out
      // of every workshop for ever, waiting for a door that is not coming back.
      if (villager.workPreference === building.id) {
        villager.workPreference = null;
      }
      if (villager.homeId === building.id) {
        villager.homeId = null;
      }
    }

    // A yard being torn down tips its contents onto the plot rather than
    // deleting them. Somebody carried every one of those in.
    if (building.storageId !== null) {
      const storage = this.storages.getById(building.storageId);
      if (storage) {
        for (const { resource, amount } of storage.inventory.contents) {
          this.world.dropNear(building.accessCell, resource, amount);
        }
        this.storages.remove(storage.id);
      }
    }

    for (const { resource, amount } of building.input.contents) {
      this.world.dropNear(building.accessCell, resource, amount);
    }

    this.world.buildings.demolish(this.world, building.id);
  }

  /** Pulls a finished building down and leaves salvage on the plot. */
  /**
   * Decides what the ground does after a tree comes off it.
   *
   * The whole rule, in one place:
   *
   * ```text
   * a workshop's own felling        ──▶ stump, back in five years
   * the player's felling            ──▶ cleared for good
   *   …with a forester within reach ──▶ stump, back in five years
   * ```
   *
   * The player marks trees to make room; ground they cleared should stay
   * cleared, or a sapling turns up where they meant to put a house. A lodge
   * changes that for everything in its range, which is what a lodge is for.
   */
  private recordFelling(cell: GridPoint, playerOrdered: boolean): void {
    const today = Math.floor(this.currentTick / TICKS_PER_DAY);
    if (!playerOrdered || this.foresterWatches(cell)) {
      this.woodland.stump(cell, today);
      return;
    }
    this.woodland.clear(cell);
  }

  /** `true` when a finished forester's lodge has this cell inside its range. */
  private foresterWatches(cell: GridPoint): boolean {
    for (const building of this.world.buildings.all) {
      const forestry = building.definition.forestry;
      if (!forestry || !building.isComplete) {
        continue;
      }
      const centre = building.accessCell;
      if (
        Math.abs(centre.gx - cell.gx) <= forestry.radius &&
        Math.abs(centre.gy - cell.gy) <= forestry.radius
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Grows back everything whose five years are up.
   *
   * Run once a day with the rest of the slow world. A stump on ground that has
   * since been built on, roaded or cleared for good simply misses its turn and
   * is forgotten — the settlement moved on, and the tree does not get to argue.
   */
  private runRegrowth(): void {
    const today = Math.floor(this.currentTick / TICKS_PER_DAY);
    for (const stump of this.woodland.due(today)) {
      const cell = { gx: stump.gx, gy: stump.gy };
      if (this.woodland.isBarren(cell)) {
        continue;
      }
      // From the forest's own stream, like the wild spread: a tree coming back
      // is the woodland's business, not a villager's.
      this.world.plantTree(cell, this.forestRandom.int(0, 6), this.forestRandom.float(0.6, 0.9));
    }
  }

  private completeDemolition(buildingId: number): void {
    const building = this.world.buildings.getById(buildingId);
    if (!building) {
      return;
    }

    // Half of what it cost, rounded down. Generous enough that moving a
    // misplaced building is a real option, mean enough that shuffling the
    // settlement around is never free.
    for (const cost of building.definition.constructionCost) {
      const salvage = Math.floor(cost.amount * SALVAGE_SHARE);
      if (salvage > 0) {
        this.world.dropNear(building.accessCell, cost.resource, salvage);
      }
    }

    this.retireBuilding(building);
  }

  /**
   * Sets how many people a building should employ.
   *
   * A command, like every other player intent: the UI states a wish and the
   * simulation decides what happens to it, on its own schedule.
   */
  public setDesiredWorkers(buildingId: number, workers: number): boolean {
    const building = this.world.buildings.getById(buildingId);
    if (!building) {
      return false;
    }

    const clamped = Math.max(0, Math.min(building.definition.workerSlots, Math.round(workers)));
    if (clamped === building.desiredWorkers) {
      return false;
    }

    building.desiredWorkers = clamped;
    // Applied immediately rather than at the next pass: the player has just
    // pulled a lever and expects the number under their thumb to move.
    this.lastEmployment = runEmployment(this.villagers.all, this.world.buildings);
    this.world.buildings.markChanged();
    return true;
  }

  private createProductionJobs(): void {
    for (const building of this.world.buildings.all) {
      if (!building.isComplete || !building.definition.recipeId) {
        continue;
      }

      const recipe = findRecipe(building.definition.recipeId);
      if (!recipe) {
        continue;
      }

      // Nothing grows under snow, and a gatherer standing in a hut miming a
      // harvest is worse than idle: production is the highest priority in the
      // game, so those two people would refuse to haul or fell all winter while
      // producing exactly nothing. Skipping the job hands them back to the
      // settlement for the season that needs them most.
      if (SEASONAL_YIELD[recipe.seasonal][this.year.season] === 0) {
        // And cancel any left over from the season that just ended. Skipping
        // new ones is not enough: a job posted on the last day of autumn stays
        // on the board, and being the highest priority in the game it is the
        // first thing an employee picks up in January.
        this.cancelProductionAt(building.id);
        continue;
      }

      const missing = recipe.inputs.filter(
        (input) => building.input.count(input.resource) < input.amount,
      );
      if (missing.length > 0) {
        this.requestInputsFor(
          building.id,
          building.accessCell,
          missing.map((m) => m.resource),
        );
        continue;
      }

      // One batch per *employee*, not per slot. A job only this building's
      // staff may take is a job nobody can take when it has no staff, and
      // posting it anyway leaves the board littered with work that will never
      // be claimed.
      const slot = this.jobs.firstFreeSlot('produce', building.id, building.workers.length);
      if (slot !== null) {
        this.jobs.create({
          type: 'produce',
          target: building.accessCell,
          // The highest priority in the game. A workshop has a fixed number of
          // slots, so at most `workerSlots` villagers can be doing this at
          // once and the rest are free for everything else; leaving those few
          // posts unstaffed is never worth it. Below this, the nearest job
          // wins, and a player who marked a stand of trees posted dozens of
          // near jobs — starving the settlement of the work that feeds it, the
          // harder they tried.
          priority: JobPriority.urgent,
          targetEntityId: building.id,
          workTicks: recipe.workTicks,
          reservationSlot: slot,
        });
      }
    }
  }

  /**
   * Runs a day of illness, and pays for whatever care the settlement can give.
   *
   * Capacity is staff times patients-per-worker; herbs are the second half, and
   * a healer with no herbs treats nobody. Both are worked out here rather than
   * inside the illness system, because how a building is staffed and supplied
   * is not that system's business.
   */
  private runSickness(): IllnessReport {
    let capacity = 0;
    for (const building of this.world.buildings.all) {
      const care = building.definition.care;
      if (care && building.isComplete) {
        capacity += building.workers.length * care.patientsPerWorker;
      }
    }

    const sick = this.villagers.all.filter((villager) => villager.isIll).length;
    const staffed = sick === 0 ? 0 : Math.min(1, capacity / sick);

    // Herbs are taken for the patients actually being looked after, so a
    // half-staffed healer costs half the herbs rather than all of them.
    //
    // Half a bundle per patient is not a whole number, so it goes on the wear tab
    // and is paid in whole bundles — the shelf holds bundles, not halves. What is
    // *supplied* is read off the shelf rather than off today's withdrawal, for
    // the same reason the tool coverage is: a rate that pays every other day
    // would otherwise make care flicker on and off.
    const herbsWanted = sick * staffed * HERBS_PER_PATIENT_PER_DAY;
    const supplied =
      herbsWanted === 0 ? 0 : Math.min(1, this.storages.totalOf('herbs') / herbsWanted);
    const herbsTaken = this.wear.spend('herbs', herbsWanted, (resource, whole) =>
      this.takeStored(resource, whole),
    );

    const report = runIllness(this.villagers.all, this.illnessRandom, staffed * supplied);
    return { ...report, herbsUsed: herbsTaken };
  }

  /** Draws a resource out of the yards, returning how much was there. */
  private takeStored(resource: ResourceId, amount: number): number {
    let remaining = amount;
    for (const storage of this.storages.all) {
      if (remaining <= 0) {
        break;
      }
      remaining -= storage.inventory.remove(resource, remaining);
    }
    return amount - remaining;
  }

  /** Withdraws any outstanding production job at a building. */
  private cancelProductionAt(buildingId: number): void {
    for (const job of this.jobs.all) {
      if (job.type === 'produce' && job.targetEntityId === buildingId && !isFinished(job)) {
        this.jobs.cancel(job.id);
        this.releaseVillagersFrom(job.id);
      }
    }
  }

  /**
   * Keeps every store's doorway somewhere a villager can stand.
   *
   * **This is the bug that killed every settlement, and it hid for a long time
   * behind a symptom that pointed somewhere else.** A store is fetched from at
   * one cell. A building's yard uses the building's doorway, which the registry
   * already re-finds when a neighbour is raised on it — but the founding yard's
   * is the bare patch of ground the settlers stopped on, and nothing stops the
   * player putting their first house squarely on top of it.
   *
   * The moment that happened, the camp's cell stopped being walkable, and every
   * question of the form "can somebody fetch logs from here?" answered no. Goods
   * still went *in* — a hauler delivers from the next cell over — so the HUD
   * showed a yard filling steadily with a hundred and seventy logs while every
   * building site and every workshop starved beside it. Measured on the reference
   * settlement: a Woodcutter ordered on day 8 was still half-built on day 24, the
   * settlement made no firewood in the whole year, and all ten froze.
   *
   * Reconciled once a tick rather than hooked onto the moment a wall goes up,
   * for the same reason {@link openFinishedStorages} is: a doorway can be lost by
   * more than one route — a building finished, a bridge cut, a save restored —
   * and one that only recovers down one of them is a store that silently rots.
   * A settlement has tens of stores, not thousands.
   */
  private refreshStorageDoorways(): void {
    for (const storage of this.storages.all) {
      if (this.world.reaches(storage.cell)) {
        continue;
      }

      const owner =
        storage.ownerBuildingId === null
          ? null
          : this.world.buildings.getById(storage.ownerBuildingId);
      // The building's own doorway first, since the registry keeps that honest;
      // failing that, any ground near the store that the settlement can reach.
      const moved = owner && this.world.reaches(owner.accessCell) ? owner.accessCell : null;
      // **Never onto somebody else's doorstep.** A delivery is routed by cell, and
      // a building standing at that cell answers for it before any yard does — so
      // a founding yard rehoused onto a House's doorway had every basket of food
      // carried to it disappear into that house's own store-cupboard, where
      // nothing could ever eat it. Measured: the settlement starved from day
      // twelve with a hundred and twenty-five food lying in the field and its
      // shelves reading nought.
      const doorway =
        moved ??
        this.world.nearestReachable(
          storage.cell,
          DOORWAY_RESCUE,
          (candidate) => !this.world.buildings.anyAccessAt(candidate),
        );
      if (doorway) {
        storage.cell = doorway;
        this.storages.markChanged();
      }
    }
  }

  /**
   * Opens the yard of any finished building that has one and has not opened it.
   *
   * Reconciled here, once a tick, rather than hooked onto the moment a builder
   * lays the last plank. Buildings can be finished by more than one route — a
   * villager finishing the job, a debug tool, a save being restored — and a yard
   * that only appears down one of those routes is a Storage Yard that silently
   * does nothing. Recording the storage on the building keeps this idempotent.
   */
  private openFinishedStorages(): void {
    for (const building of this.world.buildings.all) {
      const definition = building.definition.storage;
      if (!definition || !building.isComplete || building.storageId !== null) {
        continue;
      }

      const storage = this.storages.add({
        // Haulers walk to the doorway; the footprint itself is blocked.
        cell: building.accessCell,
        capacity: definition.capacity,
        ...(definition.accepts ? { accepts: definition.accepts } : {}),
        ...(definition.preservation === undefined ? {} : { preservation: definition.preservation }),
        ownerBuildingId: building.id,
      });
      building.storageId = storage.id;
    }
  }

  /**
   * Fetches a workshop's raw material, from wherever it actually is.
   *
   * **Found by playing: two Woodcutters, timber in the yard, and no firewood.**
   * The errand existed the whole time and simply never got run, for two reasons
   * that compounded.
   *
   * It looked only in the stores, so a settlement whose felled timber was still
   * lying in the wood — which is most settlements, most of the time — had a
   * Woodcutter reporting an empty shelf with forty logs on the ground within
   * sight of it. It now takes the nearest of the two, exactly as a building site
   * does: to the person carrying them, a shelf and a pile are the same errand.
   *
   * And it was posted at ordinary priority, which put it level with felling and
   * below every other haul on the board. A settlement always has a hauling
   * backlog, so the one errand that unblocks a whole workshop sat at the bottom
   * of it. It is now {@link JobPriority.high}, like a delivery to a building
   * site — because that is what it is. The workshop cannot do anything at all
   * until it arrives, whereas the load it is queued behind is merely tidying.
   */
  private requestInputsFor(
    buildingId: number,
    destination: GridPoint,
    resources: ResourceId[],
  ): void {
    for (const resource of resources) {
      // Offset the reservation id away from construction's, which uses the
      // same haul type against the same buildings.
      const reservationId = 500_000 + buildingId * 100 + RESOURCE_IDS.indexOf(resource);
      if (this.jobs.isTargetReserved('haul', reservationId)) {
        continue;
      }

      const source = this.nearestMaterial(destination, resource, CARRY_CAPACITY);
      if (!source) {
        continue;
      }

      this.jobs.create({
        type: 'haul',
        target: source.cell,
        deliverTo: destination,
        priority: JobPriority.high,
        targetEntityId: reservationId,
        haulSource: source.pileId === null ? 'storage' : 'pile',
        haulResource: resource,
        ...(source.pileId === null ? {} : { haulPileId: source.pileId }),
      });
    }
  }

  /**
   * The goods the settlement already has enough of, on its own shelves.
   *
   * Recomputed once a tick and handed to the pricing below, rather than asked
   * per job: a settlement can have three hundred piles on the ground and nine
   * resources, and the answer is the same for all of them.
   */
  private plentiful(): ReadonlySet<ResourceId> {
    const people = Math.max(1, this.villagers.all.length);
    const enough = new Set<ResourceId>();
    for (const resource of RESOURCE_IDS) {
      const wanted = resourceDefinition(resource).wantedPerVillager * people;
      if (this.storages.totalOf(resource) >= wanted) {
        enough.add(resource);
      }
    }
    return enough;
  }

  /**
   * What carrying a load of this into a store is worth, right now.
   *
   * **The fix for a settlement that starved with two hundred food in the field.**
   * Every haul used to be worth the same, so a hundred and seventy logs in the
   * yard bought exactly as much attention as the harvest rotting beside the hut —
   * and since the log piles were nearer, the log piles won. A third of the
   * settlement's waking hours went on carrying timber it already had, all year,
   * while people starved a hundred paces away.
   *
   * Above what the settlement wants of a good, carrying more of it is the least
   * valuable thing anybody could be doing — below felling, below mining, below
   * everything. That is not the goods being worthless; it is *this trip* being
   * worthless, and the hands it frees go to the harvest and to the rock.
   */
  private haulWorth(resource: ResourceId, plentiful: ReadonlySet<ResourceId>): number {
    return plentiful.has(resource) ? JobPriority.low : JobPriority.high;
  }

  /**
   * Sends a workshop's people to carry their own output when it stops moving.
   *
   * **The failure this answers was reported from play: the ground covered in
   * goods.** A settlement can employ every pair of hands it has, and then nothing
   * is left to haul — and because a workshop's own work is `urgent`, its people go
   * on making more onto a heap that never moves. A season of that is not a busy
   * settlement, it is a broken one.
   *
   * So a heap that has lain {@link STALE_PILE_DAYS} days **beside the workshop that
   * made it** becomes the most important thing on the board, above production
   * itself. The nearest pair of hands is then the pair that made it: the forager is
   * standing beside her own harvest, so she carries it in and goes back to work,
   * which is what a person would do.
   *
   * **Beside its maker, and not every old heap anywhere** — measured, because the
   * blunt version was tried first. Escalating *any* twelve-day-old pile sent the
   * whole settlement across the map for the log heaps a player's felling orders had
   * left in the wood, and food banked before the frost fell from 181 to 92 with
   * eighteen more dead over twenty-four worlds. Timber lying in a wood nobody has
   * got to yet is a backlog; a heap of food outside the hut that is still making
   * more of it is a deadlock, and only the second one is worth breaking a day for.
   */
  private escalateStaleHauls(): void {
    for (const pile of this.world.piles.all) {
      if (pile.days < STALE_PILE_DAYS || !this.madeNearby(pile)) {
        continue;
      }
      const job = this.jobs.findByTarget('haul', pile.id);
      if (job && job.state === 'available') {
        job.priority = JobPriority.overdue;
      }
    }
  }

  /**
   * `true` when a working workshop that makes this good stands beside the heap.
   *
   * Both halves matter. A **complete** building, because a site makes nothing. A
   * building that **produces this resource**, so a heap of stone beside a
   * woodcutter is somebody else's backlog rather than its own output.
   *
   * The radius is small on purpose: output is dropped at the workshop's doorway
   * and spills to the next free cell when that one is taken, so three cells covers
   * a busy doorway and nothing else.
   */
  private madeNearby(pile: ResourcePile): boolean {
    for (const building of this.world.buildings.all) {
      if (!building.isComplete) {
        continue;
      }
      const recipe = building.definition.recipeId ? findRecipe(building.definition.recipeId) : null;
      if (!recipe?.outputs.some((output) => output.resource === pile.resource)) {
        continue;
      }
      const cell = building.accessCell;
      if (
        Math.abs(cell.gx - pile.cell.gx) <= OUTPUT_RADIUS &&
        Math.abs(cell.gy - pile.cell.gy) <= OUTPUT_RADIUS
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Re-prices standing haul work as the stores fill and empty.
   *
   * Pricing only at the moment a job is posted is not enough: a pile of logs
   * marked for carrying when the yard was empty is still on the board an hour
   * later when it is full, and it would keep its old claim on somebody's day.
   *
   * Deliveries are left alone. A load bound for a building site or a workshop is
   * not stocking up — it is the one errand standing between that building and
   * doing anything at all — so it keeps its priority however full the yards are.
   */
  private repriceHauls(plentiful: ReadonlySet<ResourceId>): void {
    // **Only hauling is priced this way, and pricing the harvest the same way was
    // tried and measured worse.** Dropping felling below mining when the yard was
    // full of timber sounds like the same idea and is not: the settlement then
    // stopped cutting entirely at eighty logs, the Woodcutter ate through them,
    // and there was nothing to build the next hut with. 93 deaths against 80, and
    // barely any food banked before the cold. A player's felling order is an
    // order; what the settlement is free to deprioritise is *carrying more of
    // what it already has*.
    for (const job of this.jobs.all) {
      // **`haulResource` is only set on a load bound for a site**, so this loop has
      // never actually touched an ordinary pile-to-yard haul — the very case the
      // paragraph above describes. Repairing that was tried and measured: pricing
      // ordinary hauls of a plentiful good down to `low` cost twenty-three lives
      // across twenty-four worlds and half the food banked before the frost, because
      // "the yard already holds enough logs" is true right up to the day a woodshed
      // eats them. It stays as it is until there is a rule worth putting here; what
      // the ground needed was `escalateStaleHauls`, which is a different question.
      if (job.type !== 'haul' || job.state !== 'available' || !job.haulResource) {
        continue;
      }
      if (job.targetEntityId !== null && job.targetEntityId >= MATERIAL_RESERVATION_BASE) {
        continue;
      }
      job.priority = this.haulWorth(job.haulResource, plentiful);
    }
  }

  /**
   * Posts a hauling job for every unclaimed pile.
   *
   * Runs each tick, but is cheap: the job board refuses a second job against a
   * pile that already has one, so this is a scan of a short list rather than
   * repeated work. Generating jobs here rather than at the moment a pile
   * appears means piles left over from a cancelled haul get picked up again.
   */
  private createHaulJobs(): void {
    const plentiful = this.plentiful();
    this.repriceHauls(plentiful);

    for (const pile of this.world.piles.all) {
      if (pile.isEmpty || this.jobs.isTargetReserved('haul', pile.id)) {
        continue;
      }

      const storage = this.storages.findNearestAccepting(pile.cell, pile.resource);
      // **No yard will take it, so try a building site that wants it.**
      //
      // A settlement whose yards are full of stone used to stop carrying
      // timber in altogether: the pile sat where it fell, the sites waited for
      // the timber, and nothing moved again. Sending it straight to a site
      // that needs it is both the obvious thing a real settlement would do and
      // the only way out of that, since the yard is not going to empty itself.
      //
      // Deliberately a **fallback rather than a preference**. Sites first would
      // reroute the whole economy through construction and starve the yards;
      // this only ever fires where the alternative is nothing happening at all.
      // A site's materials inventory holds exactly what it still owes, so it
      // cannot be over-filled, and any remainder goes back on the ground.
      const site = storage ? null : this.siteNeeding(pile.resource);
      const destination = storage?.cell ?? site?.accessCell;
      if (!destination) {
        // Nowhere at all. Leave the pile be; a yard or a site may appear later.
        continue;
      }

      this.jobs.create({
        type: 'haul',
        target: pile.cell,
        deliverTo: destination,
        // Named when it is going to a site, so the load is capped at pickup to
        // what that site still owes. Unnamed the hauler shouldered the whole
        // pile, and a site's materials hold exactly its cost — so one material
        // could fill the room another needed and the building was finished for
        // ever. See `advanceHaul`.
        ...(site === null ? {} : { haulSource: 'pile' as const, haulResource: pile.resource }),
        // Carrying goods in outranks cutting more down — while the settlement
        // wants the goods. At equal priority the nearest job won, so a marked
        // stand of trees buried the hauling and the settlement starved with fifty
        // food in piles beside the hut. Once the shelves hold enough of
        // something, carrying more of it drops below both. See {@link haulWorth}.
        priority: this.haulWorth(pile.resource, plentiful),
        targetEntityId: pile.id,
      });
    }
  }

  /**
   * Stacks the settlers' stores where they made camp.
   *
   * The settlement starts with one yard already standing, because resources
   * exist physically in this game and there has to be somewhere to haul to
   * before anything can be built. What that yard *is*, though, is what the
   * settlers carried in — so it sits where they stopped walking, on the river
   * bank, and the water is in shot from the first frame.
   */
  private foundStorageYard(): void {
    const cell = this.world.landfallCell;

    // **The camp stands on cleared ground, like everything else does.**
    //
    // Nothing in this game may be built on standing forest, and the founding
    // yard was the one thing exempt from that — because it is not placed, it is
    // simply declared at the landfall. So a camp that came ashore in a wood sat
    // with trees growing through it: drawn over them, and with the cells still
    // counting as slow woodland underfoot.
    //
    // The yard is recorded as one cell and stands three across, so all nine are
    // cleared. Nothing is salvaged from it — see `World.clearGround`.
    //
    // **And it stays cleared.** The wild spread keeps two cells away from every
    // finished building, and the founding yard is not one: it is a store with no
    // building behind it, so nothing was stopping a sapling taking root on the
    // camp itself. Rare — one plot in four grew a tree over four measured years —
    // and unmistakable when it happens, because the yard's own art covers the
    // whole plot and a tree would come up through the deck.
    for (let dy = -FOUNDING_YARD_RADIUS; dy <= FOUNDING_YARD_RADIUS; dy += 1) {
      for (let dx = -FOUNDING_YARD_RADIUS; dx <= FOUNDING_YARD_RADIUS; dx += 1) {
        const plot = { gx: cell.gx + dx, gy: cell.gy + dy };
        this.world.clearGround(plot);
        this.woodland.clear(plot);
      }
    }

    const yard = this.storages.add({ cell, capacity: 2000 });

    // **What they carried goes onto the shelves.**
    //
    // It was stacked on the ground for a while, in bundles, which is what ten
    // tired people would actually do — and it read as a mess rather than as a
    // camp. A settlement that opens with its own stores full is the clearer
    // picture and the clearer opening move: the numbers on the HUD are the
    // numbers the settlement has, and the first thing the player does is spend
    // them rather than tidy them away.
    //
    // Nothing was lost in the change. A building site takes its materials from
    // the nearest source it can walk to, shelf or pile alike, so building
    // straight off the ground still works — it is simply no longer the state the
    // game starts in.
    for (const [resource, amount] of Object.entries(STARTING_RESOURCES)) {
      yard.inventory.add(resource as ResourceId, amount);
    }
  }

  /**
   * What "reachable" is measured from: the settlement's people and its stores.
   *
   * **Stores alone was tried and it is self-referential.** A store's own cell is
   * in the anchor set, so when a building is finished on that doorway the cell
   * stops being walkable, the anchor set collapses to nothing, and every cell on
   * the map reads as unreachable at once. Measured: every building's doorway
   * then re-derived to a fallback near the store, three gatherer huts ended up
   * sharing one cell, no site could be delivered to, and a settlement starved
   * with three hundred food on the ground.
   *
   * Whether somebody is *cut off* is a different question and is asked
   * separately — see {@link isCutOff} — precisely because it cannot be asked of
   * a set that the asker is a member of.
   */
  private *reachAnchors(): Iterable<GridPoint> {
    for (const villager of this.villagers.all) {
      yield villager.cell;
    }
    for (const storage of this.storages.all) {
      yield storage.cell;
    }
  }

  /**
   * `true` when somebody standing here is walled off from the settlement proper.
   *
   * **The measurement `world.reaches` cannot make.** A villager is one of its
   * anchors, so a villager walled into a four-cell yard makes that yard count as
   * part of the settlement and nothing can tell they are stranded.
   *
   * And asking merely whether the region holds a *store* is not enough either,
   * which cost a second measured settlement: one of those four-cell yards had a
   * larder's doorway inside it, so the pocket looked like part of the settlement
   * and the thirty people trapped in it were never rescued. Thirty-one of
   * fifty-eight villagers were in pockets, five sites had not moved in a hundred
   * and forty days, and fifty-one heaps of goods sat untouched.
   *
   * So the settlement is the **largest** region that holds a store. Size is a
   * structural fact; how many people or stores happen to be inside a pocket is
   * not — the pocket had more villagers in it than the settlement did, because
   * children are born at home and home was inside it.
   *
   * `false` for somebody standing inside a wall: that is `stepClear`'s business
   * and rescuing them twice would fight over where they end up.
   */
  private isCutOff(cell: GridPoint): boolean {
    const region = this.world.navigation.regionAt(cell.gx, cell.gy);
    if (region < 0) {
      return false;
    }
    const settlement = this.settlementRegion();
    return settlement >= 0 && region !== settlement;
  }

  /**
   * The region the settlement itself occupies: the biggest one with a store in it.
   *
   * `-1` when no store has a walkable doorway at all, which makes `isCutOff`
   * answer "nobody" — a settlement with nowhere to put anything is already lost,
   * and a rescue that fires on everyone at once is a stampede rather than a fix.
   */
  private settlementRegion(): number {
    const nav = this.world.navigation;
    let best = -1;
    let bestSize = 0;
    for (const storage of this.storages.all) {
      const region = nav.regionAt(storage.cell.gx, storage.cell.gy);
      if (region < 0) {
        continue;
      }
      const size = nav.regionCellCount(region);
      if (size > bestSize) {
        best = region;
        bestSize = size;
      }
    }
    return best;
  }

  /** Frees any villager still holding a job that no longer exists. */
  private releaseVillagersFrom(jobId: number): void {
    for (const villager of this.villagers.all) {
      if (villager.currentJobId === jobId) {
        villager.currentJobId = null;
        villager.clearPath();
      }
    }
  }

  /** Exposed for the systems added in later phases. */
  /** The woods' RNG position, so a loaded settlement grows the same forest. */
  public get forestRandomState(): { seed: number; cursor: number } {
    return this.forestRandom.getState();
  }

  public restoreForestRandom(state: { seed: number; cursor: number }): void {
    this.forestRandom.setState(state);
  }

  /** Sickness's RNG position, so a loaded settlement falls ill the same way. */
  public get illnessRandomState(): { seed: number; cursor: number } {
    return this.illnessRandom.getState();
  }

  public restoreIllnessRandom(state: { seed: number; cursor: number }): void {
    this.illnessRandom.setState(state);
  }

  public get random(): RandomSource {
    return this.tickRandom;
  }
}
