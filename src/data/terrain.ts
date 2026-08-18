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
export type TerrainType = 'grass' | 'meadow' | 'forest' | 'water' | 'stone' | 'ditch';

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
  /**
   * Whether a bridge can carry traffic over it.
   *
   * The one way an unwalkable tile becomes crossable. Water can be spanned;
   * rock cannot, because a rock face is not a gap — it is the thing in the way,
   * and boards laid on it are boards laid on a wall.
   */
  readonly spannable?: boolean;
}

export const TERRAIN: Readonly<Record<TerrainType, TerrainDefinition>> = {
  grass: { id: 'grass', name: 'Grass', walkable: true, buildable: true, movementCost: 1 },
  meadow: { id: 'meadow', name: 'Meadow', walkable: true, buildable: true, movementCost: 1 },
  // Passable but slow, and cleared before building.
  forest: { id: 'forest', name: 'Forest', walkable: true, buildable: false, movementCost: 2 },
  water: {
    id: 'water',
    name: 'Water',
    walkable: false,
    buildable: false,
    movementCost: 0,
    spannable: true,
  },
  stone: { id: 'stone', name: 'Rock', walkable: false, buildable: false, movementCost: 0 },
  /**
   * A dug channel, with the river running through it.
   *
   * Water the settlement made. It behaves exactly like the river — nobody wades
   * a ditch, and nothing is built in one — and the difference that matters is
   * where it can be: a ditch has to be cut from water that is already there, so
   * a player can lead the river to an orchard rather than putting the orchard
   * wherever the river happens to run.
   */
  ditch: {
    id: 'ditch',
    name: 'Ditch',
    walkable: false,
    buildable: false,
    movementCost: 0,
    spannable: true,
  },
};

/** Every terrain type, in a stable order. Useful for tooling and tests. */
/**
 * Every terrain type, in a stable order.
 *
 * **Append only.** A save stores the terrain as one byte per cell, indexed into
 * this list, so inserting a type anywhere but the end would turn every meadow in
 * every existing save into whatever now sits at that index.
 */
export const TERRAIN_TYPES: readonly TerrainType[] = [
  'grass',
  'meadow',
  'forest',
  'water',
  'stone',
  'ditch',
];

/**
 * The terrains an orchard can drink from, and a ditch can be cut from.
 *
 * The river and the channels dug out of it. Kept here rather than written out at
 * each of the three places that ask, because "what counts as water" is a fact
 * about the terrain and not about orchards.
 */
export const WET_TERRAIN: readonly TerrainType[] = ['water', 'ditch'];

export function terrainDefinition(type: TerrainType): TerrainDefinition {
  return TERRAIN[type];
}
