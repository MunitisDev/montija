/**
 * The world: terrain, and everything standing on it.
 *
 * Status: Phase 6. Holds the terrain, the navigation grid, the trees, the
 * resources lying on the ground and the buildings.
 *
 * There is no separate occupancy grid: a building blocks its cells in the
 * navigation grid when placed. A second grid holding the same truth is a second
 * thing to keep in sync, and this game has no need for "occupied but walkable".
 *
 * Following the structure in the project brief:
 *
 * ```text
 * World
 *  ├── TerrainGrid      implemented
 *  ├── NavigationGrid   implemented
 *  ├── TreeRegistry     implemented
 *  ├── ResourcePiles    implemented
 *  ├── Buildings        implemented (footprints block navigation directly)
 *  └── Villagers        owned by the Simulation, not the World
 * ```
 */

import { LOGS_PER_TREE, STONE_PER_DEPOSIT } from '@/data/resources';
import { terrainDefinition, type TerrainType } from '@/data/terrain';
import { gridBoundsToScene } from '@/shared/math/isometric';
import type { GridPoint, SceneBounds } from '@/shared/types/geometry';
import { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';
import { ResourcePileRegistry } from '@/simulation/resources/ResourcePile';
import { NavigationGrid } from './NavigationGrid';
import type { TerrainGrid } from './TerrainGrid';
import { TreeRegistry } from './TreeRegistry';
import { generateWorld } from './WorldGenerator';

export class World {
  public readonly terrain: TerrainGrid;
  public readonly navigation: NavigationGrid;
  public readonly trees: TreeRegistry;
  public readonly piles = new ResourcePileRegistry();
  public readonly buildings = new BuildingRegistry();

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

  /** `true` when the terrain here would take a building. */
  public isBuildable(cell: GridPoint): boolean {
    if (!this.terrain.contains(cell.gx, cell.gy)) {
      return false;
    }
    return terrainDefinition(this.terrain.getAt(cell)).buildable;
  }

  /**
   * Fells a tree, drops its logs on the ground, and clears the tile.
   *
   * The logs are *physical*: they lie where the tree stood until somebody
   * carries them away. Nothing about the settlement's stock changes here, which
   * is the whole point — a felled tree is not wood in hand.
   *
   * Clearing the tile matters beyond cosmetics: forest is slow to cross and
   * cannot be built on, so felling trees is how the player opens up land for
   * the settlement. The navigation grid is updated in step, because a stale
   * cost here would send villagers the long way round forever.
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

    this.piles.drop(cell, 'logs', LOGS_PER_TREE);
    return true;
  }

  /**
   * Mines a surface stone deposit, dropping stone and opening the tile.
   *
   * Stone is impassable, so the deposit becomes walkable grass once worked out
   * — the settlement literally clears a path through the rock.
   *
   * @returns `true` when a deposit was actually worked
   */
  public mineStone(cell: GridPoint): boolean {
    if (this.terrain.getAt(cell) !== 'stone') {
      return false;
    }

    this.terrain.set(cell.gx, cell.gy, 'grass');
    this.navigation.refreshCell(this.terrain, cell.gx, cell.gy);

    // Safe to drop on the deposit's own tile: it became walkable grass on the
    // line above, so a hauler can reach the stone that was just cut from it.
    this.piles.drop(cell, 'stone', STONE_PER_DEPOSIT);
    return true;
  }
}
