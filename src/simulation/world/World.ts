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
import { RoadGrid } from './RoadGrid';
import { ResourcePileRegistry } from '@/simulation/resources/ResourcePile';
import { NavigationGrid } from './NavigationGrid';
import type { TerrainGrid } from './TerrainGrid';
import { TreeRegistry } from './TreeRegistry';
import { generateWorld, type Shore } from './WorldGenerator';

/** Cells inland from the waterline the camp is set back by. */
const SHORE_SETBACK = 5;

export class World {
  public readonly terrain: TerrainGrid;
  public readonly navigation: NavigationGrid;
  public readonly trees: TreeRegistry;
  public readonly roads: RoadGrid;
  public readonly piles = new ResourcePileRegistry();
  public readonly buildings = new BuildingRegistry();

  /**
   * Which edge the sea is on.
   *
   * The direction the settlers were wrecked from, and therefore where their
   * salvage came ashore. Kept on the world rather than recomputed, because
   * "which side has the most water" is not the same question — a map can have
   * a big inland lake, and the story is about the coast.
   */
  public readonly shore: Shore;

  constructor(options: { width: number; height: number; seed: number }) {
    const generated = generateWorld(options);
    this.shore = generated.shore;
    this.terrain = generated.terrain;
    this.trees = new TreeRegistry(generated.terrain.width, generated.trees);
    this.navigation = new NavigationGrid(this.terrain);
    this.roads = new RoadGrid(this.terrain.width, this.terrain.height);
    this.navigation.useRoads(this.roads, this.terrain);
  }

  /** The middle of the map. */
  public get centreCell(): GridPoint {
    return { gx: Math.floor(this.width / 2), gy: Math.floor(this.height / 2) };
  }

  /**
   * Where the settlers came ashore, and where their salvage sits.
   *
   * The first buildable ground inland of the sea, on the line running from the
   * middle of the coast into the map. Walking inland from the water rather than
   * outward from the centre matters: it puts the camp *on the beach*, which is
   * the whole of the opening image, and it guarantees the sea is visible from
   * the settlement on the first frame.
   *
   * Falls back to the middle of the map if the search finds nothing, which
   * would mean a coast with no landfall at all — not a map this generator can
   * produce, but a settlement with nowhere to stand is a worse failure than a
   * settlement in the wrong place.
   */
  public get landfallCell(): GridPoint {
    const horizontal = this.shore === 'east' || this.shore === 'west';
    const along = horizontal ? Math.floor(this.height / 2) : Math.floor(this.width / 2);
    const depth = horizontal ? this.width : this.height;
    const inward = this.shore === 'east' || this.shore === 'south' ? -1 : 1;
    const start =
      this.shore === 'east' ? this.width - 1 : this.shore === 'south' ? this.height - 1 : 0;

    let seenWater = false;
    for (let step = 0; step < depth; step += 1) {
      const at = start + inward * step;
      const cell = horizontal ? { gx: at, gy: along } : { gx: along, gy: at };

      if (this.terrain.get(cell.gx, cell.gy) === 'water') {
        seenWater = true;
        continue;
      }
      // Only once past the sea itself: an inland lake on the way out would
      // otherwise beach the settlers on its far bank.
      if (!seenWater) {
        continue;
      }

      // A pace or two back from the waterline, so the camp has ground on every
      // side of it rather than a wall of sea against its back.
      const inland = horizontal
        ? { gx: at + inward * SHORE_SETBACK, gy: along }
        : { gx: along, gy: at + inward * SHORE_SETBACK };
      const spot = this.navigation.nearestWalkable(inland) ?? this.navigation.nearestWalkable(cell);
      if (spot) {
        return spot;
      }
    }

    return this.navigation.nearestWalkable(this.centreCell) ?? this.centreCell;
  }

