/**
 * Composition root for a running game session.
 *
 * `Game` owns the authoritative pieces — simulation, clock, camera state — and
 * exposes them to the presentation layer through {@link GameContext}. Phaser is
 * created around this object, never the other way round: the renderer can be
 * torn down and rebuilt without the simulation noticing.
 *
 * The frame loop is driven by Phaser (it already owns a rAF loop), but what a
 * frame *means* is decided here.
 */

import {
  CAMERA_FEEL,
  randomWorldSeed,
  INITIAL_ZOOM,
  MAX_TICKS_PER_ADVANCE,
  STARTING_VILLAGERS,
  TICKS_PER_SECOND,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  ZOOM_LIMITS,
} from '@/app/config';
import { isAlreadySelected } from './selection';
import { CameraController } from '@/renderer/camera/CameraController';
import { FOUNDING_YARD_RADIUS, Simulation, type SimulationSnapshot } from '@/simulation/Simulation';
import { SimulationClock, type SimulationSpeed } from '@/simulation/SimulationClock';
import type { InputIntentSink } from '@/input/types';
import { gridToScene, isInsideGrid, sceneToGrid } from '@/shared/math/isometric';
import type { GridPoint, ScreenPoint } from '@/shared/types/geometry';
import type { TerrainType } from '@/data/terrain';
import { RESOURCE_IDS, type ResourceId } from '@/data/resources';
import { SeededRandom, deriveSeed } from '@/shared/math/random';
import type { BuildingId, ResourceAmount } from '@/data/buildings';
import type { PlacementCheck } from '@/simulation/buildings/BuildingRegistry';
import type { Inventory } from '@/simulation/resources/Inventory';
import type { WorkPreference } from '@/simulation/villagers/Villager';
import { restore, serialise } from '@/simulation/save/serialise';
import {
  AUTOSAVE_SLOT,
  IndexedDbSaveStore,
  MemorySaveStore,
  isPersistenceAvailable,
  type SaveStore,
} from '@/simulation/save/SaveStore';

/** Per-frame statistics surfaced to the HUD and debug overlay. */
export interface FrameStats {
  readonly fps: number;
  readonly tick: number;
  readonly speed: SimulationSpeed;
  readonly ticksLastFrame: number;
  readonly droppedTicks: number;
  readonly zoom: number;
  readonly cameraX: number;
  readonly cameraY: number;
  /** Wall-clock milliseconds spent inside simulation ticks this frame. */
  readonly simulationMs: number;
}

/** A villager the player tapped. */
export interface VillagerSelection {
  readonly id: number;
  readonly name: string;
  readonly age: number;
  readonly activity: string;
  /**
   * The building they work at, or `null` for a labourer.
   *
   * A villager's trade is the building they answer to, so the panel names the
   * building rather than a profession from some parallel list that would have
   * to be kept in step with it.
   */
  readonly employer: BuildingId | null;
}

/** What the player last tapped, resolved to the grid. */
export interface Selection {
  readonly cell: GridPoint;
  readonly terrain: TerrainType;
  readonly walkable: boolean;
  readonly buildable: boolean;
  /** Set when a villager was standing there — they take priority over the tile. */
  readonly villager: VillagerSelection | null;
  /** Set when a tree stands on the tapped cell. */
  readonly treeId: number | null;
  /** `true` when the tapped cell is a stone deposit. */
  readonly isStoneDeposit: boolean;
  /** `true` when the tree or deposit is already marked for work. */
  readonly designated: boolean;
  /** Set when a building stands on the tapped cell. */
  readonly building: BuildingSelection | null;
  /** `true` when a road is already laid here. */
  readonly hasRoad: boolean;
  /** `true` when a road here has been ordered but not yet beaten flat. */
  readonly roadDesignated: boolean;
  /** `true` when this cell would take a road. */
  readonly canPave: boolean;
  /** `true` when a channel already runs here. */
  readonly hasDitch: boolean;
  /** `true` when a channel here has been ordered but not yet dug. */
  readonly ditchDesignated: boolean;
  /** `true` when the water could be led into this cell. */
  readonly canDig: boolean;
  /** `true` when this cell of water could be bridged. */
  readonly canBridge: boolean;
}

/**
 * What the player is told about a building they tapped.
 *
 * A settlement builder in which you can raise a workshop and never ask what it
 * is doing is missing the half of the game that comes after building it. The
 * fields are the questions a player actually asks — is it finished, what is it
 * still waiting for, is anybody working it, and what has it got in store.
 */
