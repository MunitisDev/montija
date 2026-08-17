/**
 * Trades, and getting better at one.
 *
 * **A trade is a building.** The game already worked that way — a villager's
 * profession *is* the workshop they answer to, so adding a workshop adds a trade
 * and nothing has to learn its name — and experience follows the same rule. A
 * woodcutter of six years is a master woodcutter; move her to a quarry and she is
 * a beginner again, with her woodcutting still on record for the day somebody
 * builds another woodcutter.
 *
 * What experience buys is **speed at that work and nothing else**. Not better
 * yields, not a wider range, not a different animation: one number, multiplied
 * into the labour a tick is worth, in the same place tools and spirit already
 * multiply. Anything more would need the player to understand a second system
 * before they could read the first.
 *
 * Data rather than code, so how fast a trade is learned and what it is worth are
 * things to tune rather than to refactor.
 */

import { DAYS_PER_YEAR } from '@/simulation/seasons/SeasonClock';

/**
 * What somebody has made of a trade.
 *
 * `'none'` is not a rank — it is everybody's first year at everything, and it is
 * exactly the speed the game has always run at. The three named levels are all
 * bonuses, for the same reason spirit and tools are: a settlement that never
 * keeps anybody in one job is not being punished, it is simply not collecting.
 */
export type SkillLevel = 'none' | 'apprentice' | 'expert' | 'master';

/** In order, so a level can be compared and a list of them can be walked. */
export const SKILL_LEVELS: readonly SkillLevel[] = ['none', 'apprentice', 'expert', 'master'];

/**
 * Years of experience each level begins at.
 *
 * The player's own numbers: apprentice from one year, expert from two, master
 * from five.
 */
export const SKILL_THRESHOLD_YEARS: Readonly<Record<Exclude<SkillLevel, 'none'>, number>> = {
  apprentice: 1,
  expert: 2,
  master: 5,
};

/** The same thresholds in days, which is what experience is counted in. */
export const SKILL_THRESHOLD_DAYS: Readonly<Record<Exclude<SkillLevel, 'none'>, number>> = {
  apprentice: SKILL_THRESHOLD_YEARS.apprentice * DAYS_PER_YEAR,
  expert: SKILL_THRESHOLD_YEARS.expert * DAYS_PER_YEAR,
  master: SKILL_THRESHOLD_YEARS.master * DAYS_PER_YEAR,
};

/**
 * How much faster each level works at its own trade.
 *
 * Deliberately modest, and deliberately a **bonus rather than a penalty**: a
 * beginner works at 1.0, which is the rate every villager in the game has always
 * worked at. A master is half again as quick, which is the same size as a fully
 * equipped settlement's tool bonus — a big number, but one that takes five years
 * of somebody staying put to collect, and that a single reassignment throws away.
 *
 * **Not measured in play.** These are considered numbers. What is tested is the
 * property that matters: a settlement that never specialises runs at exactly the
 * speed it always did, for ever.
 */
export const SKILL_WORK_BONUS: Readonly<Record<SkillLevel, number>> = {
  none: 1,
  apprentice: 1.1,
  expert: 1.25,
  master: 1.5,
};

/**
 * What a child inherits from a parent who is a master.
 *
 * Given at working age to somebody who has never worked a day: they grew up in
 * the workshop, and it should show. A year is exactly the apprentice threshold,
 * so they start as an apprentice rather than merely near one — the point is that
 * a settlement which keeps its trades alive across a generation gets something
 * back for it.
 *
 * Only from a **master**, and only to a child born here. An expert's children
 * start where everybody else does; that is what makes five years a milestone
 * rather than a formality.
 */
export const INHERITED_EXPERIENCE_DAYS = SKILL_THRESHOLD_DAYS.apprentice;

/** The level a given number of days of experience amounts to. */
export function skillLevelOf(days: number): SkillLevel {
  if (days >= SKILL_THRESHOLD_DAYS.master) {
    return 'master';
  }
  if (days >= SKILL_THRESHOLD_DAYS.expert) {
    return 'expert';
  }
  if (days >= SKILL_THRESHOLD_DAYS.apprentice) {
    return 'apprentice';
  }
  return 'none';
}

/** Whole years of experience, for showing a player who thinks in years. */
export function skillYears(days: number): number {
  return Math.floor(days / DAYS_PER_YEAR);
}
