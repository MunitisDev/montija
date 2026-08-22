/**
 * The world scene.
 *
 * Drives the frame: advances the game, mirrors the camera controller onto the
 * Phaser camera, and keeps the selection marker in sync. It owns no game state
 * — the terrain it draws is read from the simulation's world, and the tile the
 * player tapped was resolved by `Game`, not here.
 */

import Phaser from 'phaser';
import type { GameContext } from '@/game/Game';
import { selectedCells } from '@/game/selection';
import { PhaserCameraBinding } from '@/renderer/phaser/camera/PhaserCameraBinding';
import { TerrainRenderer } from '@/renderer/phaser/terrain/TerrainRenderer';
import { VillagerRenderer } from '@/renderer/phaser/entities/VillagerRenderer';
import { WolfRenderer } from '@/renderer/phaser/entities/WolfRenderer';
import { WOLF_VIGOUR } from '@/simulation/wildlife/Combat';
import { DesignationRenderer } from '@/renderer/phaser/entities/DesignationRenderer';
import { ConnectorRenderer } from '@/renderer/phaser/entities/ConnectorRenderer';
import { ResourceRenderer } from '@/renderer/phaser/entities/ResourceRenderer';
import { BuildingRenderer } from '@/renderer/phaser/entities/BuildingRenderer';
import { TextureKeys } from '@/renderer/phaser/terrain/tileTextures';
import { RenderLayer, depthFor } from '@/renderer/phaser/sorting';
import { gridToScene } from '@/shared/math/isometric';
import { FrameTimer } from '@/renderer/FrameTimer';
import { WeatherRenderer } from '@/renderer/phaser/effects/WeatherRenderer';
import { FireRenderer } from '@/renderer/phaser/effects/FireRenderer';
import { HearthRenderer } from '@/renderer/phaser/effects/HearthRenderer';
import { structureTint } from '@/renderer/phaser/terrain/seasonalPalette';

export const WORLD_SCENE_KEY = 'world';

/** Background beyond the map edge: a cold, dark void, not pure black. */
const VOID_COLOUR = 0x12140f;

export class WorldScene extends Phaser.Scene {
  private context!: GameContext;
  private cameraBinding!: PhaserCameraBinding;
  private terrainRenderer!: TerrainRenderer;
  private villagerRenderer!: VillagerRenderer;
  private wolfRenderer!: WolfRenderer;
  private designationRenderer!: DesignationRenderer;
  private connectorRenderer!: ConnectorRenderer;
  private resourceRenderer!: ResourceRenderer;
  private buildingRenderer!: BuildingRenderer;
  private weatherRenderer!: WeatherRenderer;
  private hearthRenderer!: HearthRenderer;
  private fireRenderer!: FireRenderer;
  /**
   * One marker per selected cell, grown on demand and never shrunk.
   *
   * A single tile diamond could not outline a building: scaling one up only
   * works for a square footprint, and the game has buildings that are not
   * square. A handful of tile markers is exact for any shape, and the pool caps
   * itself at the largest footprint anybody ever selects — nine cells today.
   */
  private selectionMarkers: Phaser.GameObjects.Image[] = [];
  /** Season the world is currently painted and tinted for. */
  private renderedSeason = '';
  /** The world generation currently drawn, so a new settlement rebuilds. */
  private renderedWorldVersion = 0;
  /** Last selection version drawn, so the marker only moves when it changes. */
  private renderedSelectionVersion = -1;
  /** Turns Phaser's smoothed delta into real elapsed time. */
  private readonly frameTimer = new FrameTimer();

  constructor() {
    super(WORLD_SCENE_KEY);
  }

  public init(data: { context: GameContext }): void {
    this.context = data.context;
    this.renderedWorldVersion = data.context.worldVersion;
    this.renderedSeason = '';
    this.renderedSelectionVersion = -1;
  }