export interface BuildingSelection {
  readonly id: number;
  readonly buildingId: BuildingId;
  /**
   * The whole patch of ground this building stands on.
   *
   * Carried on the selection so the marker can outline the building rather than
   * the one cell that happened to be tapped. A player who taps the corner of a
   * three-by-three quarry has selected the quarry, and the game should look like
   * it agrees.
   */
  readonly origin: GridPoint;
  readonly footprint: { readonly width: number; readonly height: number };
  readonly complete: boolean;
  /** Construction progress in `0..1`; `1` once finished. */
  readonly progress: number;
  /** Materials still owed, so an idle site explains itself. */
  readonly missingMaterials: readonly ResourceAmount[];
  /** Villagers working here, against the posts available. */
  readonly workers: number;
  readonly workerSlots: number;
  /** How many the player has asked for, which may exceed who has turned up. */
  readonly desiredWorkers: number;
  /** What the building is holding: recipe inputs, or a yard's stock. */
  readonly contents: readonly ResourceAmount[];
  /** How many people it houses, for a completed house. */
  readonly housing: number;
  /** Residents living here, for a completed house. */
  readonly residents: number;
  /** `true` when this building is already waiting to be pulled down. */
  readonly demolitionOrdered: boolean;
}

/** What the presentation layer is allowed to see. */
export interface GameContext {
  readonly simulation: Simulation;
  /** Increments when the settlement is replaced, so renderers rebuild. */
  readonly worldVersion: number;
  /** Abandons the current settlement and founds another. */
  startNewSettlement(seed?: number): void;
  readonly clock: SimulationClock;
  readonly camera: CameraController;
  readonly input: InputIntentSink;
  advance(deltaMilliseconds: number): void;
  /**
   * A random number for presentation only — weather, flicker, drift.
   *
   * Seeded and kept apart from every simulation stream on purpose. Snowflakes
   * must never be able to shift where a villager walks, and a settlement's
   * history has to stay reproducible from its seed however much snow fell.
   */
  presentationRandom(): number;
  stats(): FrameStats;
  snapshot(): SimulationSnapshot;
  /** The current selection, or `null` when nothing is selected. */
  readonly selection: Selection | null;
  /** Progress through the pending simulation tick, for render interpolation. */
  readonly tickAlpha: number;
  /** Increments whenever the selection changes, so renderers can skip work. */
  readonly selectionVersion: number;
  /** Marks the selected tree for felling. Returns `false` when not possible. */
  designateSelectedTree(): boolean;
  /** Cancels the selected tree's felling order. */
  cancelSelectedDesignation(): boolean;
  /**
   * Lays a road on the selected cell, cancels the order, or lifts the road —
   * whichever the cell's current state calls for.
   */
  toggleSelectedRoad(): boolean;
  toggleSelectedDitch(): boolean;
  bridgeSelectedCell(): boolean;
  /** Changes how many people the selected building should employ. */
  adjustSelectedWorkers(delta: number): boolean;
  /** Orders the selected building pulled down, or takes the order back. */
  toggleSelectedDemolition(): boolean;
  /** What the trading post has been told to swap. Nulls mean "you decide". */
  readonly tradeOrder: { sell: ResourceId | null; buy: ResourceId | null };
  /** Steps the sell or buy choice on to the next good, or back to automatic. */
  cycleTradeChoice(side: 'sell' | 'buy'): void;
  /**
   * Posts a villager to a building, keeps them a labourer, or hands them back
   * to automatic employment.
   *
   * Quotas say how many people a workshop should have; this says who.
   */
  setWorkPreference(villagerId: number, preference: WorkPreference): boolean;
  /**
   * Changes how many people a named building should employ.
   *
   * The same command `adjustSelectedWorkers` issues, without needing the
   * building to be the thing the player last tapped — the labour panel changes
   * quotas across the whole settlement without touching the map.
   */
  adjustWorkersAt(buildingId: number, delta: number): boolean;

  /** The building being placed, or `null` when not in placement mode. */
  readonly placement: PlacementState | null;
  /** Increments whenever placement state changes. */
  readonly placementVersion: number;
  beginPlacement(buildingId: BuildingId): void;
  cancelPlacement(): void;
  /** Commits the ghost. Returns `false` when the spot is not valid. */
  confirmPlacement(): boolean;

