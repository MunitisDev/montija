/**
 * Draws the roads the settlement has beaten into the ground.
 *
 * Synced off the road grid's own version counter, so this costs one integer
 * comparison a frame until somebody actually finishes laying one. Roads change
 * a handful of times an hour of play; diffing thousands of cells every frame to
 * discover that would be absurd.
 *
 * Roads sit at {@link RenderLayer.Overlay} — painted onto the terrain, under
 * everything with height. A villager walking a road must pass over it, and a
 * house built beside one must not have the track drawn across its wall.
 */

import type Phaser from 'phaser';
import { RenderLayer, depthFor } from '@/renderer/phaser/sorting';
import { TextureKeys } from '@/renderer/phaser/terrain/tileTextures';
import { gridToScene } from '@/shared/math/isometric';
import type { RoadGrid } from '@/simulation/world/RoadGrid';

export class RoadRenderer {
  private readonly scene: Phaser.Scene;
  /** Keyed by cell index, so a lifted road can be found and destroyed. */
  private readonly tiles = new Map<number, Phaser.GameObjects.Image>();
  private renderedVersion = -1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  public sync(roads: RoadGrid): void {
    if (this.renderedVersion === roads.version) {
      return;
    }
    this.renderedVersion = roads.version;

    const live = new Set<number>();
    for (const cell of roads.all()) {
      const index = cell.gy * roads.width + cell.gx;
      live.add(index);
      if (this.tiles.has(index)) {
        continue;
      }

      const position = gridToScene(cell);
      const tile = this.scene.add
        .image(position.px, position.py, TextureKeys.road)
        .setOrigin(0.5, 0.5)
        .setDepth(depthFor(cell.gx, cell.gy, RenderLayer.Overlay));
      this.tiles.set(index, tile);
    }

    for (const [index, tile] of this.tiles) {
      if (!live.has(index)) {
        tile.destroy();
        this.tiles.delete(index);
      }
    }
  }

  public destroy(): void {
    for (const tile of this.tiles.values()) {
      tile.destroy();
    }
    this.tiles.clear();
    this.renderedVersion = -1;
  }
}
