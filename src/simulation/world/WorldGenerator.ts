/**
 * Deterministic world generation.
 *
 * Kept simple on purpose. Two noise fields — elevation and moisture — are
 * thresholded into terrain, and trees are scattered across the wooded ground.
 * That is enough to produce a readable wilderness, and the brief is explicit
 * that gameplay matters more than terrain sophistication here.
 *
 * Everything derives from the world seed, so the same seed always produces the
 * same map. Each stage draws from its own named RNG stream, which means adding
 * a step to tree placement later cannot silently move the river.
 */

import { type TerrainType } from '@/data/terrain';
import { MATURE_DAYS } from './TreeGrowth';
import { ValueNoise2D } from '@/shared/math/noise';
import { SeededRandom, deriveSeed, type RandomSource } from '@/shared/math/random';
import type { GridPoint } from '@/shared/types/geometry';
import { TerrainGrid } from './TerrainGrid';

/** A tree standing on the map. Becomes harvestable in Phase 5. */
export interface TreeInstance {
  readonly id: number;
  readonly gx: number;
  readonly gy: number;
  /** Which placeholder silhouette to draw. */
  readonly variant: number;
  /** 0.85-1.15; keeps a forest from looking like stamped copies. */
  readonly scale: number;
  /**
   * The settlement day this tree took root, which is what its size is read from.
   *
   * Negative for the wood the map was generated with: those trees were standing
   * before anybody arrived, so they are planted `-MATURE_DAYS` and are full-grown
   * on day one. See `TreeGrowth.ts`.
   */
  readonly planted: number;
}

export interface WorldGenerationOptions {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
}

export interface GeneratedWorld {
  readonly terrain: TerrainGrid;
  readonly trees: readonly TreeInstance[];
  /** The water the settlement is built around. */
  readonly river: RiverCourse;
}

/** Tunables. Named so the thresholds are not bare numbers in the branch below. */
/**
 * Below this the ground is a pond.
 *
 * Lowered when the sea became a river. The old figure was set against a coast
 * that swallowed a fifth of the map anyway, so it hardly mattered how wet the
 * inland was; with the river carrying the water instead, the same threshold put
 * a quarter of some maps under standing water and left nowhere to build. What
 * is wanted now is the occasional pond — a reason to look at the map before
 * placing an orchard, not a marsh.
 */
const WATER_LEVEL = 0.28;
const STONE_LEVEL = 0.74;
const FOREST_MOISTURE = 0.56;
const MEADOW_MOISTURE = 0.42;

/** Lattice resolution. Lower is smoother and produces larger landmasses. */
const ELEVATION_LATTICE = 6;
const MOISTURE_LATTICE = 8;

/**
 * Which way the river runs. One of the two, chosen by the seed.
 *
 * Every map has one, so every settlement has water — the orchards need it, the
 * ditches come out of it, and it is the one feature of the map the player has
 * to build *around* rather than merely on. Leaving it to the elevation noise
 * would give some seeds a lake, some a puddle and some nothing at all.
 */
export const RIVER_AXES = ['horizontal', 'vertical'] as const;
export type RiverAxis = (typeof RIVER_AXES)[number];

/** Where the river runs, cell by cell along its axis. */
export interface RiverCourse {
  readonly axis: RiverAxis;
  /**
   * The middle of the channel at each step along the axis, in order.
   *
   * Kept rather than recovered from the terrain, because "which water is the
   * river" stops being answerable the moment the settlement digs its first
   * ditch — and the camp is placed on the riverbank.
   */
  readonly middle: readonly GridPoint[];
}

/**
 * How far the channel wanders from the middle of the map, as a fraction of it.
 *
 * Enough to swing across a good part of the map, so the two banks are rarely
 * equal and the river is a shape rather than a ruled line. Not so far that it
 * ever leaves the map, which would cut a corner off instead of crossing.
 */
const MEANDER = 0.18;

/** Lattice for the meander. Low, so the river bends in long slow curves. */
const RIVER_LATTICE = 3;

/** The channel is this many cells across, plus a cell where it runs wide. */
const RIVER_WIDTH = 2;

/** Chance a forest tile carries a tree. Below 1 so woods have clearings. */
const TREE_DENSITY = 0.72;
/**
 * How many tree shapes the renderer can draw.
 *
 * A cosmetic index, drawn from the seeded stream so a seed always grows the
 * same wood, and stored in the save so a loaded settlement looks like the one
 * it came from. Exported rather than duplicated as a literal, because the only
 * thing worse than one magic number is two that have to agree.
 */
export const TREE_VARIANTS = 6;