  save(): Promise<boolean>;
  load(): Promise<boolean>;
  hasSave(): Promise<boolean>;
  /** Human-readable result of the last save or load, for the HUD. */
  readonly saveStatus: string;
  readonly saveVersion: number;
  /**
   * Increments on every successful load, and on nothing else.
   *
   * Distinct from `worldVersion`, which means "a new settlement was founded"
   * and restarts the whole scene. A load replaces the contents of the world in
   * place; the one thing that needs to know is the ending sheet, which must not
   * replay the arrival of a settlement that was already rescued when it was
   * saved.
   */
  readonly loadVersion: number;
}

/** Where the placement ghost is and whether it may be committed. */
export interface PlacementState {
  readonly buildingId: BuildingId;
  readonly origin: GridPoint;
  readonly check: PlacementCheck;
}

/** Ticks between autosaves. 3,000 is five in-game days. */
const AUTOSAVE_INTERVAL_TICKS = 3000;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function describeFailure(kind: string): string {
  switch (kind) {
    case 'missing':
      return 'No saved settlement';
    case 'unsupported-version':
      return 'Save is from another version';
    default:
      return 'Save is unreadable';
  }
}

export interface GameOptions {
  readonly seed?: number;
  /** Founding population. Overridden only for benchmarking. */
  readonly startingVillagers?: number;
}

export class Game implements GameContext, InputIntentSink {
  /**
   * Not readonly: starting again replaces the settlement in place.
   *
   * Keeping the same Game — and the same GameContext the renderer, HUD and
   * input controllers all hold — means a restart swaps one object rather than
   * rewiring the whole application.
   */
  public simulation: Simulation;
  public readonly clock: SimulationClock;
  public readonly camera: CameraController;

  private lastFrameFps = 0;
  private ticksLastFrame = 0;
  private simulationMs = 0;
  private currentSelection: Selection | null = null;
  private selectionChanges = 0;
  private currentPlacement: PlacementState | null = null;
  private placementChanges = 0;
  private readonly saveStore: SaveStore;
  private lastSaveStatus = '';
  private saveStatusChanges = 0;
  /** Ticks until the next autosave. */
  private ticksUntilAutosave = AUTOSAVE_INTERVAL_TICKS;
  /** Randomness for the renderer, deliberately outside the simulation. */
  private readonly presentationRng: SeededRandom;
  /** The seed the current settlement was founded from. */
  private currentSeed: number;
  /** Founding population, so beginning again founds the same size of village. */
  private readonly startingVillagers: number;
  /** Bumped when the world is replaced, so the renderer knows to rebuild. */
  private worldGeneration = 0;
  private loadsCompleted = 0;

  /**
   * Founds a new settlement, discarding the current one.
   *
   * The Game object survives, so the renderer, HUD and input controllers keep
   * the same GameContext they were given — only the world beneath it changes.
   * Selections and placements are dropped because they refer to things that no
   * longer exist.
   */
  public startNewSettlement(seed?: number): void {
    // A new valley rather than the next one along: stepping the seed by one made
    // "begin again" feel like a level select, and two adjacent seeds produce
    // worlds no more alike than any other pair anyway.
    this.currentSeed = seed ?? randomWorldSeed();
    this.simulation = Game.foundSettlement(this.currentSeed, this.startingVillagers);
    this.worldGeneration += 1;

    this.clock.restore(0, 1);
    this.currentSelection = null;
    this.selectionChanges += 1;
    this.currentPlacement = null;
    this.placementChanges += 1;
    this.ticksUntilAutosave = AUTOSAVE_INTERVAL_TICKS;
    // On the camp rather than the middle of the map. The first thing the player
    // should see is their own people, not an empty acre of the interior with
    // nobody in it.
    this.camera.centreOn(gridToScene(this.simulation.world.landfallCell));
  }

  /** Increments whenever the world is replaced. */
  public get worldVersion(): number {
    return this.worldGeneration;
  }

  private static foundSettlement(seed: number, startingVillagers: number): Simulation {
    return new Simulation({
      seed,
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
      startingVillagers,
    });
  }

