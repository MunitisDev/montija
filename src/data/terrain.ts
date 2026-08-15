/**
 * Terrain definitions.
 *
 * Data-driven, and deliberately free of anything visual: colours and textures
 * are art, and belong to the renderer. What lives here is what the *simulation*
 * needs to know — can someone walk on it, can something be built on it.
 *
 * The renderer keeps its own placeholder palette keyed by these same ids.
 */

/** The terrain types generated in Phase 2. */
export type TerrainType = 'grass' | 'meadow' | 'forest' | 'water' | 'stone';

export interface TerrainDefinition {
  readonly id: TerrainType;
  readonly name: string;
  /** Whether a villager can walk across this tile. Drives navigation. */
  readonly walkable: boolean;
  /** Whether a building may occupy this tile. */
  readonly buildable: boolean;
  /**
   * Relative cost of crossing the tile, for pathfinding in Phase 3.
   * `1` is open ground; higher is slower going.
   */
  readonly movementCost: number;
}

export const TERRAIN: Readonly<Record<TerrainType, TerrainDefinition>> = {
  grass: { id: 'grass', name: 'Grass', walkable: true, buildable: true, movementCost: 1 },
  meadow: { id: 'meadow', name: 'Meadow', walkable: true, buildable: true, movementCost: 1 },
  // Passable but slow, and cleared before building.
  forest: { id: 'forest', name: 'Forest', walkable: true, buildable: false, movementCost: 2 },
  water: { id: 'water', name: 'Water', walkable: false, buildable: false, movementCost: 0 },
  stone: { id: 'stone', name: 'Rock', walkable: false, buildable: false, movementCost: 0 },
};

/** Every terrain type, in a stable order. Useful for tooling and tests. */
export const TERRAIN_TYPES: readonly TerrainType[] = [
  'grass',
  'meadow',
  'forest',
  'water',
  'stone',
];

export function terrainDefinition(type: TerrainType): TerrainDefinition {
  return TERRAIN[type];
}
