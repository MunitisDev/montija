/**
 * Every building placed in the settlement, finished or not.
 *
 * Also owns placement validation, because "can this go here?" must give the
 * same answer to the placement ghost and to the command that actually places
 * it. Two implementations would drift, and the player would eventually see a
 * green ghost refuse to become a building.
 */

import { buildingDefinition, type BuildingId } from '@/data/buildings';
import type { GridPoint } from '@/shared/types/geometry';
import type { World } from '@/simulation/world/World';
import { Building } from './Building';

/** Why a placement was refused, so the UI can say something useful. */
export type PlacementRefusal = 'off-map' | 'blocked-terrain' | 'occupied' | 'trees-in-the-way';

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
    const { footprint } = buildingDefinition(buildingId);

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

    return { ok: true };
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
    this.changeVersion += 1;
    return building;
  }

  /**
   * Finishes a building and closes its footprint to traffic.
   *
   * Navigation is updated here rather than at placement, so villagers can reach
   * the site while it is being built.
   */
  public complete(world: World, building: Building): void {
    building.complete();
    for (const cell of building.cells()) {
      world.navigation.block(cell.gx, cell.gy);
    }
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