  constructor(options: GameOptions = {}) {
    const seed = options.seed ?? randomWorldSeed();
    this.currentSeed = seed;
    this.startingVillagers = options.startingVillagers ?? STARTING_VILLAGERS;

    this.simulation = Game.foundSettlement(seed, this.startingVillagers);
    // Falls back to memory when the browser has no IndexedDB, so the game runs
    // rather than crashing; saves simply do not survive a refresh.
    this.presentationRng = new SeededRandom(deriveSeed(seed, 'presentation'));
    this.saveStore = isPersistenceAvailable() ? new IndexedDbSaveStore() : new MemorySaveStore();

    this.clock = new SimulationClock({
      ticksPerSecond: TICKS_PER_SECOND,
      maxTicksPerAdvance: MAX_TICKS_PER_ADVANCE,
    });

    // Camera bounds come from the world's projected extent, so the map edge is
    // the camera limit — no hand-tuned numbers to drift out of sync.
    this.camera = new CameraController({
      limits: {
        minZoom: ZOOM_LIMITS.min,
        maxZoom: ZOOM_LIMITS.max,
        bounds: this.simulation.world.sceneBounds,
      },
      feel: CAMERA_FEEL,
      initialZoom: INITIAL_ZOOM,
      // Where the settlers made camp, not the middle of the map.
      initialCentre: gridToScene(this.simulation.world.landfallCell),
    });
  }

  public get input(): InputIntentSink {
    return this;
  }

  public get selection(): Selection | null {
    return this.currentSelection;
  }

  public get selectionVersion(): number {
    return this.selectionChanges;
  }

  public get placement(): PlacementState | null {
    return this.currentPlacement;
  }

  public get placementVersion(): number {
    return this.placementChanges;
  }

  /**
   * Enters placement mode, with the ghost in the middle of the view.
   *
   * Starting it centred rather than under the finger matters on touch: the
   * player then drags the *camera* to position the ghost, so the building is
   * never hidden beneath their own hand.
   */
  public beginPlacement(buildingId: BuildingId): void {
    // Kill any drift already in flight, or the ghost starts sliding the moment
    // it appears.
    this.camera.stopMotion();
    this.currentPlacement = this.describePlacement(buildingId, this.viewCentreCell());
    this.placementChanges += 1;
  }

  public cancelPlacement(): void {
    this.currentPlacement = null;
    this.placementChanges += 1;
  }

  public confirmPlacement(): boolean {
    const placement = this.currentPlacement;
    if (!placement || !placement.check.ok) {
      return false;
    }

    const placed = this.simulation.placeBuilding(placement.buildingId, placement.origin);
    if (!placed) {
      return false;
    }

    this.currentPlacement = null;
    this.placementChanges += 1;
    return true;
  }

  /** Keeps the ghost under the middle of the view as the camera moves. */
  public updatePlacementGhost(): void {
    const placement = this.currentPlacement;
    if (!placement) {
      return;
    }

    const origin = this.viewCentreCell();
    if (origin.gx === placement.origin.gx && origin.gy === placement.origin.gy) {
      return;
    }

    this.currentPlacement = this.describePlacement(placement.buildingId, origin);
    this.placementChanges += 1;
  }

  private describePlacement(buildingId: BuildingId, origin: GridPoint): PlacementState {
    return { buildingId, origin, check: this.simulation.canPlaceBuilding(buildingId, origin) };
  }

  /** The grid cell at the centre of the viewport. */
  private viewCentreCell(): GridPoint {
    const view = this.camera.view;
    return sceneToGrid({ px: view.centreX, py: view.centreY });
  }

  public get tickAlpha(): number {
    // Paused, nothing is in flight, so snap to the settled position rather
    // than freezing mid-stride between two cells.
    return this.clock.isPaused ? 1 : this.clock.tickAlpha;
  }

  /**
   * Runs one rendered frame's worth of game time.
   *
   * Order matters: the simulation steps first so the camera and renderer always
   * present state that has already settled for this frame.
   */
  public presentationRandom(): number {
    return this.presentationRng.next();
  }

  public advance(deltaMilliseconds: number): void {
    const deltaSeconds = Math.min(deltaMilliseconds, 250) / 1000;
    this.lastFrameFps = deltaSeconds > 0 ? 1 / deltaSeconds : 0;

    const startedAt = performance.now();
    this.ticksLastFrame = this.clock.advance(deltaSeconds, (tick, tickSeconds) => {
      this.simulation.update(tick, tickSeconds);
    });
    this.simulationMs = performance.now() - startedAt;

    this.camera.update(deltaSeconds);
    this.updatePlacementGhost();

    if (this.ticksLastFrame > 0) {
      this.ticksUntilAutosave -= this.ticksLastFrame;
      if (this.ticksUntilAutosave <= 0) {
        this.ticksUntilAutosave = AUTOSAVE_INTERVAL_TICKS;
        // Fire and forget: a slow disk must never stall a frame.
        void this.save();
      }
    }
  }

