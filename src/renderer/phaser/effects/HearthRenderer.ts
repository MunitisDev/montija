/**
 * Smoke leaving the settlement's chimneys.
 *
 * A thin renderer over {@link advanceSmoke}, which owns the behaviour. This
 * file decides where the fires are, what colour smoke is, and when to stop
 * drawing it.
 *
 * **Drawn in the world, not on the lens.** The weather overlay is fixed to the
 * camera because rain is on the glass; smoke belongs to a particular roof and
 * has to pan and zoom with it. That also means it needs a depth, and it takes
 * one above every building — a plume passing behind the house it came out of
 * would be worse than no plume at all.
 */

import type Phaser from 'phaser';

import { SKY_BAND } from '@/renderer/phaser/sorting';
import { footprintCentre } from '@/renderer/phaser/entities/BuildingRenderer';
import { chimneyMouth } from '@/renderer/phaser/terrain/buildingArt';
import type { BuildingRegistry } from '@/simulation/buildings/BuildingRegistry';
import type { Season } from '@/simulation/seasons/SeasonClock';
import {
  MAX_PARTICLES,
  advanceSmoke,
  emissionInterval,
  emit,
  puffAlpha,
  puffRadius,
  type SmokeParticle,
} from './smoke';

/**
 * Above every roof.
 *
 * Smoke drifts downwind across other buildings, so sorting it by the cell it
 * came from would put a plume behind the house in front of its own chimney.
 * `SKY_BAND` is the sorting module's sanctioned band for exactly that.
 */
const SMOKE_DEPTH = SKY_BAND;

/** Wood smoke: pale, warm, and never white. */
const SMOKE_COLOUR = 0xb9b3a4;

/**
 * How far off screen a fire keeps burning.
 *
 * Chimneys outside the view are skipped entirely rather than simulated
 * invisibly — but with a margin, so a plume is already established when a house
 * pans into shot instead of starting from nothing in front of the player.
 */
const OFF_SCREEN_MARGIN = 260;

interface Hearth {
  /** Scene-space position of the chimney lip. */
  readonly x: number;
  readonly y: number;
  /** Seconds until this chimney's next puff. */
  countdown: number;
}

export class HearthRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly hearths = new Map<number, Hearth>();
  private readonly particles: SmokeParticle[] = [];
  private renderedVersion = -1;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(SMOKE_DEPTH);
  }

  /** Rebuilds the list of fires when the settlement changes. */
  public sync(buildings: BuildingRegistry): void {
    if (this.renderedVersion === buildings.version) {
      return;
    }
    this.renderedVersion = buildings.version;

    const live = new Set<number>();
    for (const building of buildings.all) {
      // An unfinished building has no fire in it. Smoke rising from a
      // half-built shell would tell the player it was working.
      if (!building.isComplete) {
        continue;
      }
      const mouth = chimneyMouth(building.definition.id);
      if (!mouth) {
        continue;
      }

      live.add(building.id);
      if (this.hearths.has(building.id)) {
        continue;
      }

      const anchor = footprintCentre(building);
      this.hearths.set(building.id, {
        x: anchor.px + mouth.dx,
        y: anchor.py + mouth.dy,
        countdown: 0,
      });
    }

    for (const id of [...this.hearths.keys()]) {
      if (!live.has(id)) {
        this.hearths.delete(id);
      }
    }
  }

  /**
   * Advances and redraws every plume.
   *
   * `random` is the presentation stream. Smoke must never be able to move a
   * villager, so it never touches a simulation source.
   */
  public update(options: {
    readonly season: Season;
    readonly deltaSeconds: number;
    readonly camera: Phaser.Cameras.Scene2D.Camera;
    readonly random: () => number;
  }): void {
    const { season, deltaSeconds, camera, random } = options;
    const interval = emissionInterval(season);
    const view = camera.worldView;

    for (const hearth of this.hearths.values()) {
      hearth.countdown -= deltaSeconds;
      if (hearth.countdown > 0) {
        continue;
      }
      // Reset before the visibility test, so an off-screen fire does not build
      // up a debt of puffs and then fire them all at once when it pans in.
      hearth.countdown = interval;

      const visible =
        hearth.x > view.x - OFF_SCREEN_MARGIN &&
        hearth.x < view.right + OFF_SCREEN_MARGIN &&
        hearth.y > view.y - OFF_SCREEN_MARGIN &&
        hearth.y < view.bottom + OFF_SCREEN_MARGIN;
      if (!visible || this.particles.length >= MAX_PARTICLES) {
        continue;
      }

      this.particles.push(emit(hearth.x, hearth.y, random));
    }

    advanceSmoke(this.particles, deltaSeconds);
    this.draw();
  }

  public destroy(): void {
    this.graphics.destroy();
    this.particles.length = 0;
    this.hearths.clear();
  }

  private draw(): void {
    this.graphics.clear();
    for (const particle of this.particles) {
      this.graphics.fillStyle(SMOKE_COLOUR, puffAlpha(particle));
      this.graphics.fillCircle(particle.x, particle.y, puffRadius(particle));
    }
  }
}
