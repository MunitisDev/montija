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
import type { Recipe } from '@/data/recipes';
import {
  FOOD_IDS,
  RESOURCE_IDS,
  isFood,
  resourceDefinition,
  type ResourceId,
} from '@/data/resources';
import { SKILL_WORK_BONUS } from '@/data/skills';
import type { Building } from './buildings/Building';
import type { PlacementCheck } from './buildings/BuildingRegistry';
import { isFinished, JobPriority } from './jobs/Job';
import { JobManager } from './jobs/JobManager';
import { StockLimits } from './logistics/StockLimits';
import { foodKinds, foodStored, foodWantedPerVillager, varietyShare } from './resources/diet';
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

import { characterOf, type YearCharacter, type YearKind } from './seasons/YearCharacter';
import {
  DAYS_PER_SEASON,
  SEASONAL_YIELD,
  TICKS_PER_DAY,
  TICKS_PER_YEAR,
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
import { NO_FIRE, runFire, type FireReport } from './events/FireSystem';
import { WolfSystem, type WolfTickReport, NO_WOLF_TICK } from './wildlife/WolfSystem';
import type { Wolf } from './wildlife/Wolf';
import { WOUND_HEALING_PER_DAY, armedCount, exchangeBlows, type Exchange } from './wildlife/Combat';
import {
  LOGS_PER_FENCE,
  LOGS_PER_GATE,
  STONE_PER_GATE,
  STONE_PER_WALL,
  type FenceKind,
} from './world/FenceGrid';
import { waterWithinReach } from './world/Water';
import {
  EMPTY_REPORT,
  FIREWOOD_PER_VILLAGER_PER_COLD_DAY,
  runDay,
  spiritWorkBonus,
  TOOL_WORK_BONUS,
  type DailyReport,
} from './seasons/SurvivalSystem';
import { VillagerSystem } from './villagers/VillagerSystem';
import { CARRY_CAPACITY, type WorkPreference } from './villagers/Villager';
import { World } from './world/World';
import {
  NO_FOREST_CHANGE,
  runForestRegrowth,
  TREE_VARIANTS,
  type ForestReport,
} from './world/ForestSystem';
import { Woodland } from './world/Woodland';
import type { TreeInstance } from './world/WorldGenerator';

/**
 * Ticks between felling passes.
 *
 * Counting the trees around a hut is the one genuinely superlinear thing in this
 * file, and no felling decision changes meaningfully inside two and a half
 * seconds of play.
 */
const FELLING_INTERVAL_TICKS = 25;

/**
 * Ticks of work to pull up a tree that has not grown yet.
 *
 * A third of felling a grown one. An axe and a wedge against a spade: clearing
 * ground for a house should not cost what harvesting the timber to build it does.
 */
const CLEARING_WORK_TICKS = 8;

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
  /** More than a quarter of the settlement is ill and nothing is treating them. */
  | 'sicknessSpreading'
  /** A pack came down and found the harvest lying in the open. */
  | 'wolvesAbout'
  /**
   * The harvest is lying in the fields and every adult is in a workshop.
   *
   * The settlement is not short of food. It is short of *hands*, and the two
   * look identical from the HUD.
   */
  | 'nobodyHauling'
  /** Nothing in the settlement brings food in, whatever is in the larder. */
  | 'foodLow'
  /** The larder is thin and going down: measured, not guessed at. */
  | 'foodFalling'
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
 * How much of the settlement has to be ill before the player is told.
 *
 * A quarter, which is the point at which it stops being somebody being unwell
 * and starts being the reason the woodpile is not growing. Below that the notice
 * on the day each case starts is enough; above it the settlement has a problem
 * with two answers — water by the houses and a Healer — and neither of them is
 * guessable from watching villagers stand still.
 */
export const OUTBREAK_SHARE = 0.25;

/**
 * How much of the settlement's comfort water accounts for.
 *
 * A quarter, against a Cemetery's 0.35 and a Temple's 0.65. Deliberately not
 * enough to reach full spirit on its own and easily enough to matter: a well is
 * eight stone in the first year, where a Temple is a settlement's whole autumn,
 * so the cheap comfort has to be the smaller one or nobody would ever build the
 * expensive one.
 */
export const WATER_SOLACE_SHARE = 0.25;

/**
 * How much of it a varied table accounts for.
 *
 * A fifth, at a full spread of all five foods — smaller than water, because it
 * is a comfort a settlement collects for doing what it was going to do anyway.
 * A village that raises a field, an orchard, a fishing hut and a hunter's cabin
 * has not built any of them *for* the comfort; it built them to be fed in four
 * different seasons, and this is the settlement being pleasant to live in as a
 * consequence. Paying much for it would turn a nice consequence into a
 * checklist.
 */
export const DIET_SOLACE_SHARE = 0.2;

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
 * Days of food in store below which the settlement is warned, if it is falling.
 *
 * **The advice about food used to count buildings, and it was wrong twice.** It
 * asked "is there a Gatherer Hut, and is there one per six people" — so a
 * settlement living comfortably off a field, an orchard and a fishing hut was
 * told nobody was gathering food, and a settlement with three hundred in the
 * larder was told to build another hut. Reported from a real game, and both
 * complaints were fair: the player could see the food.
 *
 * A fortnight, and only while the stores are *not growing*. Days rather than an
 * amount so it holds as the settlement grows, and the trend because a low store
 * that is filling is a harvest coming in rather than a famine.
 */
export const FOOD_DAYS_LOW = 12;

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
  /**
   * What kind of year this is: kind, ordinary, hard or bitter.
   *
   * Fixed the moment the year begins and shown all year, because a hard year the
   * player was told about in spring is a plan and the same year sprung on them in
   * December is a dice roll. See `seasons/YearCharacter.ts`.
   */
  readonly yearKind: YearKind;
  /** What the ground gives this year, against an ordinary year's 1. */
  readonly harvest: number;
  /** What the settlement ate and burned on the last day that passed. */
  readonly lastDay: DailyReport;
  /** What went bad overnight, so the HUD can explain a falling total. */
  readonly spoiled: SpoilageReport;
  /** Births, old age, homelessness and the split between adults and children. */
  readonly population: PopulationReport;
  /** Saplings that took root overnight, so a recovering wood is legible. */
  readonly forest: ForestReport;
  /** What caught fire, what the water saved and what is gone. */
  readonly fire: FireReport;
  /** Who is employed where, so the HUD can show labourers and vacancies. */
  readonly employment: EmploymentReport;
  /** What the merchant did today, and whether one is here at all. */
  readonly trade: TradeReport;
  /** Who is unwell, and how much of it the settlement is able to treat. */
  readonly illness: IllnessReport;
  /**
   * The pack, as the HUD and the renderer need it.
   *
   * The wolves themselves rather than a report, because they are on the map now:
   * something has to draw them.
   */
  readonly wolves: {
    readonly pack: readonly Wolf[];
    readonly alarmed: boolean;
    readonly stolen: number;
    readonly breached: number;
    readonly fallen: readonly number[];
    readonly slain: number;
  };
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
  /**
   * The larder as one figure, because that is how a player thinks about it.
   *
   * There are five foods and the question is still "have we enough to eat", so
   * the HUD's strip carries the total and the drawer breaks it down. `kinds`
   * counts how many of them the settlement is keeping a real amount of — see
   * `resources/diet.ts` — which is what a varied table is worth spirit and
   * health for.
   */
  readonly food: {
    readonly stored: number;
    readonly loose: number;
    readonly kinds: number;
  };
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
  /**
   * How much of each good the player wants kept, and no more.
   *
   * Public because it is player intent rather than derived state: the UI reads
   * it to draw the stepper and writes it through {@link setStockLimit}. See
   * `logistics/StockLimits.ts` for what a limit does and, more importantly, what
   * it deliberately does not.
   */
  public readonly stockLimits = new StockLimits();

  private seed: number;
  private readonly tickRandom: RandomSource;
  private currentTick = 0;
  /** The larder's total at the end of yesterday. See {@link FOOD_DAYS_LOW}. */
  private foodYesterday = 0;
  private lastDayReport: DailyReport = EMPTY_REPORT;
  private lastSpoilage: SpoilageReport = NO_SPOILAGE;
  private lastPopulation: PopulationReport = NO_POPULATION_CHANGE;
  private lastForest: ForestReport = NO_FOREST_CHANGE;
  private lastFire: FireReport = NO_FIRE;
  /**
   * The pack, if one is on the map.
   *
   * Owned here rather than in the world for the same reason the villagers are:
   * wolves are alive, and the world is the ground they stand on.
   */
  public readonly wolves = new WolfSystem();
  private lastWolves: WolfTickReport = NO_WOLF_TICK;
  /** Villagers taken by wolves today, and wolves killed. For the HUD. */
  private lastFallen: number[] = [];
  private lastSlain = 0;
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
  /**
   * Fire's own stream, kept apart from the forest's and the villagers'.
   *
   * A settlement replayed from its seed has to burn on the same night, and it
   * would not if the roll came out of a stream that a felled tree or a birth also
   * draws from.
   */
  private readonly fireRandom: SeededRandom;
  /** Sickness gets its own stream, for the same reason the woods do. */
  private readonly illnessRandom: SeededRandom;
  private readonly wolfRandom: SeededRandom;

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
    this.fireRandom = new SeededRandom(deriveSeed(this.seed, 'fire'));
    this.illnessRandom = new SeededRandom(deriveSeed(this.seed, 'illness'));
    this.wolfRandom = new SeededRandom(deriveSeed(this.seed, 'wolves'));
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
    // The season's curve, times the year's own character: a hard year is a
    // fifth off everything that comes out of the ground, every season of it.
    // See `seasons/YearCharacter.ts`.
    this.villagers.productionScaleProvider = (profile) =>
      profile === 'none'
        ? SEASONAL_YIELD[profile][this.year.season]
        : SEASONAL_YIELD[profile][this.year.season] * this.yearCharacter.harvest;
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
    // The two halves of the alarm: what each villager should be doing, and where
    // the nearest wolf is for the ones going out at them.
    this.villagers.defenceOrder = (villager) => this.wolves.orderFor(villager);
    this.villagers.nearestWolfCell = (from) => this.wolves.nearestTo(from)?.cell ?? null;
    this.villagers.onDemolished = (buildingId) => this.completeDemolition(buildingId);
    this.villagers.onTreeFelled = (cell, playerOrdered) => this.recordFelling(cell, playerOrdered);
    // Counted when the wall goes up rather than counted off the map later: a
    // building that was raised and then pulled down was still raised.
    this.world.buildings.onCompleted = () => {
      this.chronicle.buildingsRaised += 1;
    };
  }

  public get worldSeed(): number {
    return this.seed;
  }

  /**
   * Adopts the seed of a settlement being loaded into this simulation.
   *
   * A load replaces the contents of an existing world, so the number this
   * simulation was *founded* with is not the number the settlement it is now
   * playing was founded with — and one thing still reads the seed directly
   * rather than through a saved stream: {@link yearCharacter}, which asks what
   * kind of year a given year of a given world is. Left unrestored, a loaded
   * settlement got the hard and bitter years of the world the player happened to
   * have open, and the same file loaded in two sessions had two different
   * futures. Saving it again then wrote the wrong `worldSeed` into the file.
   *
   * The derived streams — tick, forest, fire, illness, villagers — are not
   * rebuilt from this, because they are restored with their own positions; see
   * `docs/SAVE_FORMAT.md`.
   */
  public restoreSeed(seed: number): void {
    this.seed = seed >>> 0;
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
    this.createFellingJobs();
    this.createHaulJobs();
    this.escalateStaleHauls();
    this.villagers.update(tickSeconds);
    // **The pack moves after the people do**, so a villager who stepped up to a
    // wolf this tick is beside it when the biting is worked out rather than a
    // tick late. Everything about a fight is decided in the two calls below.
    this.runWildlife(tickSeconds);
    // Phase 7+ : production, seasons.
  }

  /**
   * One tick of the pack, and of the fight if there is one.
   *
   * The wolf system decides who is biting whom; `Combat` decides what that costs;
   * and this decides what a death *means* — a household, a job, a line in the
   * roll. Three files, one for each of those, because the last one is the only
   * one that needs to know about the settlement.
   */
  private runWildlife(tickSeconds: number): void {
    if (this.wolves.count === 0) {
      this.lastWolves = NO_WOLF_TICK;
      return;
    }

    this.lastWolves = this.wolves.update({
      world: this.world,
      villagers: this.villagers.all,
      tickSeconds,
    });

    // **Tools are handed out, not spent.** However many the settlement has is how
    // many of its people fight at full strength — see `Combat.ts`. Handed to the
    // defenders in id order, which is arbitrary and fair and reproducible.
    const pairings: Exchange[] = [];
    const armed = armedCount(this.storages.totalOf('tools'), this.lastWolves.biting.length);
    let handedOut = 0;
    for (const { villagerId, wolfId } of this.lastWolves.biting) {
      const villager = this.villagers.findById(villagerId);
      const wolf = this.wolves.all.find((candidate) => candidate.id === wolfId);
      if (!villager || !wolf) {
        continue;
      }
      pairings.push({ villager, wolf, armed: handedOut < armed });
      handedOut += 1;
    }

    const report = exchangeBlows(pairings);
    for (const id of report.fallen) {
      const villager = this.villagers.findById(id);
      if (!villager) {
        continue;
      }
      this.necrology.record(villager, 'wolves', this.year);
      this.villagers.remove(villager.id);
      this.totalDeaths += 1;
      this.chronicle.died += 1;
      this.lastFallen.push(id);
    }
    this.wolves.remove(report.slain);
    this.lastSlain += report.slain.length;

    // Anything the pack carried off, and any hole it made, is worth a line in the
    // chronicle: the settlement will want to know why the larder is short.
    this.chronicle.wolfKills += report.slain.length;
    for (const taken of this.lastWolves.stolen) {
      this.chronicle.wolfStolen += taken.amount;
    }
    if (this.lastWolves.breached.length > 0) {
      this.world.buildings.markChanged();
    }

    // The dead are taken off the map before anybody looks again, so a wolf that
    // died this tick cannot bite next tick.
    this.wolves.remove(this.wolves.all.filter((wolf) => wolf.isDead).map((wolf) => wolf.id));
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
      // **Pulling up a sapling is not felling.** A grown tree is an axe and a
      // wedge and half an afternoon; a young one is a spade. Charging the same
      // for both would make clearing ground for a house cost the same as
      // harvesting the timber to build it, which is the wrong way round.
      ...(this.world.trees.isMature(tree) ? {} : { workTicks: CLEARING_WORK_TICKS }),
    });

    return job !== null;
  }

  /**
   * Orders a building's one improvement built.
   *
   * **A command, like every other thing the player asks for**, and it goes
   * through the whole of the machinery that already exists: the building drops
   * back to `underConstruction`, its materials are hauled in by hand, somebody
   * spends labour on site, and the day the work is done it is a house with a
   * stone hearth. Nothing about hauling, building or the panel had to learn a new
   * kind of work — see `Building.requiredMaterials`.
   *
   * @returns `false` when there is nothing to improve, it is already improved, or
   *   the building is not standing yet
   */
  public orderUpgrade(buildingId: number): boolean {
    const building = this.world.buildings.getById(buildingId);
    const upgrade = building?.definition.upgrade;
    if (!building || !upgrade || !building.isComplete || building.improved) {
      return false;
    }

    building.upgrading = true;
    building.state = 'underConstruction';
    building.materials.clear();
    building.buildTicksRemaining = upgrade.buildTicks;
    this.world.buildings.markChanged();
    return true;
  }

  /**
   * Takes an ordered improvement back.
   *
   * Whatever had already been carried in goes on the ground rather than
   * evaporating: somebody walked it here.
   */
  public cancelUpgrade(buildingId: number): boolean {
    const building = this.world.buildings.getById(buildingId);
    if (!building || !building.upgrading) {
      return false;
    }

    for (const { resource, amount } of building.materials.contents) {
      this.world.dropNear(building.accessCell, resource, amount);
    }
    building.materials.clear();
    building.upgrading = false;
    building.state = 'complete';
    building.buildTicksRemaining = 0;
    for (const job of this.jobs.all) {
      if (job.type === 'build' && job.targetEntityId === building.id && !isFinished(job)) {
        this.jobs.cancel(job.id);
        this.releaseVillagersFrom(job.id);
      }
    }
    this.world.buildings.markChanged();
    return true;
  }

  /**
   * The firewood a night of frost costs the settlement.
   *
   * Worked out here rather than in the survival system for the reason that system
   * gives for every figure it is handed: how a house is built is not its business.
   * A household under a stone hearth burns about a third less, and somebody
   * sleeping rough burns nothing at all — they have nowhere to burn it, which is
   * the cruel half of that rule and not a saving.
   */
  private firewoodDemand(): number {
    let total = 0;
    for (const villager of this.villagers.all) {
      if (villager.homeId === null) {
        continue;
      }
      const home = this.world.buildings.getById(villager.homeId);
      const factor = home?.improved ? (home.definition.upgrade?.firewoodFactor ?? 1) : 1;
      total += FIREWOOD_PER_VILLAGER_PER_COLD_DAY * factor;
    }
    return total;
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
      yearKind: this.yearCharacter.kind,
      harvest: this.yearCharacter.harvest,
      lastDay: this.lastDayReport,
      spoiled: this.lastSpoilage,
      population: this.lastPopulation,
      forest: this.lastForest,
      fire: this.lastFire,
      employment: this.lastEmployment,
      trade: this.lastTrade,
      illness: this.lastIllness,
      wolves: {
        pack: this.wolves.all,
        alarmed: this.wolves.isAlarmed,
        stolen: this.lastWolves.stolen.reduce((total, take) => total + take.amount, 0),
        breached: this.lastWolves.breached.length,
        fallen: this.lastFallen,
        slain: this.lastSlain,
      },
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
      food: {
        stored: foodStored(this.storages),
        loose: FOOD_IDS.reduce((sum, id) => sum + this.world.piles.totalOf(id), 0),
        kinds: foodKinds(this.storages, this.villagers.count),
      },
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

  /**
   * Orders a line of stakes driven into a cell.
   *
   * **Paid for when the order is given, and that is the one thing about this
   * building that is unlike every other.** Everything the settlement raises has
   * its materials carried out to it by somebody — that is a founding rule of the
   * game and it is not being bent here. What a palisade has instead is *no site*:
   * it is forty separate cells drawn in one gesture, and forty construction sites
   * each waiting on one log is a settlement that spends a fortnight hauling
   * single logs to forty places and finishes none of them.
   *
   * So the timber is **set aside** out of the yard the moment the order is given,
   * as a woodcutter's logs are, and cancelling an order puts it back. The player
   * pays in advance and the work is the only thing left to do, which is also the
   * honest reading of what it is: stakes are cut from the settlement's own store
   * and driven where they are wanted.
   *
   * Refuses when the yard cannot pay, so the answer to "why is nothing being
   * fenced?" is on the screen rather than in the wood.
   */
  public designateFence(cell: GridPoint): boolean {
    if (!this.world.canFence(cell) || this.isFenceDesignated(cell)) {
      return false;
    }
    return this.orderWallWork(cell, 'raise-fence', 'logs', LOGS_PER_FENCE);
  }

  /**
   * Orders a gateway cut into a length of wall.
   *
   * Only into a wall that is standing: a gate is a hole in something, and asking
   * the player to place the wall and the gate as one gesture would mean drawing
   * a run and then re-drawing part of it. Paid for up front like the wall itself.
   */
  public designateGate(cell: GridPoint): boolean {
    const kind = this.world.fences.kindAt(cell);
    if (kind === null || this.world.fences.isGate(cell) || this.isGateDesignated(cell)) {
      return false;
    }
    return this.orderWallWork(cell, 'hang-gate', 'logs', LOGS_PER_GATE);
  }

  /** Cancels a pending gateway, and puts the timber back. */
  public cancelGateDesignation(cell: GridPoint): boolean {
    return this.callOffWallWork(cell, 'hang-gate', 'logs', LOGS_PER_GATE);
  }

  public isGateDesignated(cell: GridPoint): boolean {
    return this.jobs.isTargetReserved('hang-gate', this.cellId(cell));
  }

  /**
   * Orders a length of wall built up in stone.
   *
   * The upgrade a settlement wants once it has survived a winter behind timber:
   * stone is the one thing a pack cannot chew through. A gate becomes a stone
   * arch and stays a gate, which is what the player means by "in stone".
   */
  public designateWall(cell: GridPoint): boolean {
    const kind = this.world.fences.kindAt(cell);
    if (kind === null || kind === 'stone-wall' || kind === 'stone-gate') {
      return false;
    }
    if (this.isWallDesignated(cell)) {
      return false;
    }
    const cost = this.world.fences.isGate(cell) ? STONE_PER_GATE : STONE_PER_WALL;
    return this.orderWallWork(cell, 'build-wall', 'stone', cost);
  }

  /** Cancels a pending stone upgrade, and puts the stone back. */
  public cancelWallDesignation(cell: GridPoint): boolean {
    const cost = this.world.fences.isGate(cell) ? STONE_PER_GATE : STONE_PER_WALL;
    return this.callOffWallWork(cell, 'build-wall', 'stone', cost);
  }

  public isWallDesignated(cell: GridPoint): boolean {
    return this.jobs.isTargetReserved('build-wall', this.cellId(cell));
  }

  /** What this cell of wall is, or `null` for open ground. */
  public fenceKindAt(cell: GridPoint): FenceKind | null {
    return this.world.fences.kindAt(cell);
  }

  private cellId(cell: GridPoint): number {
    return cell.gy * this.world.width + cell.gx;
  }

  /**
   * The shared half of every wall order: pay, post the work, refund on failure.
   *
   * Three orders wear this — stakes, a gate, a wall in stone — and they differ
   * only in what they cost and what job they post. Writing it three times is how
   * one of them ends up refunding the wrong material.
   */
  private orderWallWork(
    cell: GridPoint,
    type: 'raise-fence' | 'hang-gate' | 'build-wall',
    resource: ResourceId,
    cost: number,
  ): boolean {
    // **Paid before the work is posted, and refunded exactly.** `takeStored`
    // reports what it actually found, which matters: a settlement holding one
    // stone of the two a wall costs has that one stone taken, and it has to go
    // back rather than be quietly kept.
    const paid = this.takeStored(resource, cost);
    if (paid < cost) {
      this.giveBack(resource, paid);
      return false;
    }

    const job = this.jobs.create({
      type,
      target: cell,
      // Alongside paving, digging and felling: the nearest job wins, so a wall
      // the player asked for goes up within a day or two and still loses to
      // hauling. A settlement never builds while its food is in the field —
      // which matters here most of all, because the food in the field is what
      // the wall is protecting it from.
      priority: JobPriority.normal,
      targetEntityId: this.cellId(cell),
    });
    if (job === null) {
      this.giveBack(resource, cost);
      return false;
    }
    return true;
  }

  private callOffWallWork(
    cell: GridPoint,
    type: 'raise-fence' | 'hang-gate' | 'build-wall',
    resource: ResourceId,
    cost: number,
  ): boolean {
    const job = this.jobs.findByTarget(type, this.cellId(cell));
    if (!job) {
      return false;
    }
    this.jobs.cancel(job.id);
    this.releaseVillagersFrom(job.id);
    this.giveBack(resource, cost);
    return true;
  }

  /** Cancels a pending stake-line order, and puts the timber back. */
  public cancelFenceDesignation(cell: GridPoint): boolean {
    const cellId = cell.gy * this.world.width + cell.gx;
    const job = this.jobs.findByTarget('raise-fence', cellId);
    if (!job) {
      return false;
    }
    this.jobs.cancel(job.id);
    this.releaseVillagersFrom(job.id);
    this.giveBack('logs', LOGS_PER_FENCE);
    return true;
  }

  public isFenceDesignated(cell: GridPoint): boolean {
    const cellId = cell.gy * this.world.width + cell.gx;
    return this.jobs.isTargetReserved('raise-fence', cellId);
  }

  public hasFence(cell: GridPoint): boolean {
    return this.world.fences.hasAt(cell);
  }

  /**
   * Pulls a stake line down. Immediate, like taking up a road.
   *
   * The timber does not come back: stakes are driven into the ground and split
   * doing it. A player who fences the wrong side of the settlement has spent the
   * logs, which is the same bargain every other building makes.
   */
  public pullDownFence(cell: GridPoint): boolean {
    return this.world.pullDownFence(cell);
  }

  /**
   * Puts goods back into the yards, as far as they will go.
   *
   * The other half of {@link takeStored}, for the orders that are paid for up
   * front and can be called off. What will not fit is dropped where the
   * settlement stands rather than deleted, because somebody carried it in.
   */
  private giveBack(resource: ResourceId, amount: number): void {
    let remaining = amount;
    for (const storage of this.storages.all) {
      if (remaining <= 0) {
        return;
      }
      remaining -= storage.inventory.add(resource, remaining);
    }
    if (remaining > 0) {
      this.world.dropNear(this.world.landfallCell, resource, remaining);
    }
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
    this.lastFire = NO_FIRE;
    this.lastWolves = NO_WOLF_TICK;
    this.lastFallen = [];
    this.lastSlain = 0;
    // **The pack is not cleared here.** This runs on a load as well as on a jump
    // of the clock, and a settlement saved with wolves in the turnips has to load
    // with wolves in the turnips — the save restores them a moment before this,
    // and wiping them would be a free escape from a bad night.
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

    // **Said before the starving, because it is *why* they are starving.**
    // Measured on a settlement that built the obvious things: by its fourth
    // autumn it had forty-three food on the shelves, two hundred and ninety-two
    // lying in the fields, and every adult inside a workshop. Nobody was
    // carrying anything, so it starved to death with four years of harvest on the
    // ground — and the banner said "the food is running out", which is true and
    // sends the player to build another hut, which takes two more pairs of hands
    // off the road.
    //
    // The settlement does not fix this itself, deliberately: who works where is
    // the player's decision and the game handing it back to them would be the
    // game playing itself. What it owes them is the sentence.
    if (
      this.lastEmployment.labourers === 0 &&
      FOOD_IDS.reduce((sum, id) => sum + this.world.piles.totalOf(id), 0) >= people
    ) {
      return 'nobodyHauling';
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

    // **The wood came down and found something.** Said only when a pack actually
    // took something, and only while there is still food lying out for the next
    // one — a warning about a raid the settlement has already answered is the
    // kind of noise that teaches players to stop reading warnings.
    if (
      this.wolves.isAlarmed &&
      FOOD_IDS.reduce((sum, id) => sum + this.world.piles.totalOf(id), 0) > 0
    ) {
      return 'wolvesAbout';
    }

    // **An outbreak, which is the one hardship with no picture.** A villager
    // who is ill looks exactly like a villager with nothing to do: they stop,
    // and the settlement quietly loses a quarter of its hands for a week and a
    // half. Said only when it is spreading rather than on every case, and only
    // while nothing is treating it — a settlement with a staffed Healer has
    // already answered this and does not need telling twice.
    if (
      this.lastIllness.ill >= 2 &&
      this.lastIllness.ill / people >= OUTBREAK_SHARE &&
      this.lastIllness.careFraction < 1
    ) {
      return 'sicknessSpreading';
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
    if (this.storages.hasLarder && nearlyFull(this.storages.foodFill())) {
      return 'larderFilling';
    }
    if (nearlyFull(this.storages.fill('logs'))) {
      return 'storageFilling';
    }

    // **Nothing brings food in at all**, which is the settlement's first
    // problem and is true on the morning it lands with a hold full of roots.
    // Asked of every building that makes any food — five of them do now, and
    // asking after Gatherer Huts alone told settlements living off a field and a
    // fishing hut that nobody was gathering.
    if (!this.hasFoodSupply()) {
      return 'foodLow';
    }

    // And beyond that, the *stores* decide, not the buildings. A fortnight of
    // food left and no longer filling is a settlement in trouble whatever it has
    // built; three hundred in the larder is a settlement that is fine however it
    // got there. See {@link FOOD_DAYS_LOW}.
    const stored = foodStored(this.storages);
    if (stored / people < FOOD_DAYS_LOW && stored <= this.foodYesterday) {
      return 'foodFalling';
    }

    // Losing food to rot is invisible otherwise: the total simply fails to grow,
    // and a player watching two huts work hard has no way to tell why. Only
    // worth saying once there is enough food for the loss to matter.
    const hasLarder = this.storages.all.some(
      (storage) => storage.preservation < 1 && FOOD_IDS.some((id) => storage.accepts(id)),
    );
    const foodLost = FOOD_IDS.reduce((sum, id) => sum + (this.lastSpoilage.lost[id] ?? 0), 0);
    if (!hasLarder && foodLost >= 3) {
      return 'foodSpoiling';
    }

    // Firewood only matters once the cold is in sight; warning in spring would
    // be noise the player learns to ignore.
    // **And only when the woodpile is actually short.** This had the same defect
    // the food advice did: it warned about having no Woodcutter whatever was in
    // the store, so a settlement that had bought or salvaged a winter's firewood
    // was nagged all autumn about a building it did not need.
    if (winterIsNear) {
      const firewoodDays = this.storages.totalOf('firewood') / people;
      if (firewoodDays < DAYS_PER_SEASON) {
        if (this.world.buildings.countOf('woodcutter') === 0) {
          return 'firewoodLow';
        }
        // A Woodcutter with nothing to split is a building the player will watch
        // idling all winter without ever being told why.
        if (this.storages.totalOf('logs') <= 0 && !this.hasFelling()) {
          return 'noFeller';
        }
        return 'firewoodShort';
      }
    }

    return null;
  }

  /**
   * What kind of year this is: how cold, and how much the ground gives.
   *
   * Derived from the world's seed and the year's number rather than stored, so it
   * costs nothing to ask, survives a save for free, and cannot drift out of step
   * with the calendar. See `seasons/YearCharacter.ts`.
   */
  public get yearCharacter(): YearCharacter {
    return characterOf(this.seed, Math.floor(this.currentTick / TICKS_PER_YEAR) + 1);
  }

  /** The calendar at the current tick. */
  public get year(): YearState {
    return yearStateAt(this.currentTick, this.yearCharacter.coldBite);
  }

  /**
   * `true` when something in the settlement is cutting trees down.
   *
   * A building with a `felling` order of its own — the Feller's Hut — or a Lodge
   * thinning its wood, or the player's own standing marks. Either is
   * timber on its way; none of them is a settlement that will never see another
   * log however long it waits.
   */
  private hasFelling(): boolean {
    for (const building of this.world.buildings.all) {
      if (!building.isComplete) {
        continue;
      }
      if (building.definition.felling) {
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
      for (const cost of site.requiredMaterials()) {
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

    // **Water is the third comfort, and the first one a settlement can afford.**
    // A household with a well or the river within reach is not carrying every
    // bucket from the bank, and a village whose houses all stand by water is a
    // more contented one. Collected rather than owed, like the other two: a
    // settlement built up on the dry side of the valley is not being punished, it
    // simply has not taken a comfort that was there for eight stone.
    share += WATER_SOLACE_SHARE * this.wateredShare();

    // **And a varied table is the fourth comfort.** A settlement eating nothing
    // but foraged roots is fed; one that also has fish, fruit, vegetables and
    // meat on the shelf is *living somewhere*. Collected rather than owed like
    // the rest: one kind of food is worth nothing here, because eating is not an
    // achievement — every kind after the first is.
    share += DIET_SOLACE_SHARE * varietyShare(foodKinds(this.storages, this.villagers.count));
    return Math.min(1, share);
  }

  /**
   * The share of housed villagers whose home has water within reach, in `0..1`.
   *
   * Counted by people rather than by houses: a well beside the one cottage that
   * holds six people is worth more than a well beside an empty one, and it is
   * people whose spirits this is about. Zero when nobody is housed at all, which
   * is the honest answer for a settlement sleeping in the open.
   */
  private wateredShare(): number {
    let housed = 0;
    let watered = 0;
    for (const villager of this.villagers.all) {
      if (villager.homeId === null) {
        continue;
      }
      housed += 1;
      const home = this.world.buildings.getById(villager.homeId);
      if (home && this.waterAt(home.accessCell)) {
        watered += 1;
      }
    }
    return housed === 0 ? 0 : watered / housed;
  }

  /** `true` when water can be fetched to this cell. See `world/Water.ts`. */
  public waterAt(cell: GridPoint): boolean {
    return waterWithinReach(this.world, cell);
  }

  /**
   * Eats, burns firewood, and buries whoever did not make it.
   *
   * Deaths remove the villager outright. There is no illness model — the brief
   * asks for consequences, not a medical simulation.
   */
  /**
   * `true` when anything standing in the settlement makes food.
   *
   * Any of the five, and asked of the *recipe* rather than of a list of building
   * ids: a sixth kind of food building later is a row in a data file, and a
   * hard-coded list is how the advice came to be about Gatherer Huts alone.
   *
   * Staffing is deliberately not part of it. A field with nobody in it makes
   * nothing, but the panel already says so, and telling a player who has just
   * built one that nothing brings food in would be the game arguing with what is
   * on the screen.
   */
  private hasFoodSupply(): boolean {
    for (const building of this.world.buildings.all) {
      if (!building.isComplete) {
        continue;
      }
      const id = building.definition.recipeId;
      const recipe = id ? findRecipe(id) : null;
      if (recipe?.outputs.some((output) => isFood(output.resource))) {
        return true;
      }
    }
    return false;
  }

  private runDailyUpkeep(): void {
    const { report, dead } = runDay(
      this.villagers.all,
      this.storages,
      this.year,
      this.solace,
      this.wear,
      this.firewoodDemand(),
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

    // Fire, before the woods and after the eating: a settlement that lost its
    // larder tonight should feel it tomorrow rather than today, and a building
    // that burns is not owed the day's production it never finished.
    this.lastFire = runFire({
      world: this.world,
      random: this.fireRandom,
      isFreezing: this.year.isFreezing,
      waterAt: (cell) => this.waterAt(cell),
      villagers: this.villagers.all,
    });
    // The renderers watch the registry's version, and a building catching fire
    // is a change they have to see: it takes the fire's colour and starts
    // smoking. Nothing else about the building moved, so nothing else would.
    if (this.lastFire.started !== null || this.lastFire.saved.length > 0) {
      this.world.buildings.markChanged();
    }
    this.chronicle.firesFought += this.lastFire.saved.length;
    this.chronicle.firesLost += this.lastFire.lost.length;

    // **Whoever did not get out, before the building comes down.** The order is
    // load-bearing: pulling the building down clears the household that says who
    // was inside it, so the roll of the dead has to be written while there is
    // still a house to have been in.
    for (const id of this.lastFire.trapped) {
      const villager = this.villagers.findById(id);
      if (!villager) {
        continue;
      }
      this.necrology.record(villager, 'fire', this.year);
      this.villagers.remove(villager.id);
      this.totalDeaths += 1;
      this.chronicle.died += 1;
    }

    for (const id of this.lastFire.lost) {
      const building = this.world.buildings.getById(id);
      if (building) {
        // Nothing is salvaged and nothing is tipped out: what was inside has
        // burned with it, which is the whole cost of having no water in reach.
        this.retireBuilding(building, { salvage: false });
      }
    }

    // And the wood may come down tonight. Only the *arrival* is a daily roll;
    // what the pack then does happens on the tick, like everything else alive.
    if (
      this.wolves.considerRaid({
        world: this.world,
        random: this.wolfRandom,
        season: this.year.season,
        year: this.year.year,
      })
    ) {
      this.chronicle.wolfRaids += 1;
    }

    // Wounds knit. Slowly enough that two raids in a week is a different
    // proposition from two raids in a season.
    for (const villager of this.villagers.all) {
      if (villager.wounds > 0) {
        villager.wounds = Math.max(0, villager.wounds - WOUND_HEALING_PER_DAY);
      }
    }

    // The trees are a day older, which for two of them a year is the day they
    // change size. Before the wild spread, so a tree that came of age this
    // morning counts as grown wood today.
    this.world.trees.setDay(Math.floor(this.currentTick / TICKS_PER_DAY));

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

    // What the larder held at the end of the day, so tomorrow can tell a famine
    // from a harvest coming in. One number, and the whole difference between
    // advice that means something and advice a player learns to ignore.
    this.foodYesterday = foodStored(this.storages);

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
      foodDaysPerPerson: people === 0 ? 0 : foodStored(this.storages) / people,
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
    for (const cost of site.requiredMaterials()) {
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
   * Keeps a felling order or two standing for every workshop that cuts its own.
   *
   * Posted as ordinary `chop-tree` work rather than as something special, so a
   * hut's timber flows through exactly the same fell → logs on the ground →
   * haul → yard pipeline the player's own designations do. Nothing about the
   * economy has to know a Feller's Hut exists.
   *
   * Run on a cadence rather than every tick: counting the trees in a radius is
   * the one genuinely superlinear thing in this file, and no felling decision
   * changes meaningfully inside two and a half seconds.
   */
  private createFellingJobs(): void {
    if (this.currentTick % FELLING_INTERVAL_TICKS !== 0) {
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
      // The lower of the hut's own restraint and the player's ceiling. A hut
      // that went on cropping past a limit the player had set would be the one
      // building in the settlement ignoring them.
      const target = Math.min(
        felling?.logTarget ?? 0,
        this.stockLimits.get('logs') ?? Number.POSITIVE_INFINITY,
      );
      if (felling && this.logsInHand() < target) {
        this.cropTimber(building, felling.radius, felling.outstanding);
      }
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
    // **Grown wood only.** A sapling cut down is not a small harvest, it is no
    // harvest — see `TreeGrowth.ts` — so a hut that marked its own nursery would
    // be spending its people's day to make its own wood poorer. A hut whose
    // ground is all young trees posts nothing and waits, which is the pressure
    // the whole cycle is for.
    const standing = this.treesWithin(centre, radius).filter((tree) =>
      this.world.trees.isMature(tree),
    );

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
  private retireBuilding(
    building: Building,
    options: {
      /**
       * Whether what was inside survives.
       *
       * A yard pulled down tips its goods onto the plot — somebody carried every
       * one of those in. A yard that **burned** does not: the goods went with it,
       * and that is the whole cost of having had no water within reach.
       */
      readonly salvage: boolean;
    } = { salvage: true },
  ): void {
    for (const job of this.jobs.all) {
      const aimedHere =
        job.targetEntityId === building.id &&
        (job.type === 'produce' || job.type === 'build' || job.type === 'demolish');
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
    // deleting them. Somebody carried every one of those in — unless it burned.
    if (building.storageId !== null) {
      const storage = this.storages.getById(building.storageId);
      if (storage) {
        if (options.salvage) {
          for (const { resource, amount } of storage.inventory.contents) {
            this.world.dropNear(building.accessCell, resource, amount);
          }
        }
        this.storages.remove(storage.id);
      }
    }

    if (options.salvage) {
      for (const { resource, amount } of building.input.contents) {
        this.world.dropNear(building.accessCell, resource, amount);
      }
    }

    this.world.buildings.demolish(this.world, building.id);
  }

  /**
   * Decides what the ground does after a tree comes off it.
   *
   * The whole rule, in two lines:
   *
   * ```text
   * a workshop's own felling ──▶ a sapling, standing the same afternoon
   * the player's felling     ──▶ cleared for good
   * ```
   *
   * **The sapling is real, and it is why the lodge is gone.** What was here
   * before was a ledger of stumps: a felled cell was remembered and five years
   * later a full-grown tree appeared out of nothing. It worked, and the player
   * could not see any of it — a wood being cropped sustainably and a wood being
   * emptied looked identical. A workshop's felling now leaves a young tree on the
   * cell it cut, and that tree spends three years growing through three visible
   * sizes. Management is a thing on the map: a stand of saplings is a wood you
   * have already spent, and it says so.
   *
   * The player's own felling still clears for good. They mark trees to make room,
   * and ground they cleared has to stay cleared or a sapling turns up where they
   * meant to put a house.
   */
  private recordFelling(cell: GridPoint, playerOrdered: boolean): void {
    if (playerOrdered) {
      this.woodland.clear(cell);
      return;
    }

    // Ground the player cleared before now stops being barren: the last thing
    // done to a cell is what it remembers, and a workshop cutting here means
    // this is woodland being worked again.
    this.woodland.reclaim(cell);
    // From the forest's own stream, like the wild spread: a tree coming back is
    // the woodland's business rather than any villager's. Shape and size only —
    // the sapling's age is today by definition.
    this.world.regrowTree(
      cell,
      this.forestRandom.int(0, TREE_VARIANTS),
      this.forestRandom.float(0.6, 0.9),
    );
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

  /**
   * Sets or lifts the ceiling on a good.
   *
   * A command, like every other player intent: the UI states a wish and the
   * simulation decides what happens to it. Standing production work is taken off
   * the board the moment a ceiling is lowered past what is already stored, so
   * the quarry stops on the tap rather than at the end of whatever batch its
   * masons had started.
   */
  public setStockLimit(resource: ResourceId, limit: number | null): boolean {
    if (!this.stockLimits.set(resource, limit)) {
      return false;
    }

    for (const building of this.world.buildings.all) {
      const id = building.definition.recipeId;
      const recipe = id ? findRecipe(id) : null;
      if (recipe && recipe.outputs.some((output) => output.resource === resource)) {
        if (this.outputsAtLimit(recipe)) {
          this.cancelProductionAt(building.id);
        }
      }
    }
    this.world.buildings.markChanged();
    return true;
  }

  /**
   * `true` when everything a recipe makes is at its ceiling.
   *
   * Every output, not any: a recipe that yields two goods is worth running for
   * either of them, and stopping a Hunter because the larder is full would take
   * the settlement's hides with it.
   */
  /**
   * The good whose ceiling has stopped a workshop, or `null` if nothing has.
   *
   * For the panel. A workshop standing idle because the player told it to is
   * indistinguishable from a broken one, and "nobody is working here" would be
   * the wrong explanation and the wrong fix.
   */
  public productionHaltedBy(buildingId: number): ResourceId | null {
    const building = this.world.buildings.getById(buildingId);
    const id = building?.definition.recipeId;
    const recipe = id ? findRecipe(id) : null;
    if (!building?.isComplete || !recipe || !this.outputsAtLimit(recipe)) {
      return null;
    }
    return recipe.outputs[0]?.resource ?? null;
  }

  private outputsAtLimit(recipe: Recipe): boolean {
    if (recipe.outputs.length === 0) {
      return false;
    }
    return recipe.outputs.every((output) =>
      this.stockLimits.reached(output.resource, this.storages.totalOf(output.resource)),
    );
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

      // **Enough is enough.** Every output at the player's ceiling means this
      // workshop is making goods the settlement asked it to stop making, so its
      // work comes off the board and its staff are handed back for the day —
      // the same treatment, and the same reasoning, as a crop out of season. Any
      // output still wanted keeps it running: a Hunter whose meat is capped is
      // still the settlement's only source of hides.
      if (this.outputsAtLimit(recipe)) {
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

    const report = runIllness(
      this.villagers.all,
      this.illnessRandom,
      staffed * supplied,
      // A varied larder keeps people out of their sickbeds, and days not spent
      // ill are days at the end of a life. See `population/IllnessSystem.ts`.
      varietyShare(foodKinds(this.storages, this.villagers.count)),
      // And whether there is water by the houses to wash in, which is what
      // decides how far a case gets — the same Well that puts out fires.
      this.wateredShare(),
    );
    // **Whoever did not come through it.** Buried here rather than inside the
    // illness system, for the same reason a fire's dead are: that system decides
    // who does not recover, and what a death means for the roll, the household
    // and the job they were holding is this one's business.
    for (const id of report.died) {
      const villager = this.villagers.findById(id);
      if (!villager) {
        continue;
      }
      this.necrology.record(villager, 'illness', this.year);
      this.villagers.remove(villager.id);
      this.totalDeaths += 1;
      this.chronicle.died += 1;
    }
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
    // **Food is judged as a larder, not as five separate goods.** Each kind
    // wants only its own share of the twenty-five a person eats through, so
    // asking per kind would drop the harvest to the bottom of the board while
    // the settlement was still four fifths short of a winter's food. What the
    // rule means is "is there enough to eat", and that is one question.
    const fedUp = foodStored(this.storages) >= foodWantedPerVillager() * people;
    for (const resource of RESOURCE_IDS) {
      // The player's ceiling wins where they have set one: it is a statement
      // about this settlement, and the per-villager figure is only a default for
      // settlements that have not said anything.
      const limit = this.stockLimits.get(resource);
      if (limit !== null) {
        if (this.storages.totalOf(resource) >= limit) {
          enough.add(resource);
        }
        continue;
      }
      if (isFood(resource)) {
        if (fedUp) {
          enough.add(resource);
        }
        continue;
      }
      if (
        this.storages.totalOf(resource) >=
        resourceDefinition(resource).wantedPerVillager * people
      ) {
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
  public get wolfRandomState(): { seed: number; cursor: number } {
    return this.wolfRandom.getState();
  }

  public restoreWolfRandom(state: { seed: number; cursor: number }): void {
    this.wolfRandom.setState(state);
  }

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