  public get saveStatus(): string {
    return this.lastSaveStatus;
  }

  public get loadVersion(): number {
    return this.loadsCompleted;
  }

  public get saveVersion(): number {
    return this.saveStatusChanges;
  }

  /** Writes the settlement to the autosave slot. */
  public async save(): Promise<boolean> {
    try {
      await this.saveStore.write(
        AUTOSAVE_SLOT,
        serialise(this.simulation, new Date().toISOString()),
      );
      this.setSaveStatus('Saved');
      return true;
    } catch (error) {
      this.setSaveStatus(`Save failed: ${describeError(error)}`);
      return false;
    }
  }

  /**
   * Loads the autosave over the running settlement.
   *
   * The renderer is not told anything special: every renderer syncs off a
   * version counter, and restoring bumps all of them, so the world redraws
   * itself on the next frame.
   */
  public async load(): Promise<boolean> {
    try {
      const result = await this.saveStore.read(AUTOSAVE_SLOT);
      if (!result.ok) {
        this.setSaveStatus(describeFailure(result.failure.kind));
        return false;
      }

      restore(this.simulation, result.save);
      this.clock.restore(result.save.simulationTime, this.clock.speed);
      this.currentSelection = null;
      this.selectionChanges += 1;
      this.loadsCompleted += 1;
      this.setSaveStatus('Loaded');
      return true;
    } catch (error) {
      this.setSaveStatus(`Load failed: ${describeError(error)}`);
      return false;
    }
  }

  public hasSave(): Promise<boolean> {
    return this.saveStore.has(AUTOSAVE_SLOT).catch(() => false);
  }

  private setSaveStatus(status: string): void {
    this.lastSaveStatus = status;
    this.saveStatusChanges += 1;
  }

  public stats(): FrameStats {
    const view = this.camera.view;
    return {
      fps: this.lastFrameFps,
      tick: this.clock.tick,
      speed: this.clock.speed,
      ticksLastFrame: this.ticksLastFrame,
      droppedTicks: this.clock.droppedTickCount,
      zoom: view.zoom,
      cameraX: view.centreX,
      cameraY: view.centreY,
      simulationMs: this.simulationMs,
    };
  }

  public snapshot(): SimulationSnapshot {
    return this.simulation.snapshot();
  }

  /**
   * Resolves a viewport position to a grid cell.
   *
   * The full chain, each step owned by exactly one subsystem:
   * viewport → (camera) → scene → (isometric) → world → grid.
   *
   * @returns the cell, or `null` when the point falls outside the map
   */
  public screenToGrid(point: ScreenPoint): GridPoint | null {
    const cell = sceneToGrid(this.camera.viewportToScene(point));
    if (!isInsideGrid(cell, this.simulation.world.width, this.simulation.world.height)) {
      return null;
    }
    return cell;
  }

  // --- InputIntentSink -----------------------------------------------------

  public onGestureStart(): void {
    this.camera.stopMotion();
  }

  public onPan(deltaScreenX: number, deltaScreenY: number): void {
    this.camera.panByScreenDelta(deltaScreenX, deltaScreenY);
  }

  public onPanEnd(velocityScreenX: number, velocityScreenY: number): void {
    // No inertia while aiming a building. Coasting after the finger lifts moved
    // the ghost a couple of cells past where the player had aimed it, so the
    // building landed somewhere they had not chosen. Exploring the map wants
    // momentum; aiming does not.
    if (this.currentPlacement) {
      this.camera.stopMotion();
      return;
    }
    this.camera.flick(velocityScreenX, velocityScreenY);
  }

  public onZoom(factor: number, anchor: ScreenPoint): void {
    this.camera.zoomBy(factor, anchor);
  }

