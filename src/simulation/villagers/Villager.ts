/**
 * A villager: an autonomous simulation entity.
 *
 * The authoritative one. A sprite elsewhere is a picture of this object, never
 * a second copy of it.
 *
 * Status: Phase 12. Identity, position, movement, job assignment, a carried
 * inventory, needs, a home and an age that actually advances are all live.
 *
 * `profession` is still not modelled: villagers take whatever work the job
 * board offers rather than holding a trade.
 */

import type { BuildingId } from '@/data/buildings';
import { ADULT_AGE, RETIREMENT_AGE, WORKING_AGE } from '@/data/population';
import { skillLevelOf, type SkillLevel } from '@/data/skills';
import type { GridPoint, WorldPoint } from '@/shared/types/geometry';
import { Inventory } from '@/simulation/resources/Inventory';

/** How many units a villager can carry at once, across all resources. */
const CARRY_CAPACITY = 10;

/** What a villager is doing, as far as the renderer needs to know. */
export type VillagerActivity = 'idle' | 'walking' | 'working' | 'hauling' | 'ill';

/**
 * A standing instruction about where somebody should work.
 *
 * A plain union rather than an object so it writes to a save as-is. See
 * {@link Villager.workPreference} for what the three states mean.
 */
export type WorkPreference = number | 'labourer' | null;

/**
 * Which of two a villager is.
 *
 * Added for one reason: a household should read the way a player expects, with
 * a couple and children who carry a family name. Nothing else in the game
 * consults it — there is no difference in what anybody can do, eat, carry or
 * survive, and there is not going to be one.
 *
 * It does decide who may pair with whom, which is the one place it could have
 * done damage: a settlement that happened to be founded eight to two would
 * make fewer couples and grow more slowly. That was measured rather than
 * assumed before it shipped. See `docs/GAME_DESIGN.md`.
 */
export type Sex = 'f' | 'm';

export interface VillagerNeeds {
  /** 0 = starving, 100 = full. */
  hunger: number;
  /** 0 = freezing, 100 = warm. */
  warmth: number;
  /** 0 = dead, 100 = healthy. */
  health: number;
  /**
   * How the settlement feels about itself. 0 = wretched, 100 = at peace.
   *
   * The fourth need, and the only one that is a **bonus rather than a
   * requirement**: 50 is neutral and is exactly how the game has always
   * played. Above it people work faster; below it nothing bad happens at all.
   * A settlement that never builds a Temple or a Cemetery is not punished for
   * it — it simply never collects the reward, the same bargain tools make.
   *
   * That asymmetry is deliberate. A fourth need that could kill would be a
   * fourth way for a first winter to end, on a game whose opening is already
   * hard enough that a well-played settlement survives one seed in eight.
   */
  spirit: number;
}

export class Villager {
  public readonly id: number;
  public readonly name: string;
  public readonly sex: Sex;
  public age: number;

  /** Continuous position, in world units (one unit = one cell). */
  public position: WorldPoint;
  /**
   * Position at the start of the current tick.
   *
   * The renderer interpolates between this and {@link position} using the
   * clock's tick alpha, so movement looks smooth at 60fps even though the
   * simulation only steps 10 times a second.
   */
  public previousPosition: WorldPoint;

  public activity: VillagerActivity = 'idle';
  public readonly needs: VillagerNeeds = { hunger: 100, warmth: 100, health: 100, spirit: 50 };
  /** What the villager is physically carrying. */
  public readonly inventory = new Inventory(CARRY_CAPACITY);

  /** Remaining waypoints. Empty when standing still. */
  public path: GridPoint[] = [];
  /** Ticks to wait before looking for something else to do. */
  public idleTicks = 0;
  /** Set when a path was requested but has not been computed yet. */
  public awaitingPath = false;
  /** Where the villager is trying to get to, if anywhere. */
  public destination: GridPoint | null = null;
  /** The job this villager has claimed, or `null` when unemployed. */
  public currentJobId: number | null = null;

  /**
   * The building this villager works at, or `null` for a labourer.
   *
   * A villager's profession *is* this: the building carries the trade, so
   * adding a workshop adds a trade and nothing has to learn its name. A
   * labourer is not unemployed — they do the felling, mining, paving, hauling
   * and building, which is all the work that belongs to the settlement rather
   * than to a workshop.
   */
  public employerId: number | null = null;

  /**
   * What the player has decided this villager should do, if anything.
   *
   * Three states rather than two, and the third is the one that matters:
   *
   * - `null` — **automatic.** Employment places them wherever it needs hands.
   *   This is what everybody starts as and what most people stay as.
   * - a building id — **posted there.** They hold that job ahead of anyone the
   *   settlement would have picked, and they get it back when it frees up.
   * - `'labourer'` — **kept off the workshops on purpose.** Not the same as
   *   automatic: an unemployed villager is exactly who automatic employment
   *   grabs for the next vacancy, so without this there was no way to say
   *   "leave this one carrying things". Hauling is most of the work in the
   *   game and the settlement will happily starve itself of it.
   *
   * A preference is a standing instruction, not an assignment. Naming a
   * building that is full, unfinished or gone leaves them a labourer for now
   * and still pointed at it, because a player who posts somebody to a
   * half-built workshop means "when it opens" rather than "never mind".
   */
  public workPreference: WorkPreference = null;

  /**
   * The house this villager lives in, or `null` when there is no room.
   *
   * Homelessness is survivable in the mild seasons and dangerous in winter: a
   * fire warms a house, and someone with no house to go back to gets very
   * little out of the settlement's firewood.
   */
  public homeId: number | null = null;

  /** The age this villager will not outlive. Drawn from the seeded stream. */
  public lifespan: number;

