/**
 * The rescue: getting word out, and the wait for a ship.
 *
 * The other half of the shipwreck. The settlers came ashore with what they
 * could drag up the beach; this is how they leave. It is the game's only **win
 * condition**, and the shape of it is deliberately not "accumulate N of
 * something":
 *
 * ```text
 * raise a School  ──▶  a message can be written
 *        │
 *        ▼
 * carry it to the tideline  ──▶  the bottle goes out
 *        │
 *        ▼
 * RESCUE_YEARS pass  ──▶  a sail on the horizon
 *        │
 *        ▼
 * the ship lands  ──▶  the chronicle
 * ```
 *
 * **Why a school.** Somebody has to be able to write, and a settlement that can
 * spare the stone, iron and years to teach its children has stopped merely
 * surviving. That is the milestone worth marking, and it is a milestone the
 * economy already knows how to express — the school is simply the most
 * expensive thing in the game.
 *
 * **Why the bottle is carried rather than clicked.** The whole project refuses
 * to fake logistics: a tree does not become `wood += 1`, and a message does not
 * become `sent = true`. Somebody walks it to the water. It also means the sea
 * has to be reachable from the settlement, which is a real constraint on a map
 * where the coast is one edge.
 *
 * **Why the wait is so long.** The fantasy the brief asks for is a settlement
 * that lasts *generations* — the founders do not go home, their grandchildren
 * do. Anything short enough to sit through in one go would be a different game.
 *
 * This module is pure arithmetic over two recorded ticks. It owns no state and
 * touches nothing: the simulation records when the bottle went out and when the
 * ship landed, and asks this what that means today.
 */

import { DAYS_PER_SEASON, SEASONS, TICKS_PER_DAY } from '@/simulation/seasons/SeasonClock';

/** Days in a year, from the calendar rather than repeated here. */
export const DAYS_PER_YEAR = SEASONS.length * DAYS_PER_SEASON;

/**
 * Years between the bottle going out and the ship arriving.
 *
 * Counted from the message, not from the founding, so getting word out early is
 * worth something — a settlement that reaches a school by its tenth year sails
 * a decade before one that takes twenty.
 *
 * Forty is chosen against the two facts that bound it. A school needs stone,
 * iron and the mines to get them, which realistically lands somewhere in the
 * first ten or fifteen years; forty more puts the ship at roughly year fifty,
 * which is the span the game is about. In real time that is a little under an
 * hour at 4x and around three at 1x — a campaign, deliberately, not a session.
 */
export const RESCUE_YEARS = 40;

/**
 * How long the sail is visible before it lands.
 *
 * One season. The arrival should be something the player watches coming rather
 * than a dialog that appears over a settlement they were busy running.
 */
export const SAIL_SIGHTED_DAYS = DAYS_PER_SEASON;

export type RescueStage =
  /** No school yet. The settlement cannot write, and does not know it needs to. */
  | 'unaware'
  /** A school stands. The message can be written and carried out. */
  | 'ready'
  /** Somebody is walking it to the water. */
  | 'carrying'
  /** The bottle is away. Now it is only a matter of years. */
  | 'awaited'
  /** A sail on the horizon. */
  | 'sighted'
  /** The ship has landed. */
  | 'arrived';

/** The two ticks the simulation records, and nothing else. */
export interface RescueState {
  /** When the bottle reached the water, or `null` while it has not. */
  readonly messageSentTick: number | null;
  /** When the ship landed, or `null` while it has not. */
  readonly arrivedTick: number | null;
}

export const NO_RESCUE: RescueState = { messageSentTick: null, arrivedTick: null };

export interface RescueReport {
  readonly stage: RescueStage;
  /** Days until the ship lands, or `null` when no message is out. */
  readonly daysRemaining: number | null;
  /** The same span in whole years, for a sentence a player can hold. */
  readonly yearsRemaining: number | null;
  /** `true` while the player may send the message. */
  readonly canSendMessage: boolean;
}

export interface RescueConditions {
  /** A finished school stands. */
  readonly hasSchool: boolean;
  /** Somebody is already carrying the bottle. */
  readonly carrying: boolean;
}

/** Ticks between the bottle going out and the ship landing. */
export const RESCUE_TICKS = RESCUE_YEARS * DAYS_PER_YEAR * TICKS_PER_DAY;

/** The tick the ship lands, given when the message went out. */
export function arrivalTick(messageSentTick: number): number {
  return messageSentTick + RESCUE_TICKS;
}

/**
 * Reads the rescue at a given tick.
 *
 * Derived rather than stored, so a save carries two numbers and cannot restore
 * into a stage that disagrees with its own clock.
 */
export function readRescue(
  state: RescueState,
  tick: number,
  conditions: RescueConditions,
): RescueReport {
  if (state.arrivedTick !== null) {
    return { stage: 'arrived', daysRemaining: 0, yearsRemaining: 0, canSendMessage: false };
  }

  if (state.messageSentTick === null) {
    const stage: RescueStage = conditions.carrying
      ? 'carrying'
      : conditions.hasSchool
        ? 'ready'
        : 'unaware';
    return {
      stage,
      daysRemaining: null,
      yearsRemaining: null,
      // Never twice: a second bottle would not make the ship come sooner, and
      // offering the button again reads as though it might.
      canSendMessage: stage === 'ready',
    };
  }

  const remaining = Math.max(0, arrivalTick(state.messageSentTick) - tick);
  const daysRemaining = Math.ceil(remaining / TICKS_PER_DAY);
  return {
    stage: daysRemaining <= SAIL_SIGHTED_DAYS ? 'sighted' : 'awaited',
    daysRemaining,
    yearsRemaining: Math.floor(daysRemaining / DAYS_PER_YEAR),
    canSendMessage: false,
  };
}

/** `true` when the ship should land on this tick. */
export function hasShipLanded(state: RescueState, tick: number): boolean {
  return (
    state.arrivedTick === null &&
    state.messageSentTick !== null &&
    tick >= arrivalTick(state.messageSentTick)
  );
}
