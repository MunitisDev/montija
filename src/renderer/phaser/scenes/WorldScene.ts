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
import { TextureKeys } from '@/renderer/phaser/terrain/tileTextures';
import { RenderLayer, depthFor } from '@/renderer/phaser/sorting';
import { gridToScene } from '@/shared/math/isometric';

export const WORLD_SCENE_KEY = 'world';

/** Background beyond the map edge: a cold, dark void, not pure black. */
const VOID_COLOUR = 0x12140f;

export class WorldScene extends Phaser.Scene {
  private context!: GameContext;
  private cameraBinding!: PhaserCameraBinding;
  private terrainRenderer!: TerrainRenderer;
  private villagerRenderer!: VillagerRenderer;
  private selectionMarker!: Phaser.GameObjects.Image;
  /** Last selection version drawn, so the marker only moves when it changes. */
  private renderedSelectionVersion = -1;

  constructor() {
    super(WORLD_SCENE_KEY);
  }

  public init(data: { context: GameContext }): void {
    this.context = data.context;
  }

  public create(): void {
    this.cameras.main.setBackgroundColor(VOID_COLOUR);
    this.cameraBinding = new PhaserCameraBinding(this.cameras.main, this.context.camera);

    this.terrainRenderer = new TerrainRenderer(this);
    this.terrainRenderer.build(this.context.simulation.world);
    this.villagerRenderer = new VillagerRenderer(this);

    this.selectionMarker = this.add
      .image(0, 0, TextureKeys.selection)
      .setOrigin(0.5, 0.5)
      .setVisible(false);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.terrainRenderer.destroy();
      this.villagerRenderer.destroy();
    });

    this.cameraBinding.sync();
  }

  public override update(_time: number, delta: number): void {
    this.context.advance(delta);
    this.cameraBinding.sync();

    // Villagers move every frame, so this runs unconditionally — unlike the
    // tile marker, which only moves when the selection changes.
    this.villagerRenderer.sync(
      this.context.simulation.villagers.all,
      this.context.tickAlpha,
      this.context.selection?.villager?.id ?? null,
    );

    this.syncSelectionMarker();
  }

  /** Exposed so the debug overlay can report render object counts. */
  public get renderStats(): { tileCount: number; treeCount: number } {
    return this.terrainRenderer.renderStats;
  }

  private handleResize(): void {
    this.cameraBinding.syncViewport();
    this.cameraBinding.sync();
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