  public onSelect(point: ScreenPoint): void {
    // **A tap while placing means "never mind".** The ghost is framed with the
    // camera, so a tap has no other job during placement — and tapping the map
    // to get rid of it is what a player reaches for before finding the Cancel
    // button. A drag is not a tap and still just moves the camera.
    if (this.currentPlacement) {
      this.cancelPlacement();
      return;
    }

    const cell = this.screenToGrid(point);

    if (!cell) {
      // Tapping off-map clears the selection rather than leaving a stale one.
      this.currentSelection = null;
      this.selectionChanges += 1;
      return;
    }

    // Tapping what is already selected puts the panel away. Checked before the
    // villager lookup so that tapping a building twice closes it even if
    // somebody has since walked across its doorstep.
    const standing = this.simulation.world.buildings.getAt(cell);
    if (isAlreadySelected(this.currentSelection, cell, standing?.id ?? null)) {
      this.currentSelection = null;
      this.selectionChanges += 1;
      return;
    }

    // A villager standing on the tapped tile is almost always what the player
    // meant, so they win over the ground beneath them.
    const villager = this.simulation.villagers.findNear(cell);

    this.currentSelection = this.describeCell(
      cell,
      villager
        ? {
            id: villager.id,
            name: villager.name,
            age: villager.age,
            activity: villager.activity,
            employer: this.employerOf(villager.employerId),
          }
        : null,
    );
    this.selectionChanges += 1;
  }

  /** Builds the description of a cell. One place, so the two callers agree. */
  private describeCell(cell: GridPoint, villager: VillagerSelection | null): Selection {
    const world = this.simulation.world;
    const tree = world.trees.getAt(cell);
    const isStoneDeposit = world.terrainAt(cell) === 'stone';

    return {
      building: this.describeBuilding(cell),
      cell,
      terrain: world.terrainAt(cell),
      walkable: world.isWalkable(cell),
      buildable: world.isBuildable(cell),
      villager,
      treeId: tree?.id ?? null,
      isStoneDeposit,
      designated: tree
        ? this.simulation.isTreeDesignated(cell)
        : isStoneDeposit && this.simulation.isStoneDesignated(cell),
      hasRoad: this.simulation.hasRoad(cell),
      roadDesignated: this.simulation.isRoadDesignated(cell),
      canPave: this.simulation.world.canPave(cell),
      hasDitch: this.simulation.hasDitch(cell),
      ditchDesignated: this.simulation.isDitchDesignated(cell),
      canDig: this.simulation.world.canDig(cell),
      canBridge: this.simulation.canPlaceBuilding('bridge', cell).ok,
    };
  }

  /** Everything worth saying about the building on a cell, if there is one. */
  private describeBuilding(cell: GridPoint): BuildingSelection | null {
    const building = this.simulation.world.buildings.getAt(cell);
    if (!building) {
      return this.describeFoundingYard(cell);
    }

    const definition = building.definition;
    const missingMaterials = definition.constructionCost
      .map((cost) => ({ resource: cost.resource, amount: building.stillNeeds(cost.resource) }))
      .filter((entry) => entry.amount > 0);

    // A site's progress is the labour left, not the materials: materials are
    // reported separately because "waiting for stone" and "half built" are
    // different problems with different answers.
    const progress = building.isComplete
      ? 1
      : 1 - building.buildTicksRemaining / Math.max(1, definition.buildTicks);

    const store = building.isComplete
      ? (this.storageContents(building.storageId) ?? inventoryAmounts(building.input))
      : inventoryAmounts(building.materials);

    return {
      id: building.id,
      buildingId: definition.id,
      origin: building.origin,
      footprint: definition.footprint,
      complete: building.isComplete,
      progress,
      missingMaterials,
      workers: building.workers.length,
      workerSlots: definition.workerSlots,
      desiredWorkers: building.desiredWorkers,
      contents: store,
      housing: definition.housing ?? 0,
      residents: this.simulation.villagers.all.filter((villager) => villager.homeId === building.id)
        .length,
      demolitionOrdered: this.simulation.isDemolitionOrdered(building.id),
    };
  }

