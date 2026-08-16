/**
 * Every building placed in the settlement, finished or not.
 *
 * Also owns placement validation, because "can this go here?" must give the
 * same answer to the placement ghost and to the command that actually places
 * it. Two implementations would drift, and the player would eventually see a
 * green ghost refuse to become a building.
 */

import { buildingDefinition, type BuildingId } from '@/data/buildings';
import type { TerrainType } from '@/data/terrain';
import type { GridPoint } from '@/shared/types/geometry';
import type { World } from '@/simulation/world/World';
import { Building } from './Building';

/** Why a placement was refused, so the UI can say something useful. */
export type PlacementRefusal =
  'off-map' | 'blocked-terrain' | 'occupied' | 'trees-in-the-way' | 'needs-rock-face';

export type PlacementCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: PlacementRefusal };

export class BuildingRegistry {
  private readonly byId = new Map<number, Building>();
  private nextId = 1;
  private changeVersion = 0;

  public get all(): Iterable<Building> {
    return this.byId.values();
  }

  public get count(): number {
    return this.byId.size;
  }

  /** Bumped on placement, completion and demolition. */
  public get version(): number {
    return this.changeVersion;
  }

  public getById(id: number): Building | null {
    return this.byId.get(id) ?? null;
  }

  /** The building occupying a cell, if any. */
  public getAt(cell: GridPoint): Building | null {
    for (const building of this.byId.values()) {
      const { width, height } = building.definition.footprint;
      if (
        cell.gx >= building.origin.gx &&
        cell.gy >= building.origin.gy &&
        cell.gx < building.origin.gx + width &&
        cell.gy < building.origin.gy + height
      ) {
        return building;
      }
    }
    return null;
  }

  /**
   * Whether a footprint may be placed at an origin.
   *
   * The single source of truth for placement, used by both the ghost and the
   * command. Trees are a refusal rather than an automatic clearance: the player
   * should fell them deliberately, and the resulting logs are worth having.
   */
  public canPlace(world: World, buildingId: BuildingId, origin: GridPoint): PlacementCheck {
    const definition = buildingDefinition(buildingId);
    const { footprint } = definition;

    for (let dy = 0; dy < footprint.height; dy += 1) {
      for (let dx = 0; dx < footprint.width; dx += 1) {
        const cell = { gx: origin.gx + dx, gy: origin.gy + dy };

        if (!world.terrain.contains(cell.gx, cell.gy)) {
          return { ok: false, reason: 'off-map' };
        }
        if (world.trees.has(cell)) {
          return { ok: false, reason: 'trees-in-the-way' };
        }
        if (!world.isBuildable(cell)) {
          return { ok: false, reason: 'blocked-terrain' };
        }
        if (this.getAt(cell)) {
          return { ok: false, reason: 'occupied' };
        }
      }
    }

    // A quarry has to bite into a rock face, and a mine into a hillside. The
    // footprint itself must still be ordinary buildable ground — people have to
    // stand somewhere — so what is required is that the working face is next to
    // it, which is also the rule that makes both buildings a decision about
    // *where* rather than merely about *whether*.
    if (definition.adjacentTo && !this.touches(world, origin, footprint, definition.adjacentTo)) {
      return { ok: false, reason: 'needs-rock-face' };
    }

    return { ok: true };
  }

