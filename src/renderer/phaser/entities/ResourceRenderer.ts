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
import { TextureKeys, buildingGroundLine } from '@/renderer/phaser/terrain/tileTextures';
import { yardFillVariant } from '@/renderer/phaser/terrain/buildingArt';
import { gridToScene } from '@/shared/math/isometric';
import { FOUNDING_YARD_RADIUS } from '@/simulation/Simulation';
import type { StorageRegistry } from '@/simulation/logistics/Storage';
import type { ResourcePileRegistry } from '@/simulation/resources/ResourcePile';

/** Storage yards occupy a 3x3 footprint, per the art bible. */
/** Derived, so the sprite is exactly as wide as the ground the yard clears. */
const STORAGE_FOOTPRINT = FOUNDING_YARD_RADIUS * 2 + 1;

export class ResourceRenderer {
  private readonly scene: Phaser.Scene;
  private readonly pileSprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly storageSprites = new Map<number, Phaser.GameObjects.Image>();
  /** Which fill each yard is currently drawn at, so it is only swapped when it moves. */
  private readonly storageFills = new Map<number, number>();
  private renderedPileVersion = -1;
  private renderedStorageVersion = -1;
  /** Seasonal light, so the founding yard is not the one warm thing in winter. */
  private seasonTint = 0xffffff;

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
      const existing = this.storageSprites.get(storage.id);
      if (existing) {
        // **The camp is drawn as full as it is.** Yards have a texture per
        // stocked-ness, and this is where one is chosen — a pure read of what the
        // store holds, which is exactly what a renderer is for. Swapped only when
        // the level actually moves, since the version bumps on every transfer.
        this.dressYard(storage.id, existing, storage.inventory.total);
        continue;
      }
      // A yard opened by a building is already drawn by that building. Drawing
      // it again here put a second, differently-shaped yard on the same cells,
      // which is what made buildings look like they were overlapping.
      if (storage.ownerBuildingId !== null) {
        continue;
      }

      // The founding yard has no building behind it, so it borrows the Storage
      // Yard's own art: it *is* one, and two yards that behave identically
      // should not look like different things.
      // The founding yard is recorded as a single cell, and stands as a 3x3
      // centred on it, so that cell's centre is already the footprint's centre.
      const centre = gridToScene(storage.cell);
      const sprite = this.scene.add
        .image(
          centre.px,
          centre.py,
          TextureKeys.building('storage-yard', yardFillVariant(storage.inventory.total)),
        )
        .setTint(this.seasonTint)
        .setOrigin(0.5, buildingGroundLine('storage-yard'))
        // Sorted on the footprint's front corner, so a villager standing beside
        // the yard is not incorrectly drawn behind it.
        .setDepth(
          depthForFootprint(
            storage.cell.gx - Math.floor(STORAGE_FOOTPRINT / 2),
            storage.cell.gy - Math.floor(STORAGE_FOOTPRINT / 2),
            STORAGE_FOOTPRINT,
            STORAGE_FOOTPRINT,
            RenderLayer.Structure,
          ),
        );
      this.storageSprites.set(storage.id, sprite);
      this.storageFills.set(storage.id, yardFillVariant(storage.inventory.total));
    }
  }

  /** Puts the right amount of goods on a yard's deck. */
  private dressYard(id: number, sprite: Phaser.GameObjects.Image, total: number): void {
    const fill = yardFillVariant(total);
    if (this.storageFills.get(id) === fill) {
      return;
    }
    this.storageFills.set(id, fill);
    sprite.setTexture(TextureKeys.building('storage-yard', fill));
  }

  /** Tints the yards for the season. Piles are goods, and keep their own colour. */
  public applyTint(tint: number): void {
    this.seasonTint = tint;
    for (const sprite of this.storageSprites.values()) {
      sprite.setTint(tint);
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
  return TextureKeys.pile(resource);
}