  /**
   * The water's edge on the landfall line, where a messenger can reach the sea.
   *
   * Not the same as {@link landfallCell}: that is deliberately set back from
   * the waterline so the camp has ground behind it. Somebody throwing a bottle
   * has to get their feet wet, so this walks out from the settlement until the
   * last standable cell before the sea rather than stopping short of it.
   *
   * Falls back to the landfall itself when the search finds nothing — a coast
   * with no reachable water is not a map this generator makes, and a messenger
   * standing in the camp is a better failure than a messenger with nowhere to
   * go at all.
   */
  public get tidelineCell(): GridPoint {
    const horizontal = this.shore === 'east' || this.shore === 'west';
    const along = horizontal ? Math.floor(this.height / 2) : Math.floor(this.width / 2);
    const depth = horizontal ? this.width : this.height;
    const inward = this.shore === 'east' || this.shore === 'south' ? -1 : 1;
    const start =
      this.shore === 'east' ? this.width - 1 : this.shore === 'south' ? this.height - 1 : 0;

    let seenWater = false;
    for (let step = 0; step < depth; step += 1) {
      const at = start + inward * step;
      const cell = horizontal ? { gx: at, gy: along } : { gx: along, gy: at };

      if (this.terrain.get(cell.gx, cell.gy) === 'water') {
        seenWater = true;
        continue;
      }
      // Only past the sea, for the same reason landfall is: an inland lake on
      // the way out is not the ocean, and a bottle thrown into one goes
      // nowhere.
      if (seenWater && this.isWalkable(cell)) {
        return cell;
      }
    }

    return this.landfallCell;
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

  /**
   * `true` when a tree could take root here.
   *
   * Deliberately stricter than "is it empty": a sapling must not appear on a
   * road somebody paved, on a building's plot, or on rock and water. Growth
   * that undoes the player's work is not a living forest, it is vandalism.
   */
  public canGrowTree(cell: GridPoint): boolean {
    if (!this.terrain.contains(cell.gx, cell.gy)) {
      return false;
    }
    const type = this.terrain.getAt(cell);
    if (type !== 'grass' && type !== 'meadow' && type !== 'forest') {
      return false;
    }
    if (this.trees.has(cell) || this.roads.hasAt(cell)) {
      return false;
    }
    return this.buildings.getAt(cell) === null && this.piles.anyAt(cell) === null;
  }

  /**
   * Plants a tree, turning the ground back into woodland.
   *
   * The mirror of {@link fellTree}, and deliberately so: felling turns forest
   * into grass, and the only honest way for a wood to recover is for the
   * terrain to follow the trees back.
   */
  public plantTree(cell: GridPoint, variant: number, scale: number): boolean {
    if (!this.canGrowTree(cell)) {
      return false;
    }

    const tree = this.trees.plant(cell.gx, cell.gy, variant, scale);
    if (!tree) {
      return false;
    }

    if (this.terrain.getAt(cell) !== 'forest') {
      this.terrain.set(cell.gx, cell.gy, 'forest');
      this.navigation.refreshCell(this.terrain, cell.gx, cell.gy);
    }
    return true;
  }

  /** `true` when this cell could take a road, and has none yet. */
  public canPave(cell: GridPoint): boolean {
    if (!this.terrain.contains(cell.gx, cell.gy)) {
      return false;
    }
    if (this.roads.hasAt(cell)) {
      return false;
    }
    // A road is beaten into open ground. Trees have to come down first, and
    // water and rock are not passable at all — the same rule the player already
    // learned from placing buildings.
    return this.isWalkable(cell) && this.trees.getAt(cell) === null;
  }

  /**
   * Lays a road and re-costs the cell.
   *
   * The navigation grid is updated in the same breath, because a road nobody
   * routes over is only a decoration.
   *
   * @returns `true` when a road was actually laid
   */
  public paveRoad(cell: GridPoint): boolean {
    if (!this.roads.lay(cell.gx, cell.gy)) {
      return false;
    }
    this.navigation.refreshCell(this.terrain, cell.gx, cell.gy);
    return true;
  }

  /** Takes a road up again, giving back the ground underneath. */
  public liftRoad(cell: GridPoint): boolean {
    if (!this.roads.lift(cell.gx, cell.gy)) {
      return false;
    }
    this.navigation.refreshCell(this.terrain, cell.gx, cell.gy);
    return true;
  }
}
