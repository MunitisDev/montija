/**
 * How the world is coloured through the year.
 *
 * The game is about surviving winter, and until this existed January looked
 * exactly like July: all the tension the simulation builds — food rotting,
 * firewood running down, people with no roof — reached the player as numbers
 * and never as a view. The art bible asks that the player *feel* winter coming
 * before reading a single figure, and this is where that happens.
 *
 * Following the art bible's approach: terrain and vegetation get real seasonal
 * variants, and everything else is tinted. Four full sets of every building is
 * neither affordable nor needed.
 *
 * Presentation only. The simulation neither knows nor cares what colour the
 * grass is; it reports a season and the renderer decides what that looks like.
 */

import type { Season } from '@/simulation/seasons/SeasonClock';
import type { TerrainType } from '@/data/terrain';

export interface TerrainPalette {
  readonly fill: number;
  readonly edge: number;
}

/**
 * Terrain colours for each season.
 *
 * Water and stone barely move: a river is a river, and rock does not care what
 * month it is. Everything that grows does the work.
 */
const TERRAIN_BY_SEASON: Readonly<Record<Season, Readonly<Record<TerrainType, TerrainPalette>>>> = {
  // Fresh damp greens and brown mud, under a grey-blue sky.
  spring: {
    grass: { fill: 0x4a5b3a, edge: 0x415031 },
    meadow: { fill: 0x56683f, edge: 0x4a5b37 },
    forest: { fill: 0x35452c, edge: 0x2c3a24 },
    water: { fill: 0x2c3f4a, edge: 0x263742 },
    stone: { fill: 0x5a5750, edge: 0x4c4a44 },
  },
  // Deeper greens going dry at the edges, in warm light.
  summer: {
    grass: { fill: 0x51602f, edge: 0x475429 },
    meadow: { fill: 0x64702f, edge: 0x57632a },
    forest: { fill: 0x33452a, edge: 0x2a3a22 },
    water: { fill: 0x2f4650, edge: 0x283d47 },
    stone: { fill: 0x5d5a51, edge: 0x4f4c45 },
  },
  // Ochre, rust and umber under a low sun. The settlement's last warning.
  autumn: {
    grass: { fill: 0x5e5730, edge: 0x524c2a },
    meadow: { fill: 0x6d5f2c, edge: 0x5f5327 },
    forest: { fill: 0x4a4526, edge: 0x3e3a20 },
    water: { fill: 0x2b3c45, edge: 0x25343d },
    stone: { fill: 0x585449, edge: 0x4b473e },
  },
  // Desaturated blue-white. Cold reads as an absence of colour, not as blue
  // paint: the ground goes pale and everything living leaves the palette.
  winter: {
    grass: { fill: 0x8a8f8c, edge: 0x7b807d },
    meadow: { fill: 0x93968f, edge: 0x83867f },
    forest: { fill: 0x5c665c, edge: 0x4f584f },
    water: { fill: 0x40525c, edge: 0x384852 },
    stone: { fill: 0x6e6f6c, edge: 0x5f605d },
  },
};

/**
 * Canopy colours per season.
 *
 * Six variants rather than three, because the tree shapes went from three
 * conifers to three conifers and three broadleaves — and a birch the same green
 * as the pine beside it wastes the new silhouette. The later three run warmer
 * and lighter, which is what separates a broadleaf from a conifer at a glance
 * and is most of the reason a mixed wood reads as a wood.
 */
const CANOPY_BY_SEASON: Readonly<Record<Season, readonly number[]>> = {
  spring: [0x2f4029, 0x35472d, 0x293823, 0x46583a, 0x4e603e, 0x3d5033],
  summer: [0x2c3f24, 0x334828, 0x263620, 0x455728, 0x4d602c, 0x3c4e24],
  autumn: [0x6b4a1f, 0x7a5622, 0x59401d, 0x8a5a1e, 0x94661f, 0x7a4b1b],
  // Bare branches under snow: barely any canopy left to colour.
  winter: [0x4c5450, 0x545c57, 0x444b48, 0x565a52, 0x5e6259, 0x4e524b],
};

