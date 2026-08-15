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
 * a step to tree placement later cannot silently change the coastline.
 */

import { type TerrainType } from '@/data/terrain';
import { ValueNoise2D } from '@/shared/math/noise';
import { SeededRandom, deriveSeed, type RandomSource } from '@/shared/math/random';
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
}

export interface WorldGenerationOptions {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
}

export interface GeneratedWorld {
  readonly terrain: TerrainGrid;
  readonly trees: readonly TreeInstance[];
}

/** Tunables. Named so the thresholds are not bare numbers in the branch below. */
const WATER_LEVEL = 0.34;
const STONE_LEVEL = 0.74;
const FOREST_MOISTURE = 0.56;
const MEADOW_MOISTURE = 0.42;

/** Lattice resolution. Lower is smoother and produces larger landmasses. */
const ELEVATION_LATTICE = 6;
const MOISTURE_LATTICE = 8;

/** Chance a forest tile carries a tree. Below 1 so woods have clearings. */
const TREE_DENSITY = 0.72;
const TREE_VARIANTS = 3;

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

  const trees = placeTrees(terrain, new SeededRandom(deriveSeed(seed, 'trees')));

  return { terrain, trees };
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
      });
      nextId += 1;
    }
  }

  return trees;
}
