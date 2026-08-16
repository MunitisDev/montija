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

import { WORKING_AGE } from '@/data/population';
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

export interface VillagerNeeds {
  /** 0 = starving, 100 = full. */
  hunger: number;
  /** 0 = freezing, 100 = warm. */
  warmth: number;
  /** 0 = dead, 100 = healthy. */
  health: number;
}

export class Villager {
  public readonly id: number;
  public readonly name: string;
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
  public readonly needs: VillagerNeeds = { hunger: 100, warmth: 100, health: 100 };
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
   * settlement nobody minds losing. It is information and nothing else: no
   * system reads it, inheritance does not exist, and nobody is stopped from
   * pairing with a relative — that last one is a real omission rather than an
   * oversight, and the note is here so the next person knows it was a choice.
   *
   * Deliberately not "mother and father": the simulation has no notion of sex,
   * and inventing one to fill in a label would be a whole model added for a
   * caption.
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

  /** `true` while this villager is unwell. */
  public get isIll(): boolean {
    return this.illDaysRemaining > 0;
  }

  constructor(options: {
    id: number;
    name: string;
    age: number;
    position: WorldPoint;
    lifespan: number;
  }) {
    this.id = options.id;
    this.name = options.name;
    this.age = options.age;
    this.position = options.position;
    this.previousPosition = options.position;
    this.lifespan = options.lifespan;
  }

  /** Children do not work. They eat, and they grow up. */
  public get isAdult(): boolean {
    return this.age >= WORKING_AGE;
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
