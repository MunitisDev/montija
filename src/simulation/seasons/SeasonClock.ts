/**
 * The year: seasons, days and temperature.
 *
 * Pure arithmetic over the simulation tick, so it is deterministic and needs no
 * state of its own beyond the tick it is asked about. A save that records the
 * tick records the season for free.
 *
 * Deliberately not a meteorological model, as the brief insists. Temperature is
 * a smooth curve through the year with a little seasonal character, and that is
 * all the survival rules need.
 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Ticks in a day. At 10 ticks/second, a day is six seconds at 1x. */
export const TICKS_PER_DAY = 60;

/** Days in a season. A year is 48 days, about five minutes at 1x. */
export const DAYS_PER_SEASON = 12;

export const TICKS_PER_SEASON = TICKS_PER_DAY * DAYS_PER_SEASON;
export const TICKS_PER_YEAR = TICKS_PER_SEASON * SEASONS.length;

/** Mean temperature in each season, in degrees. */
const SEASON_TEMPERATURE: Readonly<Record<Season, number>> = {
  spring: 9,
  summer: 19,
  autumn: 6,
  winter: -8,
};

/** Below this, people need a fire to stay warm. */
export const FREEZING_POINT = 2;

/** How much a season multiplies foraged yields. Winter gives nothing. */
export const SEASON_FORAGE_SCALE: Readonly<Record<Season, number>> = {
  spring: 0.8,
  summer: 1.4,
  autumn: 1,
  winter: 0,
};

export interface YearState {
  readonly season: Season;
  /** Day within the current season, from 1. */
  readonly dayOfSeason: number;
  /** Whole years elapsed since the settlement was founded. */
  readonly year: number;
  readonly temperature: number;
  /** `true` when people need firewood to survive the night. */
  readonly isFreezing: boolean;
}

/** Reads the calendar at a given simulation tick. */
export function yearStateAt(tick: number): YearState {
  const tickInYear = ((tick % TICKS_PER_YEAR) + TICKS_PER_YEAR) % TICKS_PER_YEAR;
  const seasonIndex = Math.floor(tickInYear / TICKS_PER_SEASON);
  const season = SEASONS[seasonIndex] ?? 'spring';
  const tickInSeason = tickInYear - seasonIndex * TICKS_PER_SEASON;

  const temperature = temperatureAt(season, tickInSeason);

  return {
    season,
    dayOfSeason: Math.floor(tickInSeason / TICKS_PER_DAY) + 1,
    year: Math.floor(tick / TICKS_PER_YEAR) + 1,
    temperature,
    isFreezing: temperature < FREEZING_POINT,
  };
}

/**
 * Eases between this season's mean and the next one's.
 *
 * A step change at the season boundary would make winter arrive as a cliff;
 * easing gives the player the sense of the cold closing in, which is the whole
 * emotional point of autumn.
 */
function temperatureAt(season: Season, tickInSeason: number): number {
  const index = SEASONS.indexOf(season);
  const next = SEASONS[(index + 1) % SEASONS.length] ?? 'spring';
  const progress = tickInSeason / TICKS_PER_SEASON;

  const from = SEASON_TEMPERATURE[season];
  const to = SEASON_TEMPERATURE[next];
  // Blend only over the back half, so a season still feels like itself.
  const blend = Math.max(0, (progress - 0.5) * 2);
  return Math.round((from + (to - from) * blend) * 10) / 10;
}

/** `true` when the tick is the first of a new day. */
export function isDayBoundary(tick: number): boolean {
  return tick % TICKS_PER_DAY === 0;
}