  /** `true` when any cell bordering the footprint is of the given terrain. */
  private touches(
    world: World,
    origin: GridPoint,
    footprint: { width: number; height: number },
    terrain: TerrainType,
  ): boolean {
    for (let dy = -1; dy <= footprint.height; dy += 1) {
      for (let dx = -1; dx <= footprint.width; dx += 1) {
        const inside = dx >= 0 && dy >= 0 && dx < footprint.width && dy < footprint.height;
        if (inside) {
          continue;
        }
        const cell = { gx: origin.gx + dx, gy: origin.gy + dy };
        if (world.terrain.contains(cell.gx, cell.gy) && world.terrainAt(cell) === terrain) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Places a building as a construction site.
   *
   * The site stays **walkable** until it is finished. Blocking the footprint at
   * placement time seemed tidier, but it means a site can be sealed off by its
   * own footprint — the delivery point sits inside the building, so materials
   * could never reach it. Villagers walk onto the site to build it, and the
   * walls only exist once there are walls.
   */
  public place(world: World, buildingId: BuildingId, origin: GridPoint): Building | null {
    if (!this.canPlace(world, buildingId, origin).ok) {
      return null;
    }

    const building = new Building(this.nextId, buildingId, origin);
    this.nextId += 1;
    this.byId.set(building.id, building);
    building.accessCell = findAccessCell(world, building);
    this.changeVersion += 1;
    return building;
  }

  /**
   * Finishes a building and closes its footprint to traffic.
   *
   * Navigation is updated here rather than at placement, so villagers can reach
   * the site while it is being built.
   */
  /**
   * Called the moment a building is finished.
   *
   * The registry is the only place that knows a wall went up, and the
   * chronicle is the only thing that cares afterwards. A callback rather than
   * a counter here, because "how many were ever raised" is not this class's
   * question — it stops caring the moment the building exists.
   */
  public onCompleted: ((building: Building) => void) | null = null;

  public complete(world: World, building: Building): void {
    building.complete();
    this.onCompleted?.(building);
    for (const cell of building.cells()) {
      world.navigation.block(cell.gx, cell.gy);
    }
    // Recomputed now the walls exist: the doorway chosen at placement may have
    // been a cell this very building has just closed.
    building.accessCell = findAccessCell(world, building);
    this.changeVersion += 1;
  }

  /**
   * Takes a building off the map and gives the ground back.
   *
   * Unblocking the navigation grid is the part that matters and the part that
   * is easy to forget: a demolished building whose cells stay blocked leaves a
   * hole in the map that nothing can walk through and nothing can explain.
   * Rebuilt from the terrain rather than simply cleared, so a cell that was
   * *also* forest or road goes back to being forest or road.
   */
  public demolish(world: World, buildingId: number): Building | null {
    const building = this.byId.get(buildingId);
    if (!building) {
      return null;
    }

    this.byId.delete(buildingId);
    for (const cell of building.cells()) {
      world.navigation.refreshCell(world.terrain, cell.gx, cell.gy);
    }
    this.changeVersion += 1;
    return building;
  }

  /** Removes every building. Used before restoring a save. */
  public clear(): void {
    this.byId.clear();
    this.nextId = 1;
    this.changeVersion += 1;
  }

  /** Re-adds a building from a save, preserving its id. */
  public restoreOne(building: Building): void {
    this.byId.set(building.id, building);
    this.nextId = Math.max(this.nextId, building.id + 1);
    this.changeVersion += 1;
  }

  public markChanged(): void {
    this.changeVersion += 1;
  }

  /** Sites still waiting for materials or labour. */
  public underConstruction(): Building[] {
    return [...this.byId.values()].filter((building) => !building.isComplete);
  }

  public countOf(buildingId: BuildingId, completeOnly = true): number {
    let total = 0;
    for (const building of this.byId.values()) {
      if (building.definition.id === buildingId && (!completeOnly || building.isComplete)) {
        total += 1;
      }
    }
    return total;
  }

  /** Total housing across finished houses. */
  public get housingCapacity(): number {
    let total = 0;
    for (const building of this.byId.values()) {
      if (building.isComplete) {
        total += building.definition.housing ?? 0;
      }
    }
    return total;
  }
}

/**
 * A standable cell from which to work on a building.
 *
 * Walks the ring immediately around the footprint in a fixed order, so the
 * choice is reproducible, and falls back to the footprint centre when the
 * building is walled in — at which point nothing can reach it anyway, and a
 * wrong-but-defined answer beats an undefined one.
 */
export function findAccessCell(world: World, building: Building): GridPoint {
  const { footprint } = building.definition;
  const { gx, gy } = building.origin;

  for (let x = gx - 1; x <= gx + footprint.width; x += 1) {
    for (let y = gy - 1; y <= gy + footprint.height; y += 1) {
      const insideFootprint =
        x >= gx && x < gx + footprint.width && y >= gy && y < gy + footprint.height;
      if (insideFootprint) {
        continue;
      }
      if (world.navigation.isWalkable(x, y)) {
        return { gx: x, gy: y };
      }
    }
  }

  return {
    gx: gx + Math.floor(footprint.width / 2),
    gy: gy + Math.floor(footprint.height / 2),
  };
}