  /**
   * The settlers' own yard, which has no building behind it.
   *
   * It is the most prominent thing on screen when the game begins, and tapping
   * it said nothing at all — the one structure a new player is most likely to
   * ask about was the one the panel could not answer for. Described here rather
   * than given a Building of its own, because it genuinely is not one: nobody
   * constructed it and nothing can demolish it.
   */
  private describeFoundingYard(cell: GridPoint): BuildingSelection | null {
    const yard = this.simulation.storages.all.find(
      (storage) =>
        storage.ownerBuildingId === null &&
        Math.abs(storage.cell.gx - cell.gx) <= FOUNDING_YARD_RADIUS &&
        Math.abs(storage.cell.gy - cell.gy) <= FOUNDING_YARD_RADIUS,
    );
    if (!yard) {
      return null;
    }

    const span = FOUNDING_YARD_RADIUS * 2 + 1;
    return {
      id: yard.id,
      buildingId: 'storage-yard',
      // Recorded as a point and standing three across, so the outline is built
      // back out from its centre rather than read off a footprint it has not got.
      origin: { gx: yard.cell.gx - FOUNDING_YARD_RADIUS, gy: yard.cell.gy - FOUNDING_YARD_RADIUS },
      footprint: { width: span, height: span },
      complete: true,
      progress: 1,
      missingMaterials: [],
      workers: 0,
      workerSlots: 0,
      desiredWorkers: 0,
      contents: inventoryAmounts(yard.inventory),
      housing: 0,
      residents: 0,
      // The founding yard has no Building behind it, so there is nothing to
      // pull down — and it is the settlement's only store on day one, which
      // makes offering to demolish it a trap rather than a choice.
      demolitionOrdered: false,
    };
  }

  /** What kind of building a villager works at, if any. */
  private employerOf(buildingId: number | null): BuildingId | null {
    if (buildingId === null) {
      return null;
    }
    return this.simulation.world.buildings.getById(buildingId)?.definition.id ?? null;
  }

  /** A yard's stock, or `null` when this building opened no yard. */
  private storageContents(storageId: number | null): readonly ResourceAmount[] | null {
    if (storageId === null) {
      return null;
    }
    const storage = this.simulation.storages.getById(storageId);
    return storage ? inventoryAmounts(storage.inventory) : null;
  }

  /**
   * Marks the selected tree for felling.
   *
   * A command: the player states intent, and the simulation decides what
   * happens. The UI never touches the job board directly.
   */
  public designateSelectedTree(): boolean {
    const selection = this.currentSelection;
    if (!selection) {
      return false;
    }

    const created =
      selection.treeId !== null
        ? this.simulation.designateTreeForFelling(selection.cell)
        : selection.isStoneDeposit && this.simulation.designateStoneForMining(selection.cell);

    if (created) {
      this.refreshSelection(selection.cell);
    }
    return created;
  }

  public cancelSelectedDesignation(): boolean {
    const selection = this.currentSelection;
    if (!selection) {
      return false;
    }

    const cancelled =
      selection.treeId !== null
        ? this.simulation.cancelTreeDesignation(selection.cell)
        : selection.isStoneDeposit && this.simulation.cancelStoneDesignation(selection.cell);

    if (cancelled) {
      this.refreshSelection(selection.cell);
    }
    return cancelled;
  }

  /**
   * The road button, which is three commands wearing one hat.
   *
   * A single button rather than three, because the three are mutually exclusive
   * by construction — a cell either has a road, has one ordered, or has neither
   * — and a mobile panel that shows two greyed-out buttons to explain the third
   * is worse than one that simply says what it will do.
   */
  public toggleSelectedRoad(): boolean {
    const selection = this.currentSelection;
    if (!selection) {
      return false;
    }

    const acted = selection.hasRoad
      ? this.simulation.liftRoad(selection.cell)
      : selection.roadDesignated
        ? this.simulation.cancelRoadDesignation(selection.cell)
        : this.simulation.designateRoad(selection.cell);

    if (acted) {
      this.refreshSelection(selection.cell);
    }
    return acted;
  }

  /**
   * The ditch button, which is the road button's twin.
   *
   * Three commands wearing one hat, for the same reason: a cell either has a
   * channel, has one ordered, or could take one, and the three are mutually
   * exclusive by construction.
   */
  public toggleSelectedDitch(): boolean {
    const selection = this.currentSelection;
    if (!selection) {
      return false;
    }

    const acted = selection.hasDitch
      ? this.simulation.fillDitch(selection.cell)
      : selection.ditchDesignated
        ? this.simulation.cancelDitchDesignation(selection.cell)
        : this.simulation.designateDitch(selection.cell);

    if (acted) {
      this.refreshSelection(selection.cell);
    }
    return acted;
  }

  /**
   * Orders a bridge over the selected cell of water.
   *
   * Not a menu building with a ghost: the player has already told the game which
   * square of river they mean by tapping it, and asking them to aim at it a
   * second time with a floating outline would be worse in every way. What follows
   * is an ordinary construction site — five logs hauled out and laid by hand.
   */
  public bridgeSelectedCell(): boolean {
    const selection = this.currentSelection;
    if (!selection) {
      return false;
    }
    const placed = this.simulation.placeBuilding('bridge', selection.cell);
    if (placed) {
      this.refreshSelection(selection.cell);
    }
    return placed !== null;
  }

