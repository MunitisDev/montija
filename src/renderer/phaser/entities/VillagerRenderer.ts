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
 *
 * **Which figure and which colour** come from `shared/appearance.ts`, and are
 * re-read every sync rather than fixed when the sprite is made: a child turns
 * eighteen and a worker turns sixty while the sprite is on screen, and a
 * settlement whose people never visibly grow up would be lying about the one
 * thing this art is for.
 */

import type Phaser from 'phaser';
import { VILLAGER_HEIGHT, TextureKeys } from '@/renderer/phaser/terrain/tileTextures';
import { colourIndexFor, lookFor } from '@/shared/appearance';
import { RenderLayer, depthFor } from '@/renderer/phaser/sorting';
import { worldToScene } from '@/shared/math/isometric';
import type { WorldPoint } from '@/shared/types/geometry';
import type { Villager } from '@/simulation/villagers/Villager';

export class VillagerRenderer {
  private readonly scene: Phaser.Scene;
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>();
  /** The frame each sprite is showing, so an unchanged one is left alone. */
  private readonly frames = new Map<number, string>();
  /** Seasonal light, applied to new arrivals as well as everyone present. */
  private seasonTint = 0xffffff;
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

      // A birthday can change the figure: a child becomes a woman, a woman an
      // elder. Compared rather than set, because setting a texture every frame
      // for three hundred sprites is work for nothing.
      const frame = TextureKeys.villagerFrame(lookFor(villager), colourIndexFor(villager));
      if (this.frames.get(villager.id) !== frame) {
        sprite.setTexture(TextureKeys.villagerAtlas, frame);
        this.frames.set(villager.id, frame);
      }

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
        this.frames.delete(id);
      }
    }

    if (selectedId === null || !live.has(selectedId)) {
      this.selectionRing.setVisible(false);
    }
  }

  /**
   * Tints everyone for the season.
   *
   * The art is painted neutral precisely so it can take this, which is what
   * lets one set of sprites carry four seasons.
   */
  public applyTint(tint: number): void {
    this.seasonTint = tint;
    for (const sprite of this.sprites.values()) {
      sprite.setTint(tint);
    }
  }

  public destroy(): void {
    for (const sprite of this.sprites.values()) {
      sprite.destroy();
    }
    this.sprites.clear();
    this.frames.clear();
    this.selectionRing.destroy();
  }

  private spriteFor(villager: Villager): Phaser.GameObjects.Image {
    const existing = this.sprites.get(villager.id);
    if (existing) {
      return existing;
    }

    const sprite = this.scene.add
      // The frame is set by `sync` on the same pass, from the villager's age and
      // sex — this is only which atlas it comes out of.
      .image(0, 0, TextureKeys.villagerAtlas)
      // Anchored at the feet, per the art bible, so the villager stands on the
      // tile rather than hovering over its centre.
      .setOrigin(0.5, 1)
      .setDisplaySize(VILLAGER_HEIGHT / 2, VILLAGER_HEIGHT)
      // Someone born in winter arrives in winter's light, not summer's.
      .setTint(this.seasonTint);
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