  /** Days lived since the last birthday, so ageing is not a yearly jump. */
  public daysSinceBirthday = 0;

  /** Days until this villager's household will consider another child. */
  public birthCooldownDays = 0;

  /**
   * The villager this one is paired with, or `null` for somebody unattached.
   *
   * Pairs are what have children. Before this, a birth drew two eligible adults
   * out of the settlement at random each time, so "the parents" were a
   * different two people every day and there was nothing to show the player.
   *
   * A pairing is a fact about two people, not about a house. Requiring a shared
   * roof was tried when births were first written and produced *no children at
   * all* over six simulated years — the two people who happened to be given the
   * house with a spare bed were never both of an age — so a settlement stayed
   * sterile because of the order beds were handed out. Pairs form across the
   * whole settlement for that reason, and the spare bed is checked when the
   * child arrives rather than when the couple forms.
   */
  public partnerId: number | null = null;

  /**
   * Who this villager was born to, oldest id first, or `null` for a founder or
   * a newcomer who walked in from outside.
   *
   * Recorded because a settlement whose people are interchangeable is a
   * settlement nobody minds losing. Almost information and nothing else: the
   * only thing that reads it is the family name a child is given. There is no
   * inheritance of anything else, and nobody is stopped from pairing with a
   * relative — that last one is a real omission rather than an oversight, and
   * the note is here so the next person knows it was a choice.
   *
   * Stored oldest id first rather than as mother and father. The pair is
   * always one of each, so the roles could be recovered from `sex` if anything
   * ever needed them, and nothing does.
   */
  public parentIds: readonly [number, number] | null = null;

  /**
   * Days of sickness left to run, or 0 for somebody well.
   *
   * A countdown rather than a flag, so care can shorten a case rather than
   * only ending it — a healer is somebody who gets you through an illness, not
   * a switch that turns it off.
   */
  public illDaysRemaining = 0;

  /**
   * Days this villager has spent unwell in their whole life.
   *
   * Kept because sickness shortens a life: the effective lifespan is the one
   * rolled at birth less a year for every {@link ILL_DAYS_PER_YEAR_LOST} days of
   * it. A running total rather than a lifespan decremented in place, so the
   * number rolled from the seed stays readable and the cost is always derivable
   * from it.
   */
  public illDaysLived = 0;

  /**
   * Days worked at each trade, keyed by the building id of that trade.
   *
   * **A trade is a building** — that is already how a profession works in this
   * game — so a woodcutter of six years is `{'woodcutter': 288}`. Moving her to a
   * quarry makes her a beginner at quarrying without losing a day of her
   * woodcutting, which is what makes a specialist worth keeping where they are.
   *
   * A map rather than a single "profession" field on purpose: somebody who spent
   * three years at a hut and then four at a smithy is two things, and the second
   * does not erase the first. Written to the save as pairs.
   *
   * Empty for almost everybody most of the time, which is why it is a Map rather
   * than a record over every building id.
   */
  public readonly experience = new Map<BuildingId, number>();

  /** Days this villager has worked at a trade. Zero for one they have not. */
  public experienceAt(trade: BuildingId): number {
    return this.experience.get(trade) ?? 0;
  }

  /** What this villager has made of a trade. `'none'` for their first year. */
  public skillAt(trade: BuildingId): SkillLevel {
    return skillLevelOf(this.experienceAt(trade));
  }

  /**
   * The trade this villager is best at, or `null` for somebody with none.
   *
   * Ties break on the building id, so the answer does not depend on Map
   * insertion order — which a loaded save would not reproduce.
   */
  public get bestTrade(): BuildingId | null {
    let best: BuildingId | null = null;
    let bestDays = 0;
    for (const [trade, days] of [...this.experience].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (days > bestDays) {
        best = trade;
        bestDays = days;
      }
    }
    return best;
  }

  /** `true` while this villager is unwell. */
  public get isIll(): boolean {
    return this.illDaysRemaining > 0;
  }

  constructor(options: {
    id: number;
    name: string;
    sex: Sex;
    age: number;
    position: WorldPoint;
    lifespan: number;
  }) {
    this.id = options.id;
    this.name = options.name;
    this.sex = options.sex;
    this.age = options.age;
    this.position = options.position;
    this.previousPosition = options.position;
    this.lifespan = options.lifespan;
  }

  /**
   * `true` for one of the household's grown-ups.
   *
   * Marries, may take a house, and takes up one of its adult places. **Not** the
   * same as being able to work — see {@link canWork}. The two were one getter
   * for a long time, and separating them is what lets a house hold a family
   * rather than four people who happen to fit.
   */
  public get isAdult(): boolean {
    return this.age >= ADULT_AGE;
  }

  /**
   * `true` for somebody the settlement can put to work.
   *
   * From fourteen until they retire. Children below it are fed and grow up;
   * elders above it are fed and do not. Everything that asks "how many hands has
   * this settlement got" asks this, not {@link isAdult}.
   */
  public get canWork(): boolean {
    return this.age >= WORKING_AGE && this.age < RETIREMENT_AGE;
  }

  /** `true` for somebody past working age, who lives on and does not work. */
  public get isElder(): boolean {
    return this.age >= RETIREMENT_AGE;
  }

  /** `true` for somebody too young to be one of the grown-ups. */
  public get isChild(): boolean {
    return this.age < ADULT_AGE;
  }

  /** The cell the villager is currently standing in. */
  public get cell(): GridPoint {
    return { gx: Math.floor(this.position.wx), gy: Math.floor(this.position.wy) };
  }

  public get isMoving(): boolean {
    return this.path.length > 0;
  }

  /** Abandons the current route. */
  public clearPath(): void {
    this.path = [];
    this.destination = null;
    this.awaitingPath = false;
    this.activity = 'idle';
  }
}
