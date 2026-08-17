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
import { RESOURCE_IDS, type ResourceId } from '@/data/resources';
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
import type { WorkPreference } from './villagers/Villager';
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
  /** Goods are lying in the field with no yard that will take them. */
  | 'storageFull'
  | 'noShelter'
  | 'foodLow'
  | 'needMoreHuts'
  | 'foodSpoiling'
  | 'firewoodLow'
  | 'firewoodShort'
  | null;

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

    this.foundStorageYard();
    // Beside their stores, not in the middle of the map: they walked
    // up this beach out of the water.
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
    this.reconcileEmployment();
    this.createConstructionJobs();
    this.createProductionJobs();
    this.createForestryJobs();
    this.createHaulJobs();
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
      return 'siteStalled';
    }

    // The other silent dead end, and the same class of failure: a pile with
    // nowhere to go is simply left where it lies, so the settlement quietly
    // stops carrying anything in and nothing on screen says why.
    if (this.hasHomelessPile()) {
      return 'storageFull';
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
   * Posts haul jobs that move stored materials to a site.
   *
   * Sourced from a yard that actually holds the material: a site cannot be
   * built out of resources the settlement does not have, which is what makes
   * gathering matter.
   */
  private requestMaterialsFor(site: Building): void {
    for (const cost of site.definition.constructionCost) {
      if (site.stillNeeds(cost.resource) <= 0) {
        continue;
      }
      // One delivery run per material at a time; the next is posted after this
      // one lands, which keeps the board short and the reservation simple.
      const reservationId = site.id * 100 + RESOURCE_IDS.indexOf(cost.resource);
      if (this.jobs.isTargetReserved('haul', reservationId)) {
        continue;
      }

      const source = this.storages.all.find(
        (storage) => storage.inventory.count(cost.resource) > 0,
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
        haulSource: 'storage',
        haulResource: cost.resource,
      });
    }
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
      const felling = building.definition.felling;
      if (felling && this.storages.totalOf('logs') < felling.logTarget) {
        this.cropTimber(building.accessCell, felling.radius, felling.outstanding);
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
   * Keeps a few felling orders standing near a workshop that cuts its own wood.
   *
   * The same standing-order shape a lodge uses, and for the same reason: capping
   * the *backlog* rather than the rate is what stops a workshop in a dense wood
   * burying the map in crosses nobody can work through.
   *
   * Nearest first, so the settlement works outwards from the workshop rather
   * than sending somebody across the valley for whatever the scan found first.
   */
  private cropTimber(centre: GridPoint, radius: number, outstanding: number): void {
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
        priority: JobPriority.normal,
        targetEntityId: tree.id,
      });
    }
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
      this.world.piles.drop(building.accessCell, resource, amount);
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
          this.world.piles.drop(building.accessCell, resource, amount);
        }
        this.storages.remove(storage.id);
      }
    }

    for (const { resource, amount } of building.input.contents) {
      this.world.piles.drop(building.accessCell, resource, amount);
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
        this.world.piles.drop(building.accessCell, cost.resource, salvage);
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

  /** Hauls recipe inputs from storage to a workshop. */
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

      const source = this.storages.all.find((storage) => storage.inventory.count(resource) > 0);
      if (!source) {
        continue;
      }

      this.jobs.create({
        type: 'haul',
        target: source.cell,
        deliverTo: destination,
        priority: JobPriority.normal,
        targetEntityId: reservationId,
        haulSource: 'storage',
        haulResource: resource,
      });
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
      const destination = storage?.cell ?? this.siteNeeding(pile.resource)?.accessCell;
      if (!destination) {
        // Nowhere at all. Leave the pile be; a yard or a site may appear later.
        continue;
      }

      this.jobs.create({
        type: 'haul',
        target: pile.cell,
        deliverTo: destination,
        // Carrying goods in outranks cutting more down. At equal priority the
        // nearest job won, so a marked stand of trees buried the hauling: the
        // settlement starved with fifty food lying in piles beside the hut,
        // because nobody would stop chopping long enough to carry it in.
        priority: JobPriority.high,
        targetEntityId: pile.id,
      });
    }
  }

  /**
   * Stacks the settlers' stores where they made camp.
   *
   * The settlement starts with one yard already standing, because resources
   * exist physically in this game and there has to be somewhere to haul to
   * before anything can be built. What that yard *is*, though, is the wreck's
   * cargo stacked on the beach — so it sits at the landfall rather than in the
   * middle of the map, and the sea is in shot from the first frame.
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
    for (let dy = -FOUNDING_YARD_RADIUS; dy <= FOUNDING_YARD_RADIUS; dy += 1) {
      for (let dx = -FOUNDING_YARD_RADIUS; dx <= FOUNDING_YARD_RADIUS; dx += 1) {
        this.world.clearGround({ gx: cell.gx + dx, gy: cell.gy + dy });
      }
    }

    const yard = this.storages.add({ cell, capacity: 2000 });

    // Everything they could carry up the beach. Timber, no stone, and iron
    // they cannot use yet — see STARTING_RESOURCES for why each of those.
    for (const [resource, amount] of Object.entries(STARTING_RESOURCES)) {
      yard.inventory.add(resource as ResourceId, amount);
    }
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
