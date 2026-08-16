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
 * What the settlers arrive with, per the MVP brief's "basic resources".
 *
 * Not generosity — a grace period. Villagers eat from the first day, and the
 * only food source is a Gatherer Hut that costs logs, stone, hauling and
 * labour to raise. Starting at zero meant starving before the settlement could
 * possibly feed itself, which reads as the game being broken rather than hard.
 *
 * 120 food is twelve days for ten people: one full season to get a hut
 * standing. The logs and stone are enough for that hut and a house.
 */
/**
 * What the settlers dragged out of the surf.
 *
 * Not a starting bonus but a **shipwreck's cargo**, and the difference shows in
 * what is and is not in it.
 *
 * **Timber, because a wrecked ship is made of it.** The single most useful
 * thing about a hull on a beach is that it comes apart into planks, and it is
 * the reason the settlement can put up its first buildings at all.
 *
 * **No stone.** Nobody salvages rock from a boat. Every building past the very
 * cheapest needs some, so the opening move of the game is now to go and find a
 * deposit — which is a decision on the first morning rather than a resource
 * that was simply in the box.
 *
 * **Iron nobody can use yet.** Fittings and nails, off the wreck. It sits in
 * the yard doing nothing until there is a Blacksmith to work it, which is
 * deliberate: it is a promise that the settlement has somewhere to grow into.
 *
 * Food is unchanged. The grace it buys — long enough to see the problem and
 * raise a hut — is load-bearing and measured in the balance tests.
 */
export const STARTING_RESOURCES = {
  food: 120,
  logs: 45,
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

/** Fallback seed used until the main menu can offer a choice. */
export const DEFAULT_WORLD_SEED = 20260815;
