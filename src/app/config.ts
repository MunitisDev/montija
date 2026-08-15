/**
 * Application-wide constants.
 *
 * Gameplay balance does not live here — buildings, resources and recipes are
 * data-driven under `src/data`. This file holds engine and presentation setup
 * that the whole app agrees on.
 */

import type { CameraFeel, CameraLimits } from '@/renderer/camera/CameraController';

/** Simulation ticks per second at 1x speed. */
export const TICKS_PER_SECOND = 10;

/** Backlog ceiling for a single frame; see SimulationClock. */
export const MAX_TICKS_PER_ADVANCE = 20;

/**
 * Placeholder world extent, in world units.
 *
 * Phase 2 replaces this with a real grid and isometric projection; for now it
 * only gives the camera something bounded to move across.
 */
export const PLACEHOLDER_WORLD = {
  /** Cells across the logical grid. */
  gridWidth: 96,
  gridHeight: 96,
  /** World units per grid cell. */
  cellSize: 64,
} as const;

export const WORLD_PIXEL_WIDTH = PLACEHOLDER_WORLD.gridWidth * PLACEHOLDER_WORLD.cellSize;
export const WORLD_PIXEL_HEIGHT = PLACEHOLDER_WORLD.gridHeight * PLACEHOLDER_WORLD.cellSize;

export const CAMERA_LIMITS: CameraLimits = {
  minZoom: 0.25,
  maxZoom: 2.5,
  bounds: {
    minX: 0,
    minY: 0,
    maxX: WORLD_PIXEL_WIDTH,
    maxY: WORLD_PIXEL_HEIGHT,
  },
};

export const CAMERA_FEEL: CameraFeel = {
  inertiaDamping: 0.002,
  zoomSmoothing: 0.0001,
  minimumFlickSpeed: 6,
};

export const INITIAL_ZOOM = 1;

/**
 * Muted, earthy placeholder palette.
 *
 * Colours here stand in for artwork and follow the art direction (dark stone,
 * aged timber, cold light) so the prototype never reads as a bright toy.
 */
export const PALETTE = {
  voidBackground: 0x12140f,
  grass: 0x4a5b3a,
  grassAlt: 0x536440,
  forest: 0x2f4029,
  water: 0x2c3f4a,
  stone: 0x5a5750,
  gridLine: 0x000000,
  worldEdge: 0x1d201a,
} as const;

/** Fallback seed used until the main menu can offer a choice. */
export const DEFAULT_WORLD_SEED = 20260815;
