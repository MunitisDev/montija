/**
 * Application-wide constants.
 *
 * Gameplay balance does not live here — buildings, resources, recipes and
 * terrain are data-driven under `src/data`. This file holds engine and
 * presentation setup that the whole app agrees on.
 *
 * Tile pixel dimensions are deliberately absent: they belong to the isometric
 * subsystem (`shared/math/isometric.ts`) and nowhere else.
 */

import type { CameraFeel } from '@/renderer/camera/CameraController';

/** Simulation ticks per second at 1x speed. */
export const TICKS_PER_SECOND = 10;

/** Backlog ceiling for a single frame; see SimulationClock. */
export const MAX_TICKS_PER_ADVANCE = 20;

/**
 * Map size, in grid cells.
 *
 * "A small wilderness map", per the MVP brief. 96x96 is a few minutes' walk
 * across at villager speed and keeps ~9k terrain tiles on screen budget.
 */
export const WORLD_WIDTH = 96;
export const WORLD_HEIGHT = 96;

/** Founding population, per the MVP brief: "approximately 10 villagers". */
export const STARTING_VILLAGERS = 10;

/**
 * What the settlers arrive with.
 *
 * Not a starting bonus but **what ten people could carry out in the night**, and
 * the difference shows in what is missing.
 *
 * **Timber, because it is worth the weight.** Enough to raise the first two or
 * three buildings, which is the difference between a camp and a settlement.
 *
 * **A little stone, and only a little.** Nobody flees carrying rock, but ten of
 * them carrying one stone each is a wall's worth between them, and it buys the
 * first building that needs any — a Woodcutter is four, a House four. It does not
 * buy the second, so the opening move of the game is still to go and find a
 * deposit; what it stops is the settlement standing at a half-built site on day
 * three with nothing to do about it.
 *
 * It was **no stone at all** for a long time, deliberately, so that the first
 * morning was a search rather than a shopping trip. Measured, that search turned
 * out to be the single thing every settlement died of — see the stone bottleneck
 * in `docs/GAME_DESIGN.md` — and starting with a handful is the mildest of the
 * available answers.
 *
 * **Iron nobody can use yet.** Taken because it was valuable rather than because
 * it was useful. It sits in the yard doing nothing until there is a Blacksmith to
 * work it, which is deliberate: it is a promise that the settlement has somewhere
 * to grow into.
 *
 * **Food is the grace period, and it was too short.** Ten people eat ten a day,
 * so this is simply how many days the settlers have before the settlement has
 * to be feeding itself. At 120 that was twelve days — and twelve days is not
 * enough, because the opening is not one task but three in sequence: find a
 * stone deposit, raise a Gatherer Hut, and get the food it forages carried in.
 * A player who spends the first week working out *what* to do has already lost.
 *
 * 156 is fifteen days, and it is a deliberate difficulty change rather than a
 * tuning nudge — a wider window to make the first mistake in and still recover.
 * What it does *not* do is change how the year ends: a settlement that never
 * gets a food supply going still dies, three days later than before.
 */
export const STARTING_RESOURCES = {
  // **The same fifteen days, and all of it one thing.** The settlers land with a
  // hold of roots and nothing else, which is the right starting position for a
  // game where a varied larder is a comfort you *build*: a settlement begins with
  // no water, no temple, no cemetery and one kind of food, and every one of those
  // is something the player goes and gets. Landing them with a mixed cargo was
  // tried and handed them a comfort on the first morning for nothing.
  vegetables: 156,
  logs: 45,
  stone: 10,
  iron: 8,
} as const;

export const ZOOM_LIMITS = {
  min: 0.35,
  max: 2.5,
} as const;

/** Starting zoom: close enough to read the terrain, wide enough to orient. */
export const INITIAL_ZOOM = 1;

export const CAMERA_FEEL: CameraFeel = {
  inertiaDamping: 0.002,
  zoomSmoothing: 0.0001,
  minimumFlickSpeed: 6,
};

/**
 * The seed used when nothing else picks one — a different valley every time.
 *
 * `Math.random` is right here and would be wrong three directories down. The
 * simulation must never roll its own dice, because a settlement has to be
 * reproducible from its seed; but *choosing* that seed is not simulation, it is
 * the one moment before a world exists. The number is then stored in the save,
 * so the settlement it produces is as replayable as any other.
 *
 * Kept away from tiny values so a fresh world does not look like a debug one.
 */
export function randomWorldSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000) + 1;
}

/**
 * The reference seed, used by the balance tests and by nothing else.
 *
 * A single pinned world is what makes "does a well-played settlement survive?" a
 * question with a stable answer. Play uses {@link randomWorldSeed}.
 */
export const REFERENCE_WORLD_SEED = 20260815;
