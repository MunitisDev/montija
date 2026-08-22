/**
 * Roads: the one thing a player can lay that makes the settlement itself work
 * better.
 *
 * Every economic problem this game has turned out to be a hauling problem. The
 * balance work found the settlement starving with food piled beside the hut
 * because nobody would carry it in; the fix was priorities, and priorities only
 * decide *what* gets carried, never how long the carrying takes. A road is the
 * player's answer to the second half — the first decision in the game that is
 * about the *shape* of the settlement rather than its contents.
 *
 * The bookkeeping — a bit per cell, a count, a version — is
 * {@link CellFlagGrid}, which a palisade uses too. What is a road and what is a
 * fence is the rest of the game; what they share is a bitmap.
 */

import { CellFlagGrid } from './CellFlagGrid';

/**
 * How much of a step's cost a road removes.
 *
 * Roughly half. Enough that a long haul along one is visibly quicker and worth
 * planning around, and not so much that a settlement without roads feels
 * broken — the game has to remain winnable by someone who never lays one.
 */
export const ROAD_COST_MULTIPLIER = 0.55;

/** How much faster a villager walks on a road. The inverse of the cost. */
export const ROAD_SPEED_MULTIPLIER = 1 / ROAD_COST_MULTIPLIER;

export class RoadGrid extends CellFlagGrid {}
