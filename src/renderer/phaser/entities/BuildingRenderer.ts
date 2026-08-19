/**
 * Draws buildings, construction sites and the placement ghost.
 *
 * Sites and finished buildings use different art, and a site also carries a
 * progress bar — the player needs to see that work is happening, not just that
 * something is there.
 *
 * The ghost is tinted from the *same* placement check the confirm command uses,
 * so a green ghost can never refuse to become a building.
 */

import type Phaser from 'phaser';
import { RenderLayer, depthForFootprint, overlayDepth } from '@/renderer/phaser/sorting';
import {
  SITE_GROUND_LINE,
  TextureKeys,
  buildingGroundLine,
} from '@/renderer/phaser/terrain/tileTextures';
import { gridToScene, worldToScene } from '@/shared/math/isometric';
import { buildingDefinition } from '@/data/buildings';
import type { PlacementState } from '@/game/Game';
import type { Building } from '@/simulation/buildings/Building';
import type { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';
import type { StorageRegistry } from '@/simulation/logistics/Storage';
import { artVariants, yardFillVariant } from '@/renderer/phaser/terrain/buildingArt';

const VALID_TINT = 0x7fb069;

/**
 * A building alight.
 *
 * The one warm tint in the settlement outside a forge, and applied over the
 * season's own — a fire in winter has to read as a fire and not as a slightly
 * odd house. Smoke does the rest; see `effects/HearthRenderer.ts`.
 */
const BURNING_TINT = 0xd97038;
const INVALID_TINT = 0xc0584a;

interface BuildingSprites {
  readonly body: Phaser.GameObjects.Image;
  readonly progress: Phaser.GameObjects.Graphics | null;
  complete: boolean;
}

export class BuildingRenderer {
  private readonly scene: Phaser.Scene;
  private readonly sprites = new Map<number, BuildingSprites>();
  private readonly ghostCells: Phaser.GameObjects.Image[] = [];
  private renderedVersion = -1;
  private renderedFillVersion = -1;
  /** Which fill each yard is drawn at, so a texture is only swapped when it moves. */
  private readonly fills = new Map<number, number>();
  /** Seasonal light, applied to buildings raised later as well. */
  private seasonTint = 0xffffff;
  private renderedPlacementVersion = -1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  public sync(buildings: BuildingRegistry, storages: StorageRegistry): void {
    this.syncBuildings(buildings);
    this.syncYardFills(buildings, storages);
  }

  /**
   * Puts the right amount of goods on every yard's deck.
   *
   * A separate pass on its own version counter, because a yard filling up is not
   * a change to the *buildings* — nothing is raised or pulled down — and the
   * building sync rightly does nothing when its version has not moved.
   *
   * A pure read of what each store holds. The simulation neither knows nor cares
   * that the picture changed.
   */
  private syncYardFills(buildings: BuildingRegistry, storages: StorageRegistry): void {
    if (this.renderedFillVersion === storages.version) {
      return;
    }
    this.renderedFillVersion = storages.version;

    for (const building of buildings.all) {
      if (!building.isComplete || building.storageId === null) {
        continue;
      }
      if (artVariants(building.definition.id) <= 1) {
        continue;
      }
      const sprites = this.sprites.get(building.id);
      const storage = storages.getById(building.storageId);
      if (!sprites || !storage) {
        continue;
      }
      const fill = yardFillVariant(storage.inventory.total);
      if (this.fills.get(building.id) === fill) {
        continue;
      }
      this.fills.set(building.id, fill);
      sprites.body.setTexture(TextureKeys.building(building.definition.id, fill));
    }
  }

  private syncBuildings(buildings: BuildingRegistry): void {
    if (this.renderedVersion === buildings.version) {
      return;
    }
    this.renderedVersion = buildings.version;

    const live = new Set<number>();
    for (const building of buildings.all) {
      // A finished bridge is drawn by the road renderer, because a finished
      // bridge *is* a road: it has to join the tracks on both banks and take
      // their corners, which a building sprite standing on its own plot cannot
      // do. While it is being built it is an ordinary site like any other.
      if (building.definition.crossing && building.isComplete) {
        continue;
      }
      live.add(building.id);
      const existing = this.sprites.get(building.id);

      if (!existing) {
        this.sprites.set(building.id, this.createSprites(building));
        continue;
      }

      // Alight, so it takes the fire's colour rather than the season's until it
      // is either put out or gone.
      existing.body.setTint(building.burning ? BURNING_TINT : this.seasonTint);

      if (existing.complete !== building.isComplete) {
        // The roof went on: swap the frame for the finished building.
        existing.body.destroy();
        existing.progress?.destroy();
        this.sprites.set(building.id, this.createSprites(building));
        continue;
      }

      this.drawProgress(existing, building);
    }

    for (const [id, sprites] of this.sprites) {
      if (!live.has(id)) {
        sprites.body.destroy();
        sprites.progress?.destroy();
        this.fills.delete(id);
        this.sprites.delete(id);
      }
    }
  }

  /** Redraws the ghost when the player moves it or changes building. */
  public syncGhost(placement: PlacementState | null, version: number): void {
    if (this.renderedPlacementVersion === version) {
      return;
    }
    this.renderedPlacementVersion = version;

    for (const cell of this.ghostCells) {
      cell.destroy();
    }
    this.ghostCells.length = 0;

    if (!placement) {
      return;
    }

    const { footprint } = buildingDefinition(placement.buildingId);
    const tint = placement.check.ok ? VALID_TINT : INVALID_TINT;

    for (let dy = 0; dy < footprint.height; dy += 1) {
      for (let dx = 0; dx < footprint.width; dx += 1) {
        const cell = { gx: placement.origin.gx + dx, gy: placement.origin.gy + dy };
        const position = gridToScene(cell);
        this.ghostCells.push(
          this.scene.add
            .image(position.px, position.py, TextureKeys.ghostCell)
            .setOrigin(0.5, 0.5)
            .setTint(tint)
            .setAlpha(0.75)
            // Above the world, so the ghost is never lost behind a tree.
            .setDepth(overlayDepth(cell.gx, cell.gy)),
        );
      }
    }
  }

  /** Tints every building for the season. */
  public applyTint(tint: number): void {
    this.seasonTint = tint;
    for (const sprites of this.sprites.values()) {
      sprites.body.setTint(tint);
    }
  }

  public destroy(): void {
    for (const sprites of this.sprites.values()) {
      sprites.body.destroy();
      sprites.progress?.destroy();
    }
    this.sprites.clear();
    for (const cell of this.ghostCells) {
      cell.destroy();
    }
    this.ghostCells.length = 0;
    this.renderedVersion = -1;
    this.renderedPlacementVersion = -1;
  }

  private createSprites(building: Building): BuildingSprites {
    const { footprint } = building.definition;
    const anchor = footprintCentre(building);
    const depth = depthForFootprint(
      building.origin.gx,
      building.origin.gy,
      footprint.width,
      footprint.height,
      RenderLayer.Structure,
    );

    const texture = building.isComplete
      ? TextureKeys.building(building.definition.id, styleFor(building))
      : TextureKeys.site;

    const body = this.scene.add
      .image(anchor.px, anchor.py, texture)
      // A building finished in winter stands in winter's light straight away —
      // and one that is alight when it is first drawn is alight, which happens
      // whenever a settlement is loaded mid-fire.
      .setTint(building.burning ? BURNING_TINT : this.seasonTint)
      // Anchored on the *drawn ground line*, not the bottom of the image, and
      // placed at the centre of the footprint. Anchoring at the image edge and
      // nudging by a guessed offset put buildings a whole tile from the cells
      // they occupy.
      .setOrigin(
        0.5,
        building.isComplete ? buildingGroundLine(building.definition.id) : SITE_GROUND_LINE,
      )
      .setDepth(depth);

    const sprites: BuildingSprites = {
      body,
      progress: building.isComplete
        ? null
        : this.scene.add.graphics().setDepth(overlayDepth(building.origin.gx, building.origin.gy)),
      complete: building.isComplete,
    };
    this.drawProgress(sprites, building);
    return sprites;
  }

  /** A two-part bar: materials delivered, then labour done. */
  private drawProgress(sprites: BuildingSprites, building: Building): void {
    const bar = sprites.progress;
    if (!bar || building.isComplete) {
      return;
    }

    const anchor = footprintCentre(building);
    const width = 44;
    const x = anchor.px - width / 2;
    const y = anchor.py - 54;

    const required = building.definition.constructionCost.reduce((t, c) => t + c.amount, 0);
    const delivered = required === 0 ? 1 : building.materials.total / required;
    const fraction = building.hasAllMaterials ? building.progress : delivered;
    // Amber while materials are still arriving, green once building has begun.
    const colour = building.hasAllMaterials ? 0x7fb069 : 0xc9a227;

    bar.clear();
    bar.fillStyle(0x14160f, 0.75);
    bar.fillRect(x - 1, y - 1, width + 2, 6);
    bar.fillStyle(colour, 1);
    bar.fillRect(x, y, Math.max(0, Math.min(1, fraction)) * width, 4);
  }
}

/**
 * The scene position of a footprint's centre, where its art belongs.
 *
 * Exported because the smoke has to start at the same point the building is
 * drawn from. Two independent versions of "where is this building" is exactly
 * how a plume ends up hanging beside its own chimney.
 */
export function footprintCentre(building: Building) {
  const { footprint } = building.definition;
  return worldToScene({
    wx: building.origin.gx + footprint.width / 2,
    wy: building.origin.gy + footprint.height / 2,
  });
}

/**
 * Which of a building's looks this one gets.
 *
 * **From its own id, so a village is not a row of identical houses** — and so
 * the same house is the same house after a reload, which a roll would not be.
 * The simulation is not consulted and nothing is stored: a building's id is
 * already saved, and this is a pure function of it.
 *
 * Yards are the exception: their variant is how full they are, and that is
 * chosen by `syncYardFills` from the store rather than here.
 */
function styleFor(building: Building): number {
  const looks = artVariants(building.definition.id);
  if (looks <= 1 || building.definition.storage) {
    return 0;
  }
  return building.id % looks;
}
