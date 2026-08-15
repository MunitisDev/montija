/**
 * Draws the terrain and the trees.
 *
 * Reads the simulation's world and builds Phaser objects from it. It holds no
 * authoritative state: destroy this and rebuild it, and nothing about the game
 * changes.
 *
 * Performance note: the map is built once as individual images, since terrain
 * is static in Phase 2. Phaser batches them by texture and culls off-camera
 * objects, and the display list only re-sorts when it is dirtied. If a
 * benchmark later shows this is the bottleneck, the fix is chunked render
 * textures — but the brief is explicit about profiling before optimising, so
 * that decision waits for numbers.
 */

import type Phaser from 'phaser';
import { gridToScene } from '@/shared/math/isometric';
import type { World } from '@/simulation/world/World';
import { RenderLayer, depthFor } from '@/renderer/phaser/sorting';
import { TextureKeys, createPlaceholderTextures } from './tileTextures';

export interface TerrainRenderStats {
  readonly tileCount: number;
  readonly treeCount: number;
}

export class TerrainRenderer {
  private readonly scene: Phaser.Scene;
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private stats: TerrainRenderStats = { tileCount: 0, treeCount: 0 };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  public get renderStats(): TerrainRenderStats {
    return this.stats;
  }

  /** Builds the whole visible world. Safe to call again after {@link destroy}. */
  public build(world: World): void {
    this.destroy();
    createPlaceholderTextures(this.scene);

    let tileCount = 0;
    world.terrain.forEach((gx, gy, type) => {
      const position = gridToScene({ gx, gy });
      const tile = this.scene.add
        .image(position.px, position.py, TextureKeys.terrainAtlas, TextureKeys.terrainFrame(type))
        // The diamond is centred in its texture, so the tile's scene position
        // is its centre.
        .setOrigin(0.5, 0.5)
        .setDepth(depthFor(gx, gy, RenderLayer.Terrain));
      this.objects.push(tile);
      tileCount += 1;
    });

    for (const tree of world.trees) {
      const position = gridToScene({ gx: tree.gx, gy: tree.gy });
      const sprite = this.scene.add
        .image(position.px, position.py, TextureKeys.treeAtlas, TextureKeys.treeFrame(tree.variant))
        // Anchored at the base, per the art bible: the trunk meets the ground
        // at the tile centre, and the canopy is free to overhang upwards.
        .setOrigin(0.5, 1)
        .setScale(tree.scale)
        .setDepth(depthFor(tree.gx, tree.gy, RenderLayer.Structure));
      this.objects.push(sprite);
    }

    this.stats = { tileCount, treeCount: world.trees.length };
  }

  public destroy(): void {
    for (const object of this.objects) {
      object.destroy();
    }
    this.objects.length = 0;
    this.stats = { tileCount: 0, treeCount: 0 };
  }
}
