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
import { WET_TERRAIN, terrainDefinition, type TerrainType } from '@/data/terrain';
import { gridBoundsToScene } from '@/shared/math/isometric';
import type { GridPoint, SceneBounds } from '@/shared/types/geometry';
import { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';
import { RoadGrid } from './RoadGrid';
import { ResourcePileRegistry } from '@/simulation/resources/ResourcePile';
import { NavigationGrid } from './NavigationGrid';
import type { TerrainGrid } from './TerrainGrid';
import { TreeRegistry } from './TreeRegistry';
import { generateWorld, type RiverCourse } from './WorldGenerator';

/** Cells back from the water the camp is set, so it has ground on every side. */
const BANK_SETBACK = 4;

export class World {
  public readonly terrain: TerrainGrid;
  public readonly navigation: NavigationGrid;
  public readonly trees: TreeRegistry;
  public readonly roads: RoadGrid;
  public readonly piles = new ResourcePileRegistry();
  public readonly buildings = new BuildingRegistry();

  /**
   * The river the settlement is built around.
   *
   * Kept on the world rather than recomputed, because "which water is the
   * river" stops being answerable the moment somebody digs a ditch — and both
   * the camp and the ditch rules need to know.
   */
  public readonly river: RiverCourse;

  constructor(options: { width: number; height: number; seed: number }) {
    const generated = generateWorld(options);
    this.river = generated.river;
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
   * Where the settlers made camp, and where their stores sit.
   *
   * On the bank of the river, halfway along its course. Water is the reason to
   * stop walking: it is what the orchards need, what the ditches come out of,
   * and the one thing on the map a settlement cannot do without — so the camp
   * is set against it, a few paces back so there is ground on every side rather
   * than a channel at its back.
   *
   * Both banks are tried, nearer one first, because the river's meander leaves
   * one side of the map wider than the other and the camp belongs on the side
   * with room. Falls back to the middle of the map if neither bank will take
   * it, which no map this generator produces — but a settlement standing in the
   * wrong place is a better failure than one with nowhere to stand.
   */
  public get landfallCell(): GridPoint {
    if (this.camp) {
      return this.camp;
    }
    this.camp = this.findLandfall();
    return this.camp;
  }

  /**
   * The settlement's own patch of ground, for asking what is reachable.
   *
   * The camp cell itself is built over within a tick of the game starting — the
   * founding yard stands on it — so the anchor has to be a cell somebody can
   * actually stand on nearby.
   */
  public get heartCell(): GridPoint {
    const camp = this.landfallCell;
    return this.navigation.nearestWalkable(camp) ?? camp;
  }

  /** Worked out once: the map does not move, and the answer is a search. */
  private camp: GridPoint | null = null;

  private findLandfall(): GridPoint {
    const course = this.river.middle;
    const centre = course[Math.floor(course.length / 2)] ?? this.centreCell;
    const horizontal = this.river.axis === 'horizontal';

    for (const setback of [BANK_SETBACK, BANK_SETBACK + 3, BANK_SETBACK + 6]) {
      for (const side of [1, -1]) {
        const bank = horizontal
          ? { gx: centre.gx, gy: centre.gy + side * setback }
          : { gx: centre.gx + side * setback, gy: centre.gy };
        if (!this.terrain.contains(bank.gx, bank.gy)) {
          continue;
        }
        const spot = this.navigation.nearestWalkable(bank, 6);
        if (spot) {
          return spot;
        }
      }
    }

    return this.navigation.nearestWalkable(this.centreCell) ?? this.centreCell;
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
   * Clears a cell of anything standing on it, leaving open ground.
   *
   * The difference from {@link fellTree} is that nothing is salvaged: the tree
   * is gone and there are no logs where it stood. That is the honest reading of
   * ground being cleared *for* something rather than harvested — the settlers
   * pushed the scrub aside making room for their stores, they did not spend
   * their first hour stacking timber.
   *
   * Roads go too, for the same reason a building takes up the road beneath it.
   *
   * @returns `true` when anything was actually removed
   */
  public clearGround(cell: GridPoint): boolean {
    let cleared = false;

    const tree = this.trees.getAt(cell);
    if (tree && this.trees.remove(tree.id)) {
      cleared = true;
    }
    if (this.terrain.contains(cell.gx, cell.gy) && this.terrain.getAt(cell) === 'forest') {
      this.terrain.set(cell.gx, cell.gy, 'grass');
      cleared = true;
    }
    if (this.roads.lift(cell.gx, cell.gy)) {
      cleared = true;
    }

    if (cleared) {
      this.navigation.refreshCell(this.terrain, cell.gx, cell.gy);
    }
    return cleared;
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

  /**
   * `true` when this cell could be dug into a channel.
   *
   * The rule that makes a ditch interesting: it has to be cut from water that is
   * already there. So a settlement leads the river where it wants it, one cell
   * at a time, and a ditch is a line the player draws rather than a tile they
   * stamp.
   */
  public canDig(cell: GridPoint): boolean {
    if (!this.terrain.contains(cell.gx, cell.gy)) {
      return false;
    }
    const type = this.terrainAt(cell);
    // Open ground only. Rock has to be quarried and a wood has to be felled
    // before anybody digs through it, which are decisions the player has already
    // learned to make.
    if (type !== 'grass' && type !== 'meadow') {
      return false;
    }
    if (this.trees.has(cell) || this.roads.hasAt(cell) || this.buildings.getAt(cell) !== null) {
      return false;
    }
    if (this.piles.anyAt(cell) !== null) {
      return false;
    }
    return this.touchesWater(cell);
  }

  /** `true` when the river or a channel runs alongside this cell. */
  public touchesWater(cell: GridPoint): boolean {
    // Four-sided rather than eight: water flows along a channel, and a ditch
    // joined to the river only at a corner would read as two separate ditches.
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const beside = { gx: cell.gx + dx, gy: cell.gy + dy };
      if (!this.terrain.contains(beside.gx, beside.gy)) {
        continue;
      }
      if (WET_TERRAIN.includes(this.terrainAt(beside))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Lets the water in, and re-costs the cell.
   *
   * @returns `true` when a channel was actually cut
   */
  public digDitch(cell: GridPoint): boolean {
    if (!this.canDig(cell)) {
      return false;
    }
    this.terrain.set(cell.gx, cell.gy, 'ditch');
    this.navigation.refreshCell(this.terrain, cell.gx, cell.gy);
    return true;
  }

  /**
   * Fills a channel in again, giving back the ground.
   *
   * Immediate, like taking up a road: it is the player correcting a line they no
   * longer want, and making them wait for somebody to come and shovel it would
   * be ceremony rather than a decision. A channel with a bridge over it stays —
   * pull the bridge down first.
   */
  public fillDitch(cell: GridPoint): boolean {
    if (this.terrainAt(cell) !== 'ditch' || this.buildings.getAt(cell) !== null) {
      return false;
    }
    this.terrain.set(cell.gx, cell.gy, 'grass');
    this.navigation.refreshCell(this.terrain, cell.gx, cell.gy);
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