  /**
   * Turns the selected building's worker quota up or down.
   *
   * The one lever employment gives the player, and the reason it is worth
   * having: a settlement that is starving does not need three people splitting
   * firewood, and until this existed there was no way to say so.
   */
  public adjustWorkersAt(buildingId: number, delta: number): boolean {
    const building = this.simulation.world.buildings.getById(buildingId);
    if (!building) {
      return false;
    }

    const changed = this.simulation.setDesiredWorkers(buildingId, building.desiredWorkers + delta);
    // The selection may be showing this very building, and its panel carries the
    // same figure. Refreshing keeps the two from disagreeing on screen.
    if (changed && this.currentSelection) {
      this.refreshSelection(this.currentSelection.cell);
    }
    return changed;
  }

  public adjustSelectedWorkers(delta: number): boolean {
    const selection = this.currentSelection;
    const building = selection?.building;
    if (!selection || !building || building.workerSlots === 0) {
      return false;
    }

    const changed = this.simulation.setDesiredWorkers(building.id, building.desiredWorkers + delta);
    if (changed) {
      this.refreshSelection(selection.cell);
    }
    return changed;
  }

  /**
   * Orders the selected building pulled down, or cancels that order.
   *
   * Its own undo, like the road button: a second tap takes the order back, so
   * a misplaced tap on a quarry is a mistake the player can simply reverse
   * rather than one they have to live with.
   */
  public toggleSelectedDemolition(): boolean {
    const selection = this.currentSelection;
    const building = selection?.building;
    // The founding yard is described as a building but is not one, and it is
    // the settlement's only store on day one.
    if (!selection || !building || !this.simulation.world.buildings.getById(building.id)) {
      return false;
    }

    const acted = this.simulation.toggleDemolition(building.id);
    if (acted) {
      this.refreshSelection(selection.cell);
    }
    return acted;
  }

  public get tradeOrder(): { sell: ResourceId | null; buy: ResourceId | null } {
    return this.simulation.trading;
  }

  /**
   * Steps one side of the trade on to the next good.
   *
   * A cycler rather than a dropdown: there are eight goods and two choices, and
   * a native select on a phone is a full-screen wheel that covers the very
   * settlement the player is deciding about. Automatic is one of the stops
   * rather than a separate control, so the way back is the same gesture as the
   * way forward.
   */
  /**
   * Posts a villager to a building, keeps them a labourer, or hands them back
   * to automatic employment.
   *
   * A pass-through, deliberately: employment is the simulation's business and
   * the panel's job is to say what the player asked for, not to decide whether
   * it happens.
   */
  public setWorkPreference(villagerId: number, preference: WorkPreference): boolean {
    return this.simulation.setWorkPreference(villagerId, preference);
  }

  public cycleTradeChoice(side: 'sell' | 'buy'): void {
    const options: (ResourceId | null)[] = [null, ...TRADEABLE[side]];
    const current = side === 'sell' ? this.simulation.trading.sell : this.simulation.trading.buy;
    const next = options[(options.indexOf(current) + 1) % options.length] ?? null;

    this.simulation.setTradeOrder(
      side === 'sell'
        ? { sell: next, buy: this.simulation.trading.buy }
        : { sell: this.simulation.trading.sell, buy: next },
    );
    this.selectionChanges += 1;
  }

  /** Re-reads the selected cell after the world changed underneath it. */
  private refreshSelection(cell: GridPoint): void {
    this.currentSelection = this.describeCell(cell, null);
    this.selectionChanges += 1;
  }
}

/**
 * What each side of a trade may be set to.
 *
 * Food and firewood are missing from the sell list because the post will not
 * take them however they are asked — offering the player a choice the game
 * then refuses is worse than not offering it.
 */
const TRADEABLE: Readonly<Record<'sell' | 'buy', readonly ResourceId[]>> = {
  sell: RESOURCE_IDS.filter((resource) => resource !== 'food' && resource !== 'firewood'),
  buy: RESOURCE_IDS,
};

/** An inventory as a plain list, so the UI never touches simulation objects. */
function inventoryAmounts(inventory: Inventory): readonly ResourceAmount[] {
  return inventory.contents.map((entry) => ({
    resource: entry.resource,
    amount: entry.amount,
  }));
}
