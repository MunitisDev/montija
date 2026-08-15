/**
 * The world: terrain, and everything standing on it.
 *
 * Status: Phase 4. Holds the terrain, the navigation grid and the trees.
 * Occupancy, buildings and resource nodes join in later phases, following the
 * structure in the project brief:
 *
 * ```text
 * World
 *  ├── TerrainGrid      implemented
 *  ├── NavigationGrid   implemented
 *  ├── TreeRegistry     implemented
 *  ├── OccupancyGrid    Phase 6
 *  ├── Buildings        Phase 6
 *  ├── ResourceNodes    Phase 5
 *  └── Villagers        owned by the Simulation, not the World
 * ```
 */

import { terrainDefinition, type TerrainType } from '@/data/terrain';
import { gridBoundsToScene } from '@/shared/math/isometric';
import type { GridPoint, SceneBounds } from '@/shared/types/geometry';
import { NavigationGrid } from './NavigationGrid';
import type { TerrainGrid } from './TerrainGrid';
import { TreeRegistry } from './TreeRegistry';
import { generateWorld } from './WorldGenerator';

export class World {
  public readonly terrain: TerrainGrid;
  public readonly navigation: NavigationGrid;
  public readonly trees: TreeRegistry;

  constructor(options: { width: number; height: number; seed: number }) {
    const generated = generateWorld(options);
    this.terrain = generated.terrain;
    this.trees = new TreeRegistry(generated.terrain.width, generated.trees);
    this.navigation = new NavigationGrid(this.terrain);
  }

  /** The middle of the map, used as the founding settlement's anchor. */
  public get centreCell(): GridPoint {
    return { gx: Math.floor(this.width / 2), gy: Math.floor(this.height / 2) };
  }

  public get width(): number {
    return this.terrain.width;
  }

  public get height(): number {
    return this.terrain.height;
  }

  /** The scene-space rectangle the camera may roam over. */
  public get sceneBounds(): SceneBounds {
    return gridBoundsToScene(this.width, this.height);
  }

  public terrainAt(cell: GridPoint): TerrainType {
    return this.terrain.getAt(cell);
  }

  /** `true` when a villager could stand on this cell. */
  public isWalkable(cell: GridPoint): boolean {
    return this.navigation.isWalkable(cell.gx, cell.gy);
  }

  /** `true` when a building could occupy this cell. Ignores occupancy for now. */
  public isBuildable(cell: GridPoint): boolean {
    if (!this.terrain.contains(cell.gx, cell.gy)) {
      return false;
    }
    return terrainDefinition(this.terrain.getAt(cell)).buildable;
  }

  /**
   * Fells a tree and clears the ground it stood on.
   *
   * Clearing the tile matters beyond cosmetics: forest is slow to cross and
   * cannot be built on, so felling trees is how the player will open up land
   * for the settlement in Phase 6. The navigation grid is updated in step,
   * because a stale cost here would send villagers the long way round forever.
   *
   * @returns `true` when a tree was actually removed
   */
  public fellTree(treeId: number): boolean {
    const tree = this.trees.remove(treeId);
    if (!tree) {
      return false;
    }

    const cell = { gx: tree.gx, gy: tree.gy };
    if (this.terrain.getAt(cell) === 'forest') {
      this.terrain.set(cell.gx, cell.gy, 'grass');
      this.navigation.refreshCell(this.terrain, cell.gx, cell.gy);
    }

    return true;
  }
}
