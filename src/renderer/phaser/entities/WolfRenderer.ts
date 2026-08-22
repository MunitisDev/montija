/**
 * Draws the pack.
 *
 * The smallest renderer in the game and the one that changed the most about how
 * the settlement feels: for three versions a raid was a line of text saying food
 * had gone. Now there are four dark shapes coming out of the trees, and the
 * player can see which of their people are between them and the larder.
 *
 * Holds no authoritative state. Destroy it and rebuild it and nothing about the
 * night changes — the wolves are in the simulation, where they can be saved.
 */

import type Phaser from 'phaser';
import { RenderLayer, depthFor } from '@/renderer/phaser/sorting';
import { worldToScene } from '@/shared/math/isometric';
import type { Wolf } from '@/simulation/wildlife/Wolf';
import { TextureKeys, WOLF_VARIANTS, createPlaceholderTextures } from '../terrain/tileTextures';

/**
 * How badly hurt a wolf has to be before it looks it.
 *
 * A limp rather than a health bar: the sprite loses a little of its solidity as it
 * is beaten, which is the only way this game says "nearly dead" — no numbers float
 * over anybody's head. Half is where it starts to show.
 */
const HURT_FROM = 0.5;

export class WolfRenderer {
  private readonly scene: Phaser.Scene;
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>();
  private seasonTint = 0xffffff;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Winter light on a winter animal, the same as everything else gets. */
  public applyTint(tint: number): void {
    this.seasonTint = tint;
    for (const sprite of this.sprites.values()) {
      sprite.setTint(tint);
    }
  }

  /**
   * Puts every wolf where the simulation says it is.
   *
   * Interpolated between the tick's start and end positions, exactly as villagers
   * are, so a pack crossing a field at 1x does not step ten times a second.
   */
  public sync(pack: readonly Wolf[], alpha: number, vigour: number): void {
    createPlaceholderTextures(this.scene);
    const live = new Set<number>();

    for (const wolf of pack) {
      live.add(wolf.id);
      const wx = wolf.previousPosition.wx + (wolf.position.wx - wolf.previousPosition.wx) * alpha;
      const wy = wolf.previousPosition.wy + (wolf.position.wy - wolf.previousPosition.wy) * alpha;
      const scene = worldToScene({ wx, wy });

      let sprite = this.sprites.get(wolf.id);
      if (!sprite) {
        sprite = this.scene.add
          .image(scene.px, scene.py, TextureKeys.wolfAtlas, TextureKeys.wolf(wolf.id))
          // Anchored at the feet, per the art bible: the animal meets the ground
          // at its own cell rather than hovering over it.
          .setOrigin(0.5, 1)
          .setTint(this.seasonTint);
        this.sprites.set(wolf.id, sprite);
      }

      sprite.setPosition(scene.px, scene.py);
      // Sorted with the villagers, not with the buildings: a wolf in front of a
      // house is in front of it, and one behind a wall is behind it.
      sprite.setDepth(
        depthFor(Math.floor(wx), Math.floor(wy), RenderLayer.Character) + (wolf.id % 4) * 0.01,
      );
      const share = Math.max(0, Math.min(1, wolf.vigour / vigour));
      sprite.setAlpha(share >= HURT_FROM ? 1 : 0.55 + share);
      void WOLF_VARIANTS;
    }

    for (const [id, sprite] of this.sprites) {
      if (live.has(id)) {
        continue;
      }
      sprite.destroy();
      this.sprites.delete(id);
    }
  }

  public destroy(): void {
    for (const sprite of this.sprites.values()) {
      sprite.destroy();
    }
    this.sprites.clear();
  }
}
