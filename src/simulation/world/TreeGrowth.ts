/**
 * How a tree gets from a sapling to something worth felling.
 *
 * **The wood grows back by itself now, and it does it where you can see it.**
 * What was here before was a ledger of stumps: a felled cell was remembered, and
 * five years later a full-grown tree appeared out of nothing. It worked, and the
 * player could not see any of it — the difference between a wood being worked
 * sustainably and a wood being emptied was two invisible numbers.
 *
 * So the stump is gone and the sapling is real. A tree cut by a workshop leaves a
 * young tree standing on the same cell the same afternoon, and that tree spends
 * three years growing through three visible sizes before anybody can cut it
 * again. The management decision is now a thing on the map: a stand of saplings
 * is a wood you have already spent, and it says so.
 *
 * Three consequences worth knowing, all of them deliberate:
 *
 * - **Only a mature tree gives timber.** Cutting one down early is not a smaller
 *   harvest, it is no harvest — which is what makes "leave it another year" a
 *   decision rather than a rounding error.
 * - **A growing tree is still in the way.** It blocks building and paving like
 *   any tree, and the player can order it *cleared*: gone for good, no timber,
 *   and quick work, because pulling up a sapling is not felling.
 * - **Ground the player clears stays clear.** Only a workshop's own felling
 *   replants — see `Woodland` — so marking trees to make room still makes room.
 *
 * Age is counted in days from the settlement's own clock, not in ticks: growth is
 * the slowest process in the game and the day boundary is where every other slow
 * process already lives.
 */

import { DAYS_PER_YEAR } from '@/simulation/seasons/SeasonClock';

/** Years from sapling to a tree worth felling. The player's own figure. */
export const MATURE_YEARS = 3;

/** The same in days, which is what the clock counts. */
export const MATURE_DAYS = MATURE_YEARS * DAYS_PER_YEAR;

/**
 * When a sapling becomes a half-grown tree.
 *
 * Halfway, at eighteen months. Two thresholds rather than three or ten: the
 * player has to be able to read a wood's age off the map at a glance, and three
 * sizes is about the limit of what a silhouette can say from a tablet's viewing
 * distance.
 */
export const HALF_GROWN_DAYS = MATURE_DAYS / 2;

/** What a tree looks like, and whether it is worth an axe. */
export type TreeStage = 'sapling' | 'young' | 'mature';

/** In order, smallest first. */
export const TREE_STAGES: readonly TreeStage[] = ['sapling', 'young', 'mature'];

/**
 * How far along a tree planted on `planted` is by `today`.
 *
 * Trees the map was generated with are planted at `-MATURE_DAYS`, so the wood the
 * settlers walk into is full-grown on the day they arrive — which is the honest
 * reading of a valley that was there before them.
 */
export function treeStage(planted: number, today: number): TreeStage {
  const age = today - planted;
  if (age >= MATURE_DAYS) {
    return 'mature';
  }
  return age >= HALF_GROWN_DAYS ? 'young' : 'sapling';
}

/** `true` when this tree would give timber. Nothing else may be felled for logs. */
export function isMatureAt(planted: number, today: number): boolean {
  return treeStage(planted, today) === 'mature';
}