export function generateWorld(options: WorldGenerationOptions): GeneratedWorld {
  const { width, height, seed } = options;

  const elevationNoise = new ValueNoise2D(
    new SeededRandom(deriveSeed(seed, 'elevation')),
    ELEVATION_LATTICE,
  );
  const moistureNoise = new ValueNoise2D(
    new SeededRandom(deriveSeed(seed, 'moisture')),
    MOISTURE_LATTICE,
  );

  // Its own stream, so the river cannot shift the forest or anything else that
  // draws after it.
  const riverRandom = new SeededRandom(deriveSeed(seed, 'river'));
  const axis = RIVER_AXES[riverRandom.int(0, RIVER_AXES.length)] ?? 'horizontal';
  const meanderNoise = new ValueNoise2D(riverRandom, RIVER_LATTICE);

  const terrain = new TerrainGrid(width, height);

  for (let gy = 0; gy < height; gy += 1) {
    for (let gx = 0; gx < width; gx += 1) {
      // Sample in lattice units so feature size is independent of map size.
      const u = (gx / width) * ELEVATION_LATTICE;
      const v = (gy / height) * ELEVATION_LATTICE;
      const elevation = elevationNoise.fractal(u, v, 3, 0.5);

      const mu = (gx / width) * MOISTURE_LATTICE;
      const mv = (gy / height) * MOISTURE_LATTICE;
      const moisture = moistureNoise.fractal(mu, mv, 2, 0.5);

      terrain.set(gx, gy, classify(elevation, moisture));
    }
  }

  // Cut after the terrain is classified, so the river runs through whatever the
  // noise put there — a gorge in the rock, a marsh in the meadow — rather than
  // being a shape the elevation had to agree to.
  const river = carveRiver(terrain, axis, meanderNoise);

  const trees = placeTrees(terrain, new SeededRandom(deriveSeed(seed, 'trees')));

  return { terrain, trees, river };
}

/**
 * Cuts the channel across the map and returns the course it took.
 *
 * A river is written onto the terrain rather than subtracted from the elevation
 * like the old sea was, because a river is not a low place — it is a line, and
 * a line drawn by thresholding noise comes out as a chain of ponds. The meander
 * still comes from noise, so no two seeds bend the same way.
 *
 * It always runs the full width or height of the map: a river that stopped
 * halfway would be a lake with ambitions, and the whole point is that the
 * settlement has to get across it.
 */
function carveRiver(terrain: TerrainGrid, axis: RiverAxis, noise: ValueNoise2D): RiverCourse {
  const horizontal = axis === 'horizontal';
  const length = horizontal ? terrain.width : terrain.height;
  const span = horizontal ? terrain.height : terrain.width;
  const middle: GridPoint[] = [];

  for (let along = 0; along < length; along += 1) {
    const t = along / length;
    // Two octaves: one long sweep across the map, one gentler wobble on top.
    const wander = noise.fractal(t * RIVER_LATTICE, 0.5, 2, 0.5) - 0.5;
    const across = Math.round(span / 2 + wander * 2 * MEANDER * span);
    const centre = clamp(across, RIVER_WIDTH, span - 1 - RIVER_WIDTH);

    // A third sample decides where the channel runs wide, so the river is not a
    // ribbon of constant width ruled across the map.
    const wide = noise.sample(t * RIVER_LATTICE * 2, 3.5) > 0.62 ? 1 : 0;
    const half = Math.floor((RIVER_WIDTH + wide) / 2);

    for (let offset = -half; offset <= RIVER_WIDTH + wide - 1 - half; offset += 1) {
      const cell = horizontal
        ? { gx: along, gy: centre + offset }
        : { gx: centre + offset, gy: along };
      terrain.set(cell.gx, cell.gy, 'water');
    }

    middle.push(horizontal ? { gx: along, gy: centre } : { gx: centre, gy: along });
  }

  return { axis, middle };
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function classify(elevation: number, moisture: number): TerrainType {
  if (elevation < WATER_LEVEL) {
    return 'water';
  }
  if (elevation > STONE_LEVEL) {
    return 'stone';
  }
  if (moisture > FOREST_MOISTURE) {
    return 'forest';
  }
  if (moisture > MEADOW_MOISTURE) {
    return 'meadow';
  }
  return 'grass';
}

function placeTrees(terrain: TerrainGrid, random: RandomSource): TreeInstance[] {
  const trees: TreeInstance[] = [];
  let nextId = 1;

  // Row-major so the sequence depends only on the grid, never on iteration
  // order — a set or map here would make generation non-reproducible.
  for (let gy = 0; gy < terrain.height; gy += 1) {
    for (let gx = 0; gx < terrain.width; gx += 1) {
      if (terrain.get(gx, gy) !== 'forest') {
        continue;
      }
      if (!random.bool(TREE_DENSITY)) {
        continue;
      }
      trees.push({
        id: nextId,
        gx,
        gy,
        variant: random.int(0, TREE_VARIANTS),
        scale: random.float(0.85, 1.15),
        // Standing before the settlers arrived, so full-grown on their first day.
        planted: -MATURE_DAYS,
      });
      nextId += 1;
    }
  }

  return trees;
}
