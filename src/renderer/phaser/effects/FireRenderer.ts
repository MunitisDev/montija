/**
 * The flames on a building that is alight.
 *
 * **A house on fire used to be a house painted orange.** Tinting the sprite was
 * the cheapest possible signal and it read as a rendering fault rather than as a
 * fire — the building kept its shape, its roof, its quiet, and simply changed
 * colour. What a fire looks like is *movement*: tongues of flame standing up off
 * the roof, guttering at different rates, with the light they throw on the
 * thatch under them. The dark smoke above is drawn by `HearthRenderer`, which
 * already knows how to make a plume; this file draws what the plume comes from.
 *
 * **Sorted like the roof it stands on**, not in the sky band the smoke uses. A
 * flame is attached to one building and stays there, so a house in front must
 * cover it exactly as it covers the roof — which means one `Graphics` per fire
 * at that building's own depth. There are never more than a handful: the fire
 * system lights at most one building a day and stops while anything is still
 * alight.
 *
 * Presentation only, and pure of the simulation in the strong sense: the
 * flicker is a function of elapsed real seconds and the building's id, so it
 * needs no random source at all. Nothing here can move a villager, and a
 * settlement replayed from its seed burns identically whatever the frame rate
 * was.
 */

import type Phaser from 'phaser';

import { footprintCentre } from '@/renderer/phaser/entities/BuildingRenderer';
import { RenderLayer, depthForFootprint } from '@/renderer/phaser/sorting';
import { roofSpan } from '@/renderer/phaser/terrain/buildingArt';
import type { Building } from '@/simulation/buildings/Building';
import type { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';

/** How many tongues one fire is drawn with. */
const TONGUES = 5;

/** The body of the flame: deep and red, where the fire is thickest. */
const EMBER = 0xb2401b;

/** The middle of it. */
const FLAME = 0xdd7a24;

/** And the heart, which is the only genuinely bright colour in the game. */
const CORE = 0xf3ca62;

/** The light a fire throws on the roof it is eating. */
const GLOW = 0xffb457;

/** Tallest a tongue stands above its base, in pixels. */
const TONGUE_HEIGHT = 31;

/** How fast the flames gutter, in cycles a second. */
const FLICKER_RATE = 3.1;

/** One fire, and where it is drawn. */
interface Blaze {
  readonly graphics: Phaser.GameObjects.Graphics;
  /** Scene-space middle of the roof. */
  readonly x: number;
  readonly y: number;
  /** How far the tongues spread either side, in pixels. */
  readonly spread: number;
  /** Fixed per building, so two fires never gutter in step. */
  readonly phase: number;
}

export class FireRenderer {
  private readonly scene: Phaser.Scene;
  private readonly blazes = new Map<number, Blaze>();
  private renderedVersion = -1;
  private elapsed = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Rebuilds the list of fires when the settlement changes. */
  public sync(buildings: BuildingRegistry): void {
    if (this.renderedVersion === buildings.version) {
      return;
    }
    this.renderedVersion = buildings.version;

    const live = new Set<number>();
    for (const building of buildings.all) {
      if (!building.burning) {
        continue;
      }
      live.add(building.id);
      if (!this.blazes.has(building.id)) {
        this.blazes.set(building.id, this.light(building));
      }
    }

    for (const [id, blaze] of [...this.blazes]) {
      if (!live.has(id)) {
        blaze.graphics.destroy();
        this.blazes.delete(id);
      }
    }
  }

  /** Guts the flames for one frame. Does nothing at all when nothing is alight. */
  public update(deltaSeconds: number): void {
    if (this.blazes.size === 0) {
      return;
    }
    this.elapsed += deltaSeconds;
    for (const blaze of this.blazes.values()) {
      this.draw(blaze);
    }
  }

  public destroy(): void {
    for (const blaze of this.blazes.values()) {
      blaze.graphics.destroy();
    }
    this.blazes.clear();
  }

  private light(building: Building): Blaze {
    const anchor = footprintCentre(building);
    const roof = roofSpan(building.definition.id);
    const { footprint } = building.definition;
    return {
      graphics: this.scene.add.graphics().setDepth(
        // The Effect layer of the building's own front cell: over its roof,
        // under anything standing between it and the camera.
        depthForFootprint(
          building.origin.gx,
          building.origin.gy,
          footprint.width,
          footprint.height,
          RenderLayer.Effect,
        ),
      ),
      x: anchor.px,
      y: anchor.py + roof.dy,
      spread: roof.halfWidth * 0.62,
      // Derived from the id rather than rolled, so a fire looks the same after
      // a reload — and so nothing here ever touches a random source.
      phase: (building.id % 7) * 0.9,
    };
  }

  /**
   * One fire, drawn from the glow up.
   *
   * Each tongue is a four-point sliver rather than a triangle: a flame narrows
   * to a point at the top but has a *waist* below it, and the waist is the whole
   * difference between fire and bunting. The heart is the same shape at two
   * thirds the height, which is what gives the colour its gradient without a
   * gradient.
   */
  private draw(blaze: Blaze): void {
    const { graphics, x, y, spread, phase } = blaze;
    graphics.clear();

    // The light on the roof, first and largest, pulsing slowly under everything.
    const pulse = 0.78 + 0.22 * Math.sin(this.elapsed * 1.7 + phase);
    graphics.fillStyle(GLOW, 0.2 * pulse);
    graphics.fillEllipse(x, y + 8, spread * 3.4, spread * 1.5);

    for (let index = 0; index < TONGUES; index += 1) {
      // Spread across the roof, tallest in the middle: a fire has a shape, and
      // five equal tongues in a row read as a railing.
      const across = (index / (TONGUES - 1)) * 2 - 1;
      const base = x + across * spread;
      const foot = y - Math.abs(across) * 3;
      const middling = 1 - Math.abs(across) * 0.42;

      const gutter = Math.sin(this.elapsed * FLICKER_RATE + phase + index * 1.7);
      const height = TONGUE_HEIGHT * middling * (0.62 + 0.38 * (gutter * 0.5 + 0.5));
      // The tip leans with the same wind the smoke drifts on.
      const lean = 2.4 + gutter * 1.6;
      const width = 5.4 * middling;

      tongue(graphics, EMBER, base, foot, height, width, lean);
      tongue(graphics, FLAME, base, foot, height * 0.74, width * 0.68, lean * 0.8);
      tongue(graphics, CORE, base, foot, height * 0.4, width * 0.34, lean * 0.5);
    }
  }
}

/** One sliver of flame, from its foot to its leaning tip. */
function tongue(
  graphics: Phaser.GameObjects.Graphics,
  colour: number,
  x: number,
  y: number,
  height: number,
  width: number,
  lean: number,
): void {
  graphics.fillStyle(colour, 1);
  graphics.beginPath();
  graphics.moveTo(x - width, y);
  // The waist, a third of the way up and pinched in.
  graphics.lineTo(x - width * 0.42 + lean * 0.3, y - height * 0.46);
  graphics.lineTo(x + lean, y - height);
  graphics.lineTo(x + width * 0.52 + lean * 0.3, y - height * 0.4);
  graphics.lineTo(x + width, y);
  graphics.closePath();
  graphics.fillPath();
}
