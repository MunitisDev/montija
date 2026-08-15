/**
 * Draws villagers.
 *
 * A sprite here is a *picture of* a simulation villager. It holds no state the
 * simulation does not already own, and it never decides anything: it reads
 * position and activity, and chooses how to look.
 *
 * **Interpolation.** The simulation steps ten times a second; the screen redraws
 * sixty. Drawing the raw tick position would make villagers visibly stutter, so
 * each sprite is placed between the villager's previous and current position
 * using the clock's tick alpha. This is presentation only — the interpolated
 * position is never fed back into the simulation.
 */

import type Phaser from 'phaser';
import { VILLAGER_HEIGHT, TextureKeys } from '@/renderer/phaser/terrain/tileTextures';
import { RenderLayer, depthFor } from '@/renderer/phaser/sorting';
import { worldToScene } from '@/shared/math/isometric';
import type { WorldPoint } from '@/shared/types/geometry';
import type { Villager } from '@/simulation/villagers/Villager';

export class VillagerRenderer {
  private readonly scene: Phaser.Scene;
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly selectionRing: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.selectionRing = scene.add
      .image(0, 0, TextureKeys.villagerRing)
      .setOrigin(0.5, 0.5)
      .setVisible(false);
  }

  /**
   * Syncs sprites to the villager list.
   *
   * @param alpha progress through the pending tick, in `[0, 1)`
   * @param selectedId villager to highlight, if any
   */
  public sync(villagers: readonly Villager[], alpha: number, selectedId: number | null): void {
    const live = new Set<number>();

    for (const villager of villagers) {
      live.add(villager.id);
      const sprite = this.spriteFor(villager);

      const position = interpolate(villager.previousPosition, villager.position, alpha);
      const scene = worldToScene(position);
      sprite.setPosition(scene.px, scene.py);

      // Depth follows the cell the villager is *currently* in, so they pass in
      // front of and behind trees correctly as they walk.
      const cell = villager.cell;
      sprite.setDepth(depthFor(cell.gx, cell.gy, RenderLayer.Character));

      if (villager.id === selectedId) {
        this.selectionRing
          .setPosition(scene.px, scene.py)
          .setDepth(depthFor(cell.gx, cell.gy, RenderLayer.Overlay))
          .setVisible(true);
      }
    }

    // Remove sprites for villagers that no longer exist — deaths, from Phase 8.
    for (const [id, sprite] of this.sprites) {
      if (!live.has(id)) {
        sprite.destroy();
        this.sprites.delete(id);
      }
    }

    if (selectedId === null || !live.has(selectedId)) {
      this.selectionRing.setVisible(false);
    }
  }

  public destroy(): void {
    for (const sprite of this.sprites.values()) {
      sprite.destroy();
    }
    this.sprites.clear();
    this.selectionRing.destroy();
  }

  private spriteFor(villager: Villager): Phaser.GameObjects.Image {
    const existing = this.sprites.get(villager.id);
    if (existing) {
      return existing;
    }

    const sprite = this.scene.add
      .image(0, 0, TextureKeys.villager)
      // Anchored at the feet, per the art bible, so the villager stands on the
      // tile rather than hovering over its centre.
      .setOrigin(0.5, 1)
      .setDisplaySize(VILLAGER_HEIGHT / 2, VILLAGER_HEIGHT);
    this.sprites.set(villager.id, sprite);
    return sprite;
  }
}

function interpolate(from: WorldPoint, to: WorldPoint, alpha: number): WorldPoint {
  return {
    wx: from.wx + (to.wx - from.wx) * alpha,
    wy: from.wy + (to.wy - from.wy) * alpha,
  };
}
