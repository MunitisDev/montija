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
  DEFAULT_WORLD_SEED,
  INITIAL_ZOOM,
  MAX_TICKS_PER_ADVANCE,
  STARTING_VILLAGERS,
  TICKS_PER_SECOND,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  ZOOM_LIMITS,
} from '@/app/config';
import { CameraController } from '@/renderer/camera/CameraController';
import { Simulation, type SimulationSnapshot } from '@/simulation/Simulation';
import { SimulationClock, type SimulationSpeed } from '@/simulation/SimulationClock';
import type { InputIntentSink } from '@/input/types';
import { gridToScene, isInsideGrid, sceneToGrid } from '@/shared/math/isometric';
import type { GridPoint, ScreenPoint } from '@/shared/types/geometry';
import type { TerrainType } from '@/data/terrain';

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
}

/** What the player last tapped, resolved to the grid. */
export interface Selection {
  readonly cell: GridPoint;
  readonly terrain: TerrainType;
  readonly walkable: boolean;
  readonly buildable: boolean;
  /** Set when a villager was standing there — they take priority over the tile. */
  readonly villager: VillagerSelection | null;
}

/** What the presentation layer is allowed to see. */
export interface GameContext {
  readonly simulation: Simulation;
  readonly clock: SimulationClock;
  readonly camera: CameraController;
  readonly input: InputIntentSink;
  advance(deltaMilliseconds: number): void;
  stats(): FrameStats;
  snapshot(): SimulationSnapshot;
  /** The current selection, or `null` when nothing is selected. */
  readonly selection: Selection | null;
  /** Progress through the pending simulation tick, for render interpolation. */
  readonly tickAlpha: number;
  /** Increments whenever the selection changes, so renderers can skip work. */
  readonly selectionVersion: number;
}

export interface GameOptions {
  readonly seed?: number;
}

export class Game implements GameContext, InputIntentSink {
  public readonly simulation: Simulation;
  public readonly clock: SimulationClock;
  public readonly camera: CameraController;

  private lastFrameFps = 0;
  private ticksLastFrame = 0;
  private simulationMs = 0;
  private currentSelection: Selection | null = null;
  private selectionChanges = 0;

  constructor(options: GameOptions = {}) {
    const seed = options.seed ?? DEFAULT_WORLD_SEED;

    this.simulation = new Simulation({
      seed,
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
      startingVillagers: STARTING_VILLAGERS,
    });
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
      initialCentre: gridToScene({
        gx: Math.floor(WORLD_WIDTH / 2),
        gy: Math.floor(WORLD_HEIGHT / 2),
      }),
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
  public advance(deltaMilliseconds: number): void {
    const deltaSeconds = Math.min(deltaMilliseconds, 250) / 1000;
    this.lastFrameFps = deltaSeconds > 0 ? 1 / deltaSeconds : 0;

    const startedAt = performance.now();
    this.ticksLastFrame = this.clock.advance(deltaSeconds, (tick, tickSeconds) => {
      this.simulation.update(tick, tickSeconds);
    });
    this.simulationMs = performance.now() - startedAt;

    this.camera.update(deltaSeconds);
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
    this.camera.flick(velocityScreenX, velocityScreenY);
  }

  public onZoom(factor: number, anchor: ScreenPoint): void {
    this.camera.zoomBy(factor, anchor);
  }

  public onSelect(point: ScreenPoint): void {
    const cell = this.screenToGrid(point);
    const world = this.simulation.world;

    if (!cell) {
      // Tapping off-map clears the selection rather than leaving a stale one.
      this.currentSelection = null;
      this.selectionChanges += 1;
      return;
    }

    // A villager standing on the tapped tile is almost always what the player
    // meant, so they win over the ground beneath them.
    const villager = this.simulation.villagers.findNear(cell);

    this.currentSelection = {
      cell,
      terrain: world.terrainAt(cell),
      walkable: world.isWalkable(cell),
      buildable: world.isBuildable(cell),
      villager: villager
        ? {
            id: villager.id,
            name: villager.name,
            age: villager.age,
            activity: villager.activity,
          }
        : null,
    };
    this.selectionChanges += 1;
  }
}
