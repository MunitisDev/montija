/**
 * The world scene.
 *
 * Status: PLACEHOLDER (Phase 1). It draws a flat, non-isometric checker field
 * purely so that panning and zooming are visible and verifiable. The real
 * isometric terrain, the logical grid and seeded world generation are Phase 2 —
 * this scene will be replaced, not extended.
 *
 * What is *not* placeholder is the wiring: the scene drives `GameContext.advance`
 * once per frame, mirrors the camera controller onto the Phaser camera, and
 * owns no game state of its own.
 */

import Phaser from 'phaser';
import { PALETTE, PLACEHOLDER_WORLD, WORLD_PIXEL_HEIGHT, WORLD_PIXEL_WIDTH } from '@/app/config';
import type { GameContext } from '@/game/Game';
import { PhaserCameraBinding } from '@/renderer/phaser/camera/PhaserCameraBinding';
import { SeededRandom, deriveSeed } from '@/shared/math/random';

export const WORLD_SCENE_KEY = 'world';

export class WorldScene extends Phaser.Scene {
  private context!: GameContext;
  private cameraBinding!: PhaserCameraBinding;
  private selectionMarker!: Phaser.GameObjects.Graphics;

  constructor() {
    super(WORLD_SCENE_KEY);
  }

  public init(data: { context: GameContext }): void {
    this.context = data.context;
  }

  public create(): void {
    this.cameras.main.setBackgroundColor(PALETTE.voidBackground);
    this.cameraBinding = new PhaserCameraBinding(this.cameras.main, this.context.camera);

    this.drawPlaceholderTerrain();
    this.selectionMarker = this.add.graphics().setDepth(100);

    // Phaser's own resize event is the single place viewport size is refreshed.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });

    // Start looking at the middle of the world.
    this.context.camera.centreOn({ wx: WORLD_PIXEL_WIDTH / 2, wy: WORLD_PIXEL_HEIGHT / 2 });
    this.cameraBinding.sync();
  }

  public override update(_time: number, delta: number): void {
    this.context.advance(delta);
    this.cameraBinding.sync();
    this.drawSelectionMarker();
  }

  private handleResize(): void {
    this.cameraBinding.syncViewport();
    this.cameraBinding.sync();
  }

  /**
   * Generates the stand-in terrain from the world seed.
   *
   * Deterministic on purpose: even placeholder visuals should reload identically
   * so that "it looked different last time" is never a real possibility.
   */
  private drawPlaceholderTerrain(): void {
    const random = new SeededRandom(deriveSeed(this.context.simulation.worldSeed, 'placeholder'));
    const { gridWidth, gridHeight, cellSize } = PLACEHOLDER_WORLD;

    const ground = this.add.graphics().setDepth(-10);
    ground.fillStyle(PALETTE.worldEdge, 1);
    ground.fillRect(
      -cellSize,
      -cellSize,
      WORLD_PIXEL_WIDTH + cellSize * 2,
      WORLD_PIXEL_HEIGHT + cellSize * 2,
    );

    for (let gy = 0; gy < gridHeight; gy += 1) {
      for (let gx = 0; gx < gridWidth; gx += 1) {
        const roll = random.next();
        const colour =
          roll < 0.06
            ? PALETTE.water
            : roll < 0.2
              ? PALETTE.forest
              : roll < 0.24
                ? PALETTE.stone
                : (gx + gy) % 2 === 0
                  ? PALETTE.grass
                  : PALETTE.grassAlt;

        ground.fillStyle(colour, 1);
        ground.fillRect(gx * cellSize, gy * cellSize, cellSize, cellSize);
      }
    }

    // A faint border makes the world bounds legible while testing the camera.
    ground.lineStyle(4, PALETTE.gridLine, 0.35);
    ground.strokeRect(0, 0, WORLD_PIXEL_WIDTH, WORLD_PIXEL_HEIGHT);
  }

  /** Draws a ring where the player last tapped, proving input reaches the world. */
  private drawSelectionMarker(): void {
    const pending = this.context.consumeSelection();
    if (!pending) {
      return;
    }

    const world = this.context.camera.viewportToWorld(pending);
    this.selectionMarker.clear();
    this.selectionMarker.lineStyle(3, 0xd8cba8, 0.9);
    this.selectionMarker.strokeCircle(world.wx, world.wy, 26);
  }
}
