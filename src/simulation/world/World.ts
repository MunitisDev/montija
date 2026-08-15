/**
 * The world: terrain, and everything standing on it.
 *
 * Status: Phase 2. Holds the terrain grid and the trees. The occupancy and
 * navigation grids, buildings, resource nodes and villagers join it in later
 * phases, following the structure in the project brief:
 *
 * ```text
 * World
 *  ├── TerrainGrid      implemented
 *  ├── OccupancyGrid    Phase 6
 *  ├── NavigationGrid   Phase 3
 *  ├── Buildings        Phase 6
 *  ├── ResourceNodes    Phase 5
 *  └── Villagers        Phase 3
 * ```
 */

import { terrainDefinition, type TerrainType } from '@/data/terrain';
import { gridBoundsToScene } from '@/shared/math/isometric';
import type { GridPoint, SceneBounds } from '@/shared/types/geometry';
import type { TerrainGrid } from './TerrainGrid';
import { generateWorld, type TreeInstance } from './WorldGenerator';

export class World {
  public readonly terrain: TerrainGrid;
  public readonly trees: readonly TreeInstance[];

  constructor(options: { width: number; height: number; seed: number }) {
    const generated = generateWorld(options);
    this.terrain = generated.terrain;
    this.trees = generated.trees;
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
    if (!this.terrain.contains(cell.gx, cell.gy)) {
      return false;
    }
    return terrainDefinition(this.terrain.getAt(cell)).walkable;
  }

  /** `true` when a building could occupy this cell. Ignores occupancy for now. */
  public isBuildable(cell: GridPoint): boolean {
    if (!this.terrain.contains(cell.gx, cell.gy)) {
      return false;
    }
    return terrainDefinition(this.terrain.getAt(cell)).buildable;
  }
}
