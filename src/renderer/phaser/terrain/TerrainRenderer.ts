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
import type { TreeStage } from '@/simulation/world/TreeGrowth';
import { gridToScene } from '@/shared/math/isometric';
import type { GridPoint } from '@/shared/types/geometry';
import type { World } from '@/simulation/world/World';
import type { Season } from '@/simulation/seasons/SeasonClock';
import { RenderLayer, depthFor } from '@/renderer/phaser/sorting';
import { TextureKeys, createPlaceholderTextures } from './tileTextures';
import { tileVariant } from './groundArt';

export interface TerrainRenderStats {
  readonly tileCount: number;
  readonly treeCount: number;
}

/**
 * How big each growth stage is drawn, against a grown tree's own size.
 *
 * **The three sizes are the whole of what the player sees of the woodland
 * cycle**, so the gaps between them have to be obvious at a tablet's viewing
 * distance rather than merely correct. A sapling at 0.4 reads as scrub from
 * across the valley; at 0.7 it reads as a young tree and not as a small one.
 *
 * Each tree keeps its own `scale` on top of this — the variety that stops a wood
 * looking like stamped copies — so two saplings are still different saplings.
 */
const STAGE_SCALE: Readonly<Record<TreeStage, number>> = {
  sapling: 0.4,
  young: 0.7,
  mature: 1,
};

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
  /**
   * The season the ground and trees are currently painted for.
   *
   * Repainting is driven by this rather than by the calendar directly, so the
   * ~9,200 tiles are only re-framed on the four days a year it changes.
   */
  private paintedSeason: Season = 'spring';
  /** The tree variant each sprite was built from, for repainting. */
  private readonly treeVariants = new Map<number, number>();
  /** The growth stage each sprite is currently drawn at, so a change is visible. */
  private readonly treeStages = new Map<number, TreeStage>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  public get renderStats(): TerrainRenderStats {
    return { tileCount: this.tileCount, treeCount: this.treeSprites.size };
  }

  /** Builds the whole visible world. Safe to call again after {@link destroy}. */
  public build(world: World, season: Season = 'spring'): void {
    this.destroy();
    createPlaceholderTextures(this.scene);
    this.mapWidth = world.width;
    this.paintedSeason = season;

    let tileCount = 0;
    world.terrain.forEach((gx, gy, type) => {
      const position = gridToScene({ gx, gy });
      const tile = this.scene.add
        .image(
          position.px,
          position.py,
          TextureKeys.terrainAtlas,
          TextureKeys.terrainFrame(type, season, tileVariant(gx, gy)),
        )
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
      const stage = world.trees.stage(tree);
      const existing = this.treeSprites.get(tree.id);
      if (existing) {
        // **A tree that has grown, redrawn at its new size.** The sprite is not
        // rebuilt: only its scale changes, which is the whole of what growth looks
        // like — see `TreeGrowth.ts` for why three sizes and not ten.
        if (this.treeStages.get(tree.id) !== stage) {
          this.treeStages.set(tree.id, stage);
          existing.image.setScale(tree.scale * STAGE_SCALE[stage]);
        }
        continue;
      }

      const cell: GridPoint = { gx: tree.gx, gy: tree.gy };
      const position = gridToScene(cell);
      const image = this.scene.add
        .image(
          position.px,
          position.py,
          TextureKeys.treeAtlas,
          TextureKeys.treeFrame(tree.variant, this.paintedSeason),
        )
        // Anchored at the base, per the art bible: the trunk meets the ground
        // at the tile centre, and the canopy is free to overhang upwards.
        .setOrigin(0.5, 1)
        .setScale(tree.scale * STAGE_SCALE[stage])
        .setDepth(depthFor(tree.gx, tree.gy, RenderLayer.Structure));
      this.treeSprites.set(tree.id, { image, cell });
      this.treeVariants.set(tree.id, tree.variant);
      this.treeStages.set(tree.id, stage);
    }

    for (const [id, sprite] of this.treeSprites) {
      if (live.has(id)) {
        continue;
      }
      sprite.image.destroy();
      this.treeSprites.delete(id);
      this.treeVariants.delete(id);
      this.treeStages.delete(id);
      // Felling turns forest into grass, so the ground it stood on needs
      // repainting. Doing it here keeps terrain and trees in step without the
      // scene having to track which cells changed.
      this.refreshTile(world, sprite.cell);
    }
  }

  /** Repaints one terrain tile from the world's current terrain. */
  public refreshTile(world: World, cell: GridPoint): void {
    const tile = this.tileSprites.get(cell.gy * this.mapWidth + cell.gx);
    tile?.setTexture(
      TextureKeys.terrainAtlas,
      TextureKeys.terrainFrame(
        world.terrain.getAt(cell),
        this.paintedSeason,
        tileVariant(cell.gx, cell.gy),
      ),
    );
  }

  /**
   * Repaints the whole world for a new season.
   *
   * Returns immediately unless the season actually changed — this is called
   * every frame and does real work four times a year. Re-framing every tile in
   * one go costs a millisecond or two on the day winter arrives, which is a
   * better trade than tinting ~9,200 sprites individually every frame.
   */
  public applySeason(world: World, season: Season): void {
    if (season === this.paintedSeason) {
      return;
    }
    this.paintedSeason = season;

    world.terrain.forEach((gx, gy, type) => {
      const tile = this.tileSprites.get(gy * this.mapWidth + gx);
      tile?.setTexture(
        TextureKeys.terrainAtlas,
        TextureKeys.terrainFrame(type, season, tileVariant(gx, gy)),
      );
    });

    for (const [id, sprite] of this.treeSprites) {
      const variant = this.treeVariants.get(id) ?? 0;
      sprite.image.setTexture(TextureKeys.treeAtlas, TextureKeys.treeFrame(variant, season));
    }
  }

  public destroy(): void {
    this.treeVariants.clear();
    this.treeStages.clear();
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
