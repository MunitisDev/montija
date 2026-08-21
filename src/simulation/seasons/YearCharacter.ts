/**
 * What kind of year this is.
 *
 * **The granary was never the decision it should have been.** Every year was the
 * same year: the same fourteen freezing nights, the same harvest, so a settlement
 * that got through one winter got through all of them and a full larder in
 * autumn was tidiness rather than insurance. Nothing in the game ever asked the
 * player *why* they were keeping two hundred food they did not need.
 *
 * A year now has a character, and it is deliberately built to be the opposite of
 * bad luck:
 *
 * - **Derived, not rolled.** From the world's seed and the year's number, so the
 *   same valley has the same history twice and a settlement replayed from its
 *   save meets the same winter it met before.
 * - **Announced.** The character is fixed the moment the year begins and the game
 *   says so in spring — *the winter will be long* — which gives the player three
 *   seasons to answer it. A hard year the player was told about is a plan; the
 *   same year sprung in December is a dice roll.
 * - **The first year is never hard.** A settlement's opening is already the
 *   hardest thing in the game, and a bitter first winter would be the game
 *   killing beginners for something they had no way to see coming.
 *
 * Two numbers come out of it, and they are the two the settlement can actually
 * prepare against: how cold it gets, and how much the ground gives.
 */

import { deriveSeed, SeededRandom } from '@/shared/math/random';

/** How a year treats the settlement. */
export type YearKind = 'kind' | 'ordinary' | 'hard' | 'bitter';

export interface YearCharacter {
  readonly kind: YearKind;
  /**
   * Degrees taken off the whole year's temperature.
   *
   * Cold rather than a count of freezing nights, because temperature is already
   * on the HUD: a bitter year *reads* as bitter every day of it, and the extra
   * freezing nights fall out of the same number rather than being a second rule.
   */
  readonly coldBite: number;
  /** What the ground and the woods give, against an ordinary year's 1. */
  readonly harvest: number;
}

/**
 * The four kinds, and what each one costs.
 *
 * The bite is in degrees off a year whose winter sits at -8 and whose autumn
 * blends down through the freezing point: two degrees is about three more nights
 * of fire, five is about a week of them. The harvest is a straight multiplier on
 * everything seasonal — a field, an orchard, foraging, game, fish.
 *
 * A kind year exists so the *good* ones are legible too. A game where the
 * weather can only be neutral or worse teaches the player to read every
 * announcement as a punishment.
 */
export const YEAR_CHARACTERS: Readonly<Record<YearKind, YearCharacter>> = {
  kind: { kind: 'kind', coldBite: -1.5, harvest: 1.15 },
  ordinary: { kind: 'ordinary', coldBite: 0, harvest: 1 },
  hard: { kind: 'hard', coldBite: 2.5, harvest: 0.8 },
  bitter: { kind: 'bitter', coldBite: 5, harvest: 0.62 },
};

/**
 * How often each kind comes up.
 *
 * Weighted so an ordinary year is the common one and a bitter year is the one a player
 * remembers: roughly two ordinary years in five, one kind, one hard, and a
 * bitter one about every seven years. A settlement that keeps a year and a half
 * of food survives all of them; one that keeps a season does not.
 */
const WEIGHTS: readonly (readonly [YearKind, number])[] = [
  ['ordinary', 40],
  ['kind', 22],
  ['hard', 24],
  ['bitter', 14],
];

/** The first year is always ordinary. See the note at the top of this file. */
export const FIRST_YEAR_KIND: YearKind = 'ordinary';

/**
 * What kind of year the settlement's `year` is, in the world grown from `seed`.
 *
 * Its own random stream per year, drawn once: asking twice gives the same answer,
 * which is what lets this be called from anywhere — the HUD, the ledger, the
 * survival system — without anybody having to store it.
 */
export function characterOf(seed: number, year: number): YearCharacter {
  if (year <= 1) {
    return YEAR_CHARACTERS[FIRST_YEAR_KIND];
  }

  const random = new SeededRandom(deriveSeed(seed, `year-${year}`));
  const total = WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random.next() * total;
  for (const [kind, weight] of WEIGHTS) {
    roll -= weight;
    if (roll < 0) {
      return YEAR_CHARACTERS[kind];
    }
  }
  return YEAR_CHARACTERS.ordinary;
}
