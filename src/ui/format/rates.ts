/**
 * Rates, shown by the season instead of by the day.
 *
 * **A day is too short a window to say anything in whole numbers.** A quarry with
 * three cutters turns out 10.285… stone a day; ten workers wear out half a tool;
 * a herbalist gets through a fraction of a bundle. Every one of those is an
 * honest figure and none of them is a number a player can hold in their head, so
 * the panels used to print `10.3` and `-0.5` and hope. The reader then has to do
 * the arithmetic the game already knows how to do: *is that enough for winter?*
 *
 * A season — twelve days, the unit the calendar and the whole survival loop are
 * already built on — is long enough that the same rates come out as **123 stone**
 * and **6 tools**. Whole numbers, and directly comparable against what is on the
 * shelf.
 *
 * The conversion lives here and nowhere else, and it happens at the *display*
 * boundary only. The per-day rate stays the working unit everywhere behind it:
 * the simulation spends by the day, and the ledger's "stores last about N days"
 * runway needs a per-day figure to divide by. Multiplying a rate by twelve in
 * the model would push the seasonal figure back into arithmetic that has nothing
 * to do with seasons.
 */

import { DAYS_PER_SEASON } from '@/simulation/seasons/SeasonClock';

/**
 * A per-day rate as a whole number of units per season.
 *
 * A real but tiny rate keeps its sign rather than rounding away to nothing: a
 * settlement losing a trickle of something is not a settlement in balance, and
 * `0` next to a red row would read as a contradiction.
 */
export function perSeason(perDay: number): number {
  const total = perDay * DAYS_PER_SEASON;
  if (total === 0) {
    return 0;
  }
  return Math.abs(total) < 1 ? Math.sign(total) : Math.round(total);
}

/** `perSeason`, as a string. */
export function seasonFigure(perDay: number): string {
  return String(perSeason(perDay));
}

/** `perSeason`, with an explicit `+` so a surplus reads as one. */
export function signedSeason(perDay: number): string {
  const total = perSeason(perDay);
  return total > 0 ? `+${total}` : String(total);
}

/**
 * A yearly total, as a figure a reader can hold in their head.
 *
 * Whole from ten upwards, one decimal below it. Tool wear is 2.4 a worker a
 * year and rounding it to 2 understates it by a fifth; a quarry's 1234 stone
 * gains nothing from a decimal point. The threshold is where those two
 * pressures cross.
 *
 * A real but tiny figure keeps a decimal rather than rounding to `0`, for the
 * same reason {@link perSeason} keeps its sign: a cost the settlement really
 * pays should not be printed as no cost at all.
 */
export function yearFigure(perYear: number): string {
  if (perYear === 0) {
    return '0';
  }
  if (Math.abs(perYear) >= 10) {
    return String(Math.round(perYear));
  }
  const rounded = Math.round(perYear * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
