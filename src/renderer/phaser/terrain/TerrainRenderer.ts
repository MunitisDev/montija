/**
 * Draws the terrain and the trees.
 *
 * Reads the simulation's world and builds Phaser objects from it. It holds no
 * authoritative state: destroy this and rebuild it, and nothing about the game
 * changes.
 *
 * Performance note: the map is built once as individual images, since terrain
 * changes only where a tree is felled. Phaser batches them by texture and culls
 * off-camera objects, and the display list only re-sorts when it is dirtied. If
 * a benchmark later shows this is the bottleneck, the fix is chunked render
 * textures — but the brief is explicit about profiling before optimising, so
 * that decision waits for numbers.
 */

import type Phaser from 'phaser';
import { gridToScene } from '@/shared/math/isometric';
import type { GridPoint } from '@/shared/types/geometry';
import type { World } from '@/simulation/world/World';
import { RenderLayer, depthFor } from '@/renderer/phaser/sorting';
import { TextureKeys, createPlaceholderTextures } from './tileTextures';

export interface TerrainRenderStats {
  readonly tileCount: number;
  readonly treeCount: number;
}

/** A tree sprite, with the cell it stands on so its ground can be repainted. */
interface TreeSprite {
  readonly image: Phaser.GameObjects.Image;
  readonly cell: GridPoint;
}

export class TerrainRenderer {
  private readonly scene: Phaser.Scene;
  private readonly tileSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly treeSprites = new Map<number, TreeSprite>();
  private mapWidth = 0;
  private tileCount = 0;
  private renderedTreeVersion = -1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  public get renderStats(): TerrainRenderStats {
    return { tileCount: this.tileCount, treeCount: this.treeSprites.size };
  }

  /** Builds the whole visible world. Safe to call again after {@link destroy}. */
  public build(world: World): void {
    this.destroy();
    createPlaceholderTextures(this.scene);
    this.mapWidth = world.width;

    let tileCount = 0;
    world.terrain.forEach((gx, gy, type) => {
      const position = gridToScene({ gx, gy });
      const tile = this.scene.add
        .image(position.px, position.py, TextureKeys.terrainAtlas, TextureKeys.terrainFrame(type))
        // The diamond is centred in its texture, so the tile's scene position
        // is its centre.
        .setOrigin(0.5, 0.5)
        .setDepth(depthFor(gx, gy, RenderLayer.Terrain));
      this.tileSprites.set(gy * world.width + gx, tile);
      tileCount += 1;
    });

    this.syncTrees(world);
    this.tileCount = tileCount;
  }

  /**
   * Adds and removes tree sprites to match the registry, repainting the ground
   * under any tree that has gone.
   *
   * Only runs when the registry's version changes. Trees are felled rarely, so
   * polling one integer per frame beats diffing ~2,000 sprites.
   */
  public syncTrees(world: World): void {
    if (this.renderedTreeVersion === world.trees.version) {
      return;
    }
    this.renderedTreeVersion = world.trees.version;
    this.mapWidth = world.width;

    const live = new Set<number>();
    for (const tree of world.trees.all) {
      live.add(tree.id);
      if (this.treeSprites.has(tree.id)) {
        continue;
      }

      const cell: GridPoint = { gx: tree.gx, gy: tree.gy };
      const position = gridToScene(cell);
      const image = this.scene.add
        .image(position.px, position.py, TextureKeys.treeAtlas, TextureKeys.treeFrame(tree.variant))
        // Anchored at the base, per the art bible: the trunk meets the ground
        // at the tile centre, and the canopy is free to overhang upwards.
        .setOrigin(0.5, 1)
        .setScale(tree.scale)
        .setDepth(depthFor(tree.gx, tree.gy, RenderLayer.Structure));
      this.treeSprites.set(tree.id, { image, cell });
    }

    for (const [id, sprite] of this.treeSprites) {
      if (live.has(id)) {
        continue;
      }
      sprite.image.destroy();
      this.treeSprites.delete(id);
      // Felling turns forest into grass, so the ground it stood on needs
      // repainting. Doing it here keeps terrain and trees in step without the
      // scene having to track which cells changed.
      this.refreshTile(world, sprite.cell);
    }
  }

  /** Repaints one terrain tile from the world's current terrain. */
  public refreshTile(world: World, cell: GridPoint): void {
    const tile = this.tileSprites.get(cell.gy * this.mapWidth + cell.gx);
    tile?.setTexture(TextureKeys.terrainAtlas, TextureKeys.terrainFrame(world.terrain.getAt(cell)));
  }

  public destroy(): void {
    for (const sprite of this.tileSprites.values()) {
      sprite.destroy();
    }
    for (const sprite of this.treeSprites.values()) {
      sprite.image.destroy();
    }
    this.tileSprites.clear();
    this.treeSprites.clear();
    this.tileCount = 0;
    this.renderedTreeVersion = -1;
  }
}
