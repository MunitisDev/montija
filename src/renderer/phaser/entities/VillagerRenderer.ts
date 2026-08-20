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
import { hasInterior } from '@/renderer/phaser/terrain/buildingArt';
import { colourIndexFor, lookFor } from '@/shared/appearance';
import { RenderLayer, depthFor } from '@/renderer/phaser/sorting';
import { worldToScene } from '@/shared/math/isometric';
import type { WorldPoint } from '@/shared/types/geometry';
import type { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';
import type { Villager } from '@/simulation/villagers/Villager';

/**
 * How tall a villager is drawn, against the 48px the art is drawn at.
 *
 * **Two thirds, and it is the buildings this is for.** A grown villager stood
 * about as tall as a cottage door was wide, which put people and houses on the
 * same footing — and the art bible is most insistent about the opposite: the
 * settlement is the subject and people are what make it live. At two thirds an
 * adult is about the size the *children* used to be and a child is smaller
 * again, which is the scale a diorama has.
 *
 * Done by scaling the sprite rather than by redrawing the figures smaller. The
 * art keeps its 48px detail — a hood, a stoop, a staff, a sack — and gives it up
 * gradually as the player zooms out, which is what every other sprite in the
 * scene already does.
 */
const VILLAGER_DRAW_SCALE = 2 / 3;

/**
 * Seconds a villager takes to fade through a doorway.
 *
 * Quick enough to read as "she went in" rather than as a sprite dissolving, slow
 * enough that the eye follows her through it. Real seconds, not simulation ones:
 * a door does not open four times faster at 4x.
 */
const DOORWAY_FADE_SECONDS = 0.22;

export class VillagerRenderer {
  private readonly scene: Phaser.Scene;
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>();
  /** The frame each sprite is showing, so an unchanged one is left alone. */
  private readonly frames = new Map<number, string>();
  /**
   * How far inside a building each villager is, `0` outside and `1` out of sight.
   *
   * Presentation state, and the only state this file keeps: the simulation has a
   * villager standing at a doorway working, and whether that reads as *at* the
   * door or *through* it is a question about pictures.
   */
  private readonly indoors = new Map<number, number>();
  /** Seasonal light, applied to new arrivals as well as everyone present. */
  private seasonTint = 0xffffff;
  private readonly selectionRing: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.selectionRing = scene.add
      .image(0, 0, TextureKeys.villagerRing)
      .setOrigin(0.5, 0.5)
      // Shrunk with the people it goes round. A ring drawn for a figure half
      // again this tall reads as a marker on the ground beside somebody rather
      // than as a ring around them.
      .setScale(VILLAGER_DRAW_SCALE)
      .setVisible(false);
  }

  /**
   * Syncs sprites to the villager list.
   *
   * @param alpha progress through the pending tick, in `[0, 1)`
   * @param selectedId villager to highlight, if any
   */
  public sync(options: {
    readonly villagers: readonly Villager[];
    readonly alpha: number;
    readonly selectedId: number | null;
    readonly buildings: BuildingRegistry;
    readonly deltaSeconds: number;
  }): void {
    const { villagers, alpha, selectedId, buildings, deltaSeconds } = options;
    const live = new Set<number>();
    const step = deltaSeconds / DOORWAY_FADE_SECONDS;

    for (const villager of villagers) {
      live.add(villager.id);
      const sprite = this.spriteFor(villager);

      // A birthday can change the figure: a child becomes a woman, a woman an
      // elder. Compared rather than set, because setting a texture every frame
      // for three hundred sprites is work for nothing.
      const frame = TextureKeys.villagerFrame(
        lookFor(villager),
        colourIndexFor(villager),
        villager.inventory.total > 0,
      );
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

      // **Through the door, not stood in the corner of it.** Somebody working
      // inside a workshop was drawn at its doorway, which read as a person
      // waiting outside a building rather than as a person working in one — and
      // with four of them at one hut it read as a queue. They now fade out as
      // they arrive and back in as they leave.
      const inside = worksInside(villager, buildings) ? 1 : 0;
      const was = this.indoors.get(villager.id) ?? 0;
      const now = inside > was ? Math.min(inside, was + step) : Math.max(inside, was - step);
      if (now !== was) {
        this.indoors.set(villager.id, now);
      }
      sprite.setAlpha(1 - now);
      sprite.setVisible(now < 1);

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
        this.indoors.delete(id);
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
    this.indoors.clear();
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
      .setDisplaySize(
        (VILLAGER_HEIGHT / 2) * VILLAGER_DRAW_SCALE,
        VILLAGER_HEIGHT * VILLAGER_DRAW_SCALE,
      )
      // Someone born in winter arrives in winter's light, not summer's.
      .setTint(this.seasonTint);
    this.sprites.set(villager.id, sprite);
    return sprite;
  }
}

/**
 * `true` when this villager is at work *within* a building.
 *
 * Three things at once, and each of them is load-bearing:
 *
 * - **working**, not walking or hauling — somebody delivering a load to a
 *   workshop is at the door for a moment and should be seen doing it;
 * - **at their own workshop's door**, because a feller employed by a hut spends
 *   his day out in the wood with an axe, and making him vanish under a tree
 *   would be worse than the problem this fixes;
 * - **and that building has an interior.** A farmhand works her field standing
 *   in it. See `hasInterior`.
 */
function worksInside(villager: Villager, buildings: BuildingRegistry): boolean {
  if (villager.activity !== 'working' || villager.employerId === null) {
    return false;
  }
  const building = buildings.getById(villager.employerId);
  if (!building?.isComplete || !hasInterior(building.definition.id)) {
    return false;
  }
  const at = building.accessCell;
  const cell = villager.cell;
  return at.gx === cell.gx && at.gy === cell.gy;
}

function interpolate(from: WorldPoint, to: WorldPoint, alpha: number): WorldPoint {
  return {
    wx: from.wx + (to.wx - from.wx) * alpha,
    wy: from.wy + (to.wy - from.wy) * alpha,
  };
}
