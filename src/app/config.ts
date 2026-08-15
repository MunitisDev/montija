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
