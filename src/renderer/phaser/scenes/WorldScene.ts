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
import { PhaserCameraBinding } from '@/renderer/phaser/camera/PhaserCameraBinding';
import { TerrainRenderer } from '@/renderer/phaser/terrain/TerrainRenderer';
import { VillagerRenderer } from '@/renderer/phaser/entities/VillagerRenderer';
import { DesignationRenderer } from '@/renderer/phaser/entities/DesignationRenderer';
import { RoadRenderer } from '@/renderer/phaser/entities/RoadRenderer';
import { ResourceRenderer } from '@/renderer/phaser/entities/ResourceRenderer';
import { BuildingRenderer } from '@/renderer/phaser/entities/BuildingRenderer';
import { TextureKeys } from '@/renderer/phaser/terrain/tileTextures';
import { RenderLayer, depthFor } from '@/renderer/phaser/sorting';
import { gridToScene } from '@/shared/math/isometric';
import { FrameTimer } from '@/renderer/FrameTimer';
import { WeatherRenderer } from '@/renderer/phaser/effects/WeatherRenderer';
import { structureTint } from '@/renderer/phaser/terrain/seasonalPalette';

export const WORLD_SCENE_KEY = 'world';

/** Background beyond the map edge: a cold, dark void, not pure black. */
const VOID_COLOUR = 0x12140f;

export class WorldScene extends Phaser.Scene {
  private context!: GameContext;
  private cameraBinding!: PhaserCameraBinding;
  private terrainRenderer!: TerrainRenderer;
  private villagerRenderer!: VillagerRenderer;
  private designationRenderer!: DesignationRenderer;
  private roadRenderer!: RoadRenderer;
  private resourceRenderer!: ResourceRenderer;
  private buildingRenderer!: BuildingRenderer;
  private weatherRenderer!: WeatherRenderer;
  private selectionMarker!: Phaser.GameObjects.Image;
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
    this.designationRenderer = new DesignationRenderer(this);
    this.roadRenderer = new RoadRenderer(this);
    this.resourceRenderer = new ResourceRenderer(this);
    this.buildingRenderer = new BuildingRenderer(this);
    this.weatherRenderer = new WeatherRenderer(this);

    this.selectionMarker = this.add
      .image(0, 0, TextureKeys.selection)
      .setOrigin(0.5, 0.5)
      .setVisible(false);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.terrainRenderer.destroy();
      this.weatherRenderer.destroy();
      this.villagerRenderer.destroy();
      this.designationRenderer.destroy();
      this.roadRenderer.destroy();
      this.resourceRenderer.destroy();
      this.buildingRenderer.destroy();
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
    this.villagerRenderer.sync(
      this.context.simulation.villagers.all,
      this.context.tickAlpha,
      this.context.selection?.villager?.id ?? null,
    );

    this.syncSeason(delta);
    this.designationRenderer.sync(this.context.simulation.jobs);
    this.roadRenderer.sync(this.context.simulation.world.roads);
    this.resourceRenderer.sync(
      this.context.simulation.world.piles,
      this.context.simulation.storages,
    );
    // Cheap: returns immediately unless a tree was felled since last frame.
    this.terrainRenderer.syncTrees(this.context.simulation.world);
    this.buildingRenderer.sync(this.context.simulation.world.buildings);
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
      this.villagerRenderer.applyTint(tint);
      this.resourceRenderer.applyTint(tint);
    }

    // Re-anchored every frame: the camera's zoom changes under the player's
    // fingers, and a screen-space overlay that does not follow it becomes a
    // bright rectangle sitting in the middle of the world.
    this.weatherRenderer.syncToCamera(this.cameras.main);
    this.weatherRenderer.update(season, deltaMilliseconds / 1000, () =>
      this.context.presentationRandom(),
    );
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
    if (!selection) {
      this.selectionMarker.setVisible(false);
      return;
    }

    const position = gridToScene(selection.cell);
    this.selectionMarker
      .setPosition(position.px, position.py)
      .setDepth(depthFor(selection.cell.gx, selection.cell.gy, RenderLayer.Overlay))
      .setVisible(true);
  }
}
