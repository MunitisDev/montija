/**
 * Draws resources lying on the ground, and the storage yards they go to.
 *
 * Piles are the visible half of the project's core resource rule: what you see
 * on the ground is genuinely there, and stays there until a villager carries it
 * away. Nothing here is authoritative — it reads the simulation's registries.
 *
 * Both are synced off version counters rather than diffed each frame, since
 * piles change only when someone drops or picks something up.
 */

import type Phaser from 'phaser';
import type { ResourceId } from '@/data/resources';
import { RenderLayer, depthFor, depthForFootprint } from '@/renderer/phaser/sorting';
import { TextureKeys } from '@/renderer/phaser/terrain/tileTextures';
import { gridToScene } from '@/shared/math/isometric';
import type { StorageRegistry } from '@/simulation/logistics/Storage';
import type { ResourcePileRegistry } from '@/simulation/resources/ResourcePile';

/** Storage yards occupy a 3x3 footprint, per the art bible. */
const STORAGE_FOOTPRINT = 3;

export class ResourceRenderer {
  private readonly scene: Phaser.Scene;
  private readonly pileSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly storageSprites = new Map<number, Phaser.GameObjects.Image>();
  private renderedPileVersion = -1;
  private renderedStorageVersion = -1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  public get pileSpriteCount(): number {
    return this.pileSprites.size;
  }

  public sync(piles: ResourcePileRegistry, storages: StorageRegistry): void {
    this.syncStorages(storages);
    this.syncPiles(piles);
  }

  private syncPiles(piles: ResourcePileRegistry): void {
    if (this.renderedPileVersion === piles.version) {
      return;
    }
    this.renderedPileVersion = piles.version;

    const live = new Set<number>();
    for (const pile of piles.all) {
      live.add(pile.id);
      if (this.pileSprites.has(pile.id)) {
        continue;
      }

      const position = gridToScene(pile.cell);
      const sprite = this.scene.add
        .image(position.px, position.py, textureFor(pile.resource))
        // Anchored at the base like everything that sits on the ground, with a
        // little drop so the heap looks settled into the tile rather than
        // balanced on its centre line.
        .setOrigin(0.5, 1)
        .setY(position.py + 6)
        .setDepth(depthFor(pile.cell.gx, pile.cell.gy, RenderLayer.ResourcePile));
      this.pileSprites.set(pile.id, sprite);
    }

    for (const [id, sprite] of this.pileSprites) {
      if (!live.has(id)) {
        sprite.destroy();
        this.pileSprites.delete(id);
      }
    }
  }

  private syncStorages(storages: StorageRegistry): void {
    if (this.renderedStorageVersion === storages.version) {
      return;
    }
    this.renderedStorageVersion = storages.version;

    for (const storage of storages.all) {
      if (this.storageSprites.has(storage.id)) {
        continue;
      }

      const position = gridToScene(storage.cell);
      const sprite = this.scene.add
        .image(position.px, position.py, TextureKeys.storageYard)
        .setOrigin(0.5, 1)
        // Sorted on the footprint's front corner, so a villager standing beside
        // the yard is not incorrectly drawn behind it.
        .setDepth(
          depthForFootprint(
            storage.cell.gx,
            storage.cell.gy,
            STORAGE_FOOTPRINT,
            STORAGE_FOOTPRINT,
            RenderLayer.Structure,
          ),
        );
      this.storageSprites.set(storage.id, sprite);
    }
  }

  public destroy(): void {
    for (const sprite of this.pileSprites.values()) {
      sprite.destroy();
    }
    for (const sprite of this.storageSprites.values()) {
      sprite.destroy();
    }
    this.pileSprites.clear();
    this.storageSprites.clear();
    this.renderedPileVersion = -1;
    this.renderedStorageVersion = -1;
  }
}

function textureFor(resource: ResourceId): string {
  return resource === 'stone' ? TextureKeys.stonePile : TextureKeys.logPile;
}
