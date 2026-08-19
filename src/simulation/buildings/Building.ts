/**
 * A building, from the moment it is placed to the day it stands finished.
 *
 * There is deliberately no separate "construction site" class. A site *is* the
 * building, in its `underConstruction` state — which means completing it is a
 * state change rather than a swap, and nothing has to re-point at a new object
 * when the roof goes on.
 *
 * Materials are held in a real {@link Inventory}, so delivering to a site uses
 * exactly the same hauling machinery as delivering to a storage yard. The brief
 * requires villagers to physically deliver construction materials, and reusing
 * the transfer path is what makes that true rather than merely claimed.
 */

import { buildingDefinition, type BuildingDefinition, type BuildingId } from '@/data/buildings';
import type { ResourceId } from '@/data/resources';
import type { GridPoint } from '@/shared/types/geometry';
import { Inventory } from '@/simulation/resources/Inventory';

export type BuildingState = 'underConstruction' | 'complete';

export class Building {
  public readonly id: number;
  public readonly definition: BuildingDefinition;
  /** Origin cell: the top-left of the footprint in grid space. */
  public readonly origin: GridPoint;
  public state: BuildingState = 'underConstruction';
  /** Materials delivered so far, while under construction. */
  public readonly materials: Inventory;
  /** Ticks of labour still needed once materials are complete. */
  public buildTicksRemaining: number;
  /**
   * Villagers assigned to work here.
   *
   * A cache of the villagers' own `employerId`, rebuilt by the employment
   * system each pass. Two places holding the same truth is a bug waiting for a
   * death or a save to expose it, so only one of them is authoritative and it
   * is the villager.
   */
  public readonly workers: number[] = [];

  /**
   * How many workers the player wants here, from 0 to `workerSlots`.
   *
   * The lever the settlement was missing. A village that is starving does not
   * need three people splitting firewood, and until this existed there was no
   * way to say so — every slot was filled by whoever happened to be nearest.
   *
   * Starts full, because the ordinary case is "I built it, staff it".
   */
  public desiredWorkers: number;
  /**
   * The storage this building opened, once finished, or `null`.
   *
   * Recorded so opening one is idempotent: the settlement can reconcile
   * buildings against storages every tick without ever opening a second yard
   * for the same building, however the building came to be finished.
   */
  public storageId: number | null = null;
  /**
   * `true` while this building is alight.
   *
   * A fire is a whole day long, so the player sees it happen rather than reading
   * about it afterwards — and there is nothing to do about it in that moment,
   * because the decision that settles it was made seasons ago when they put a
   * well up or did not. See `events/FireSystem.ts`.
   */
  public burning = false;

  /**
   * `true` once this building's one improvement has been built.
   *
   * A house with a stone hearth burns markedly less firewood; see
   * `BuildingDefinition.upgrade`.
   */
  public improved = false;

  /**
   * `true` while that improvement is being built.
   *
   * The building goes back to `underConstruction` for the duration, which is what
   * makes an upgrade use the whole of the machinery that already exists —
   * materials hauled by hand, labour spent on site, a progress bar. The one thing
   * that does *not* follow from the state is the family: they go on living there
   * while the masons work, because putting a household into the snow to give them
   * a warmer hearth would be a bitter joke.
   */
  public upgrading = false;

  /**
   * Recipe inputs delivered here.
   *
   * A woodcutter cannot split logs it does not have, and those logs have to be
   * physically carried in — the same rule as construction materials.
   */
  public readonly input = new Inventory(40);

  constructor(id: number, buildingId: BuildingId, origin: GridPoint) {
    this.id = id;
    this.definition = buildingDefinition(buildingId);
    this.origin = origin;
    this.buildTicksRemaining = this.definition.buildTicks;
    this.desiredWorkers = this.definition.workerSlots;
    this.accessCell = {
      gx: origin.gx + Math.floor(this.definition.footprint.width / 2),
      gy: origin.gy + Math.floor(this.definition.footprint.height / 2),
    };

    const required = this.definition.constructionCost.reduce(
      (total, cost) => total + cost.amount,
      0,
    );
    this.materials = new Inventory(required);
  }

  public get isComplete(): boolean {
    return this.state === 'complete';
  }

  /** How many posts the building is actually offering, clamped to its slots. */
  public get hiringTarget(): number {
    return Math.max(0, Math.min(this.definition.workerSlots, this.desiredWorkers));
  }

  /**
   * The cell haulers and builders walk to.
   *
   * A doorway, not the middle of the floor. This used to return the centre of
   * the footprint, which is inside the building — and since finishing a
   * building blocks every cell it occupies, every completed workshop and yard
   * walled off its own delivery point. Haulers would walk up, fail to arrive,
   * drop the job and pick it up again forever, so a Food Storage the player
   * built could never receive a single crate.
   *
   * Set by the registry, which has the navigation grid needed to find a cell
   * that is actually standable. The footprint centre remains only as the
   * fallback for a building with no reachable neighbour at all.
   */
  public accessCell: GridPoint;

  /** Every cell this building occupies. */
  public cells(): GridPoint[] {
    const cells: GridPoint[] = [];
    for (let dy = 0; dy < this.definition.footprint.height; dy += 1) {
      for (let dx = 0; dx < this.definition.footprint.width; dx += 1) {
        cells.push({ gx: this.origin.gx + dx, gy: this.origin.gy + dy });
      }
    }
    return cells;
  }

  /**
   * What this building is owed right now.
   *
   * Its construction cost while it is going up, and its upgrade's cost while that
   * is being built. One indirection rather than a second inventory and a second
   * set of haul rules — every part of the delivery machinery asks this question
   * and none of them has to know which kind of work is in hand.
   */
  public requiredMaterials(): readonly {
    readonly resource: ResourceId;
    readonly amount: number;
  }[] {
    if (this.upgrading && this.definition.upgrade) {
      return this.definition.upgrade.cost;
    }
    return this.definition.constructionCost;
  }

  /** How much of a material is still needed on site. */
  public stillNeeds(resource: ResourceId): number {
    const cost = this.requiredMaterials().find((entry) => entry.resource === resource);
    if (!cost) {
      return 0;
    }
    return Math.max(0, cost.amount - this.materials.count(resource));
  }

  /** `true` when every material has arrived and building can begin. */
  public get hasAllMaterials(): boolean {
    return this.requiredMaterials().every(
      (cost) => this.materials.count(cost.resource) >= cost.amount,
    );
  }

  /** Fraction of construction done, for the progress bar. */
  public get progress(): number {
    const total = this.upgrading
      ? (this.definition.upgrade?.buildTicks ?? this.definition.buildTicks)
      : this.definition.buildTicks;
    if (total === 0) {
      return 1;
    }
    return 1 - this.buildTicksRemaining / total;
  }

  /** `true` when the building has a recipe and a free worker slot. */
  public get needsWorker(): boolean {
    return (
      this.isComplete &&
      this.definition.recipeId !== undefined &&
      this.workers.length < this.definition.workerSlots
    );
  }

  /** Marks the building finished. Materials are consumed by the construction. */
  public complete(): void {
    this.state = 'complete';
    this.buildTicksRemaining = 0;
    this.materials.clear();
  }
}
