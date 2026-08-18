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
  | 'off-map'
  | 'blocked-terrain'
  | 'occupied'
  | 'trees-in-the-way'
  | 'needs-rock-face'
  | 'needs-water'
  | 'needs-water-nearby'
  | 'unreachable';

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
        if (this.getAt(cell)) {
          return { ok: false, reason: 'occupied' };
        }
        // A bridge is built *on* the water. Everything else needs ground, and
        // the two rules are exclusive: a definition either names the terrain it
        // stands on or it wants buildable land.
        if (definition.on) {
          if (world.terrainAt(cell) !== definition.on) {
            return { ok: false, reason: 'needs-water' };
          }
          continue;
        }
        if (world.trees.has(cell)) {
          return { ok: false, reason: 'trees-in-the-way' };
        }
        if (!world.isBuildable(cell)) {
          return { ok: false, reason: 'blocked-terrain' };
        }
      }
    }

    // A quarry has to bite into a rock face, and a mine into a hillside. The
    // footprint itself must still be ordinary buildable ground — people have to
    // stand somewhere — so what is required is that the working face is next to
    // it, which is also the rule that makes both buildings a decision about
    // *where* rather than merely about *whether*.
    if (definition.adjacentTo && !this.touches(world, origin, footprint, definition.adjacentTo)) {
      // Which refusal depends on what the building was reaching for. "Must be
      // dug into a rock face" is exactly wrong for an orchard, and a player told
      // that about a fruit tree learns nothing.
      return {
        ok: false,
        reason: definition.adjacentTo.includes('stone') ? 'needs-rock-face' : 'needs-water-nearby',
      };
    }

    // **Nobody can build what nobody can walk to.** The river cuts the map in
    // two, and a warehouse ordered on the far bank is materials carried to a
    // waterline and set down: the site would stand half-built for ever while the
    // player watched villagers refuse it for no visible reason. So the far bank
    // is not off the map — it is behind a bridge, and building one is what opens
    // it. A settlement that has already bridged the river sees no rule here at
    // all, because by then both banks are the same ground.
    if (!this.reachable(world, origin, footprint)) {
      return { ok: false, reason: 'unreachable' };
    }

    return { ok: true };
  }

  /**
   * `true` when somebody standing in the settlement could walk to this plot.
   *
   * Asked of the cells around the footprint rather than of the footprint
   * itself, because a finished building is not walkable — the question is
   * whether its doorway is on the settlement's side of the water.
   */
  private reachable(
    world: World,
    origin: GridPoint,
    footprint: { width: number; height: number },
  ): boolean {
    const heart = world.heartCell;
    for (let dy = -1; dy <= footprint.height; dy += 1) {
      for (let dx = -1; dx <= footprint.width; dx += 1) {
        const cell = { gx: origin.gx + dx, gy: origin.gy + dy };
        if (world.navigation.connects(heart, cell)) {
          return true;
        }
      }
    }
    return false;
  }

  /** `true` when any cell bordering the footprint is one of the given terrains. */
  private touches(
    world: World,
    origin: GridPoint,
    footprint: { width: number; height: number },
    terrain: readonly TerrainType[],
  ): boolean {
    for (let dy = -1; dy <= footprint.height; dy += 1) {
      for (let dx = -1; dx <= footprint.width; dx += 1) {
        const inside = dx >= 0 && dy >= 0 && dx < footprint.width && dy < footprint.height;
        if (inside) {
          continue;
        }
        const cell = { gx: origin.gx + dx, gy: origin.gy + dy };
        if (world.terrain.contains(cell.gx, cell.gy) && terrain.includes(world.terrainAt(cell))) {
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

    // **The ground is cleared for the foundations.** A road under a building is
    // a road nobody can walk on, and leaving it there left a beaten track drawn
    // underneath a wall — visible at the footprint's edges and, worse, still
    // counted by the navigation grid as a road the hauliers could use.
    //
    // Lifted at placement rather than at completion, because that is when the
    // player watches it happen: they put a warehouse across their own path and
    // the path goes, rather than staying for the four days it takes to build and
    // then vanishing for no visible reason.
    for (const cell of building.cells()) {
      world.liftRoad(cell);
    }

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
      if (building.definition.crossing) {
        // **A bridge is a road over the water.** Paving it is the whole of what
        // finishing one does: the navigation grid already knows that boards can
        // be laid over water and not over rock, pathfinding already prefers a
        // road, and the two banks become one patch of ground the moment the last
        // timber goes down.
        world.paveRoad(cell);
      } else {
        world.navigation.block(cell.gx, cell.gy);
      }
    }
    // Recomputed now the walls exist: the doorway chosen at placement may have
    // been a cell this very building has just closed.
    building.accessCell = findAccessCell(world, building);
    this.clearPlot(world, building);
    this.refreshAccessCells(world);
    this.changeVersion += 1;
  }

  /**
   * Shifts anything lying on the plot out to the doorway.
   *
   * A construction site stays walkable while it is being built, so a hauler can
   * quite reasonably set a load down on it — and the day the walls go up, that
   * load is inside them. It was found as food rotting in a settlement whose
   * gatherers were working: the pile was two cells from the yard and no hauler
   * could reach it, for ever, because the cell it stood on had stopped being a
   * place anybody could stand.
   */
  private clearPlot(world: World, building: Building): void {
    const heart = world.heartCell;
    const origin = building.origin;
    const { footprint } = building.definition;

    // The plot itself, and the ring of ground around it. Walls do not only bury
    // what is under them: a corner cell left between two buildings is a place
    // nobody can walk to any more, and whatever was set down there is as lost as
    // if it were inside the wall.
    const stranded = [...world.piles.all].filter((pile) => {
      const near =
        pile.cell.gx >= origin.gx - REACH &&
        pile.cell.gx < origin.gx + footprint.width + REACH &&
        pile.cell.gy >= origin.gy - REACH &&
        pile.cell.gy < origin.gy + footprint.height + REACH;
      return near && !world.navigation.connects(heart, pile.cell);
    });

    for (const pile of stranded) {
      const { resource, amount } = pile;
      world.piles.remove(pile.id);
      world.dropNear(building.accessCell, resource, amount);
    }
  }

  /**
   * Re-finds any doorway that has just been built over.
   *
   * **A settlement was found starving with food piled beside a hut.** A
   * building's doorway is a walkable cell beside it, chosen when it is
   * finished — and the next building raised next door can be standing on it.
   * Nothing noticed: the hut went on dropping its harvest onto a cell inside a
   * neighbour's wall, where no hauler could ever reach it, and the food rotted
   * in plain sight while the ledger said the gatherers were working.
   *
   * Cheap, and only on the two occasions the map's walls change. A settlement
   * has tens of buildings, not thousands.
   */
  private refreshAccessCells(world: World): void {
    const heart = world.heartCell;
    for (const building of this.byId.values()) {
      if (!world.navigation.connects(heart, building.accessCell)) {
        building.accessCell = findAccessCell(world, building);
      }
    }
  }

  /**
   * Takes a building off the map and gives the ground back.
   *
   * Unblocking the navigation grid is the part that matters and the part that
   * is easy to forget: a demolished building whose cells stay blocked leaves a
   * hole in the map that nothing can walk through and nothing can explain.
   * Rebuilt from the terrain rather than simply cleared, so a cell that was
   * *also* forest goes back to being forest.
   *
   * A road that was under it does **not** come back: {@link place} takes it up
   * for the foundations, and pulling a building down does not re-beat a track
   * somebody has to walk before it exists again.
   */
  public demolish(world: World, buildingId: number): Building | null {
    const building = this.byId.get(buildingId);
    if (!building) {
      return null;
    }

    this.byId.delete(buildingId);
    for (const cell of building.cells()) {
      // A crossing pulled down takes its boards with it, or the river would go
      // on being crossable by a bridge that is no longer there.
      if (building.definition.crossing) {
        world.liftRoad(cell);
      }
      world.navigation.refreshCell(world.terrain, cell.gx, cell.gy);
    }
    this.refreshAccessCells(world);
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
/** How far around a new building its builders will shift a stranded load. */
const REACH = 2;

export function findAccessCell(world: World, building: Building): GridPoint {
  const { footprint } = building.definition;
  const { gx, gy } = building.origin;
  const heart = world.heartCell;

  let fallback: GridPoint | null = null;
  for (let x = gx - 1; x <= gx + footprint.width; x += 1) {
    for (let y = gy - 1; y <= gy + footprint.height; y += 1) {
      const insideFootprint =
        x >= gx && x < gx + footprint.width && y >= gy && y < gy + footprint.height;
      if (insideFootprint || !world.navigation.isWalkable(x, y)) {
        continue;
      }
      // **A doorway the settlement can actually walk to.** Any walkable
      // neighbour used to do, and a building packed between two others can
      // easily have one side opening onto a sealed pocket of two cells. Its
      // harvest was then piled somewhere nobody could ever reach — the food was
      // there, the gatherers were working, and the settlement starved.
      if (world.navigation.connects(heart, { gx: x, gy: y })) {
        return { gx: x, gy: y };
      }
      fallback ??= { gx: x, gy: y };
    }
  }

  return (
    fallback ?? {
      gx: gx + Math.floor(footprint.width / 2),
      gy: gy + Math.floor(footprint.height / 2),
    }
  );
}