  public create(): void {
    this.cameras.main.setBackgroundColor(VOID_COLOUR);
    this.cameraBinding = new PhaserCameraBinding(this.cameras.main, this.context.camera);

    this.terrainRenderer = new TerrainRenderer(this);
    this.terrainRenderer.build(
      this.context.simulation.world,
      this.context.simulation.snapshot().season,
    );
    this.villagerRenderer = new VillagerRenderer(this);
    this.wolfRenderer = new WolfRenderer(this);
    this.designationRenderer = new DesignationRenderer(this);
    this.connectorRenderer = new ConnectorRenderer(this);
    this.resourceRenderer = new ResourceRenderer(this);
    this.buildingRenderer = new BuildingRenderer(this);
    this.weatherRenderer = new WeatherRenderer(this);
    this.hearthRenderer = new HearthRenderer(this);
    this.fireRenderer = new FireRenderer(this);

    this.selectionMarkers = [];

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.terrainRenderer.destroy();
      this.weatherRenderer.destroy();
      this.villagerRenderer.destroy();
      this.wolfRenderer.destroy();
      this.designationRenderer.destroy();
      this.connectorRenderer.destroy();
      this.resourceRenderer.destroy();
      this.buildingRenderer.destroy();
      this.hearthRenderer.destroy();
      this.fireRenderer.destroy();
    });

    this.cameraBinding.sync();
  }

  public override update(time: number, delta: number): void {
    // Phaser's `delta` is smoothed and must not drive the simulation; see
    // FrameTimer. `Game.advance` clamps the result, which is what stops a long
    // stall from stampeding the settlement.
    this.context.advance(this.frameTimer.delta(time, delta));

    // A new settlement is a whole new world: every sprite in the scene refers
    // to terrain, trees and buildings that no longer exist.
    if (this.context.worldVersion !== this.renderedWorldVersion) {
      this.renderedWorldVersion = this.context.worldVersion;
      this.scene.restart({ context: this.context });
      return;
    }

    this.cameraBinding.sync();

    // Villagers move every frame, so this runs unconditionally — unlike the
    // tile marker, which only moves when the selection changes.
    this.villagerRenderer.sync({
      villagers: this.context.simulation.villagers.all,
      alpha: this.context.tickAlpha,
      selectedId: this.context.selection?.villager?.id ?? null,
      // Where somebody works decides whether they are drawn at all: see
      // `VillagerRenderer.sync`. Real seconds, because walking through a door is
      // not a thing the simulation clock should speed up.
      buildings: this.context.simulation.world.buildings,
      deltaSeconds: delta / 1000,
    });

    // The pack, when there is one. Same interpolation as the people, because a
    // wolf crossing a field at 1x must not step ten times a second either.
    this.wolfRenderer.sync(this.context.simulation.wolves.all, this.context.tickAlpha, WOLF_VIGOUR);

    this.syncSeason(delta);
    this.designationRenderer.sync(this.context.simulation.jobs);
    this.connectorRenderer.sync(this.context.simulation.world);
    this.connectorRenderer.syncRoadLine(this.context.roadLine, this.context.roadLineVersion);
    this.resourceRenderer.sync(
      this.context.simulation.world.piles,
      this.context.simulation.storages,
    );
    // Cheap: returns immediately unless a tree was felled since last frame.
    this.terrainRenderer.syncTrees(this.context.simulation.world);
    this.buildingRenderer.sync(
      this.context.simulation.world.buildings,
      this.context.simulation.storages,
    );
    this.hearthRenderer.sync(this.context.simulation.world.buildings);
    this.fireRenderer.sync(this.context.simulation.world.buildings);
    this.buildingRenderer.syncGhost(this.context.placement, this.context.placementVersion);
    this.syncSelectionMarker();
  }

  /**
   * Repaints the world and runs the weather for the current season.
   *
   * The heavy part — re-framing every tile and tree — happens inside
   * `applySeason`, which returns immediately unless the season actually turned.
   * The weather runs on *real* elapsed time rather than simulation time, so
   * snow does not fall four times faster because the player pressed 4x.
   */
  private syncSeason(deltaMilliseconds: number): void {
    const season = this.context.simulation.snapshot().season;

    if (season !== this.renderedSeason) {
      this.renderedSeason = season;
      this.terrainRenderer.applySeason(this.context.simulation.world, season);
      const tint = structureTint(season);
      this.buildingRenderer.applyTint(tint);
      // And the plots that grow something turn over their whole picture rather
      // than taking the season's light: see `BuildingRenderer.applySeason`.
      this.buildingRenderer.applySeason(season);
      this.villagerRenderer.applyTint(tint);
      this.resourceRenderer.applyTint(tint);
      this.wolfRenderer.applyTint(tint);
    }

    // Re-anchored every frame: the camera's zoom changes under the player's
    // fingers, and a screen-space overlay that does not follow it becomes a
    // bright rectangle sitting in the middle of the world.
    this.weatherRenderer.syncToCamera(this.cameras.main);
    this.weatherRenderer.update(season, deltaMilliseconds / 1000, () =>
      this.context.presentationRandom(),
    );

    // Smoke is in the world rather than on the lens, so it needs no camera
    // sync — but it does need the view, to leave off-screen fires alone.
    this.hearthRenderer.update({
      season,
      deltaSeconds: deltaMilliseconds / 1000,
      camera: this.cameras.main,
      random: () => this.context.presentationRandom(),
    });

    // Flames belong to one roof and stay on it, so they are sorted with the
    // building rather than with the smoke. See `effects/FireRenderer.ts`.
    this.fireRenderer.update(deltaMilliseconds / 1000);
  }

  /** Exposed so the debug overlay can report render object counts. */
  public get renderStats(): { tileCount: number; treeCount: number } {
    return this.terrainRenderer.renderStats;
  }

  private handleResize(): void {
    this.cameraBinding.syncViewport();
    this.cameraBinding.sync();
    this.weatherRenderer.resize(this.scale.width, this.scale.height);
  }

  /**
   * Moves the marker only when the selection actually changed.
   *
   * Repositioning it every frame would dirty the display list and force Phaser
   * to re-sort thousands of objects for no reason.
   */
  private syncSelectionMarker(): void {
    if (this.renderedSelectionVersion === this.context.selectionVersion) {
      return;
    }
    this.renderedSelectionVersion = this.context.selectionVersion;

    const selection = this.context.selection;
    // A building answers for every cell it stands on, so selecting one outlines
    // the whole building. Anything else is a single tile.
    const cells = selection ? selectedCells(selection) : [];

    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index]!;
      const position = gridToScene(cell);
      this.markerAt(index)
        .setPosition(position.px, position.py)
        .setDepth(depthFor(cell.gx, cell.gy, RenderLayer.Overlay))
        .setVisible(true);
    }
    for (let index = cells.length; index < this.selectionMarkers.length; index += 1) {
      this.selectionMarkers[index]!.setVisible(false);
    }
  }

  /** The pooled marker for a slot, created the first time that slot is needed. */
  private markerAt(index: number): Phaser.GameObjects.Image {
    const existing = this.selectionMarkers[index];
    if (existing) {
      return existing;
    }
    const marker = this.add.image(0, 0, TextureKeys.selection).setOrigin(0.5, 0.5);
    this.selectionMarkers[index] = marker;
    return marker;
  }
}