/**
 * The small stuff scattered over the ground: tufts, pebbles, ripples.
 *
 * Kept beside the terrain palette rather than inside the drawing code so the
 * whole year's colour lives in one file — which is what made a seasonal repaint
 * a data change rather than an art rewrite in the first place.
 */
export interface GroundDetail {
  /** Grass blades and forest litter. */
  readonly tuft: number;
  /** Bare earth and stones. */
  readonly soil: number;
  /** The lit edge of a tuft, or the crest of a ripple. */
  readonly highlight: number;
}

const DETAIL_BY_SEASON: Readonly<Record<Season, GroundDetail>> = {
  spring: { tuft: 0x5e7345, soil: 0x4a4034, highlight: 0x6f8551 },
  summer: { tuft: 0x6b7a37, soil: 0x544935, highlight: 0x7d8c40 },
  autumn: { tuft: 0x7a6a30, soil: 0x4e4230, highlight: 0x8d7b38 },
  winter: { tuft: 0x9aa09a, soil: 0x60605c, highlight: 0xb4bcbb },
};

/** Detail colours for a terrain type. Water tints its own highlight. */
export function groundDetail(season: Season, type: TerrainType): GroundDetail {
  if (type === 'water') {
    const base = DETAIL_BY_SEASON[season];
    return { ...base, highlight: season === 'winter' ? 0x6d8898 : 0x456673 };
  }
  return DETAIL_BY_SEASON[season];
}

/** Trunk colours. Wet and dark in spring, frosted in winter. */
const TRUNK_BY_SEASON: Readonly<Record<Season, number>> = {
  spring: 0x3d3227,
  summer: 0x453a2c,
  autumn: 0x40342a,
  winter: 0x4a4642,
};

/**
 * Ambient light, laid over the whole world.
 *
 * Carries the half of the mood that repainting the ground cannot: the low warm
 * sun of autumn, the flat blue cold of winter. Alpha is deliberately low —
 * this is light, not a colour filter, and the art underneath is painted
 * neutral so it can take it.
 */
export interface AmbientLight {
  readonly colour: number;
  readonly alpha: number;
}

const AMBIENT_BY_SEASON: Readonly<Record<Season, AmbientLight>> = {
  spring: { colour: 0x9fb4c4, alpha: 0.05 },
  summer: { colour: 0xffd9a0, alpha: 0.06 },
  autumn: { colour: 0xd79a4e, alpha: 0.1 },
  winter: { colour: 0x9fc0dc, alpha: 0.16 },
};

export function terrainPalette(season: Season, type: TerrainType): TerrainPalette {
  return TERRAIN_BY_SEASON[season][type];
}

/**
 * How many distinct canopy colours exist, and so how many tree shapes are worth
 * drawing. Exported so nothing has to hard-code the number twice.
 */
export const CANOPY_VARIANTS = CANOPY_BY_SEASON.spring.length;

export function canopyColour(season: Season, variant: number): number {
  const canopy = CANOPY_BY_SEASON[season];
  return canopy[variant % canopy.length] ?? canopy[0]!;
}

export function trunkColour(season: Season): number {
  return TRUNK_BY_SEASON[season];
}

export function ambientLight(season: Season): AmbientLight {
  return AMBIENT_BY_SEASON[season];
}

/**
 * How much of the canopy is still on the tree.
 *
 * Autumn thins, winter strips. Drawn rather than tinted because a bare tree has
 * a different silhouette from a green one, and silhouette is what the player
 * actually reads at this zoom.
 */
export function canopyFullness(season: Season): number {
  switch (season) {
    case 'autumn':
      return 0.82;
    case 'winter':
      return 0.42;
    default:
      return 1;
  }
}

/** Snow settles on winter trees and rooftops. */
export function hasSnow(season: Season): boolean {
  return season === 'winter';
}

/**
 * A cool, desaturating tint for buildings and people in the cold months.
 *
 * `0xffffff` is Phaser's "no tint", which is what the growing seasons want.
 */
export function structureTint(season: Season): number {
  switch (season) {
    case 'winter':
      return 0xb9c6d2;
    case 'autumn':
      return 0xe8d3ae;
    default:
      return 0xffffff;
  }
}
