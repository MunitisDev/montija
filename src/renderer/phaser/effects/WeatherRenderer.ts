/**
 * Weather and ambient light.
 *
 * The half of the seasons the ground cannot carry. Repainting the grass says
 * *what month it is*; rain on the spring mud and snow falling through a winter
 * settlement is what makes the place feel cold enough to worry about, which is
 * the point of a game about surviving a winter.
 *
 * Per the art bible:
 *
 * | Season | Effects            |
 * | ------ | ------------------ |
 * | Spring | Rain, mist         |
 * | Summer | Haze               |
 * | Autumn | Mist               |
 * | Winter | Snowfall           |
 *
 * Everything here is screen-space and fixed to the camera. Precipitation drawn
 * in world space would need thousands of objects to cover a zoomed-out map and
 * would thin out as the player zoomed in, which is backwards: weather is
 * between the viewer and the world, not scattered across the terrain.
 *
 * **`setScrollFactor(0)` is only half of "screen-space".** It pins an object
 * against the camera's *scroll*; the camera's *zoom* still scales it. So a
 * viewport-sized rectangle covered the screen at 1x and shrank to a lit
 * rectangle floating in the middle of the map as the player zoomed out — which
 * is exactly what it looked like, and what {@link syncToCamera} exists to undo.
 */

import type Phaser from 'phaser';

import { ambientLight } from '@/renderer/phaser/terrain/seasonalPalette';
import type { Season } from '@/simulation/seasons/SeasonClock';

/** How many particles each kind of weather uses. */
const PARTICLE_COUNT: Readonly<Record<Season, number>> = {
  spring: 90,
  summer: 0,
  autumn: 0,
  winter: 130,
};

interface Particle {
  x: number;
  y: number;
  /** Pixels per second. */
  speed: number;
  drift: number;
  size: number;
  alpha: number;
}

/**
 * Depth for full-screen atmosphere.
 *
 * Above every world object and below the player's own overlays, so weather
 * never hides an order the player has just given.
 */
const WEATHER_DEPTH = 900_000;

/**
 * Where to put a screen-space overlay so the camera's zoom cannot move it.
 *
 * For an object with `scrollFactor` 0, the camera still renders it at
 * `centre + (position - centre) * zoom`. Scaling by `1 / zoom` makes a local
 * point `p` land at `centre + (position - centre) * zoom + p`, so putting the
 * object at `centre * (1 - 1 / zoom)` cancels the first term exactly and `p`
 * renders at `p` — at any zoom.
 *
 * Pulled out as a pure function because it is one line of algebra that is
 * completely invisible when it is wrong: the failure it fixes was a lit
 * rectangle sitting in the middle of a zoomed-out map, and nothing but a test
 * would notice it coming back.
 */
export function screenSpaceTransform(camera: {
  readonly zoom: number;
  readonly centerX: number;
  readonly centerY: number;
}): { scale: number; x: number; y: number } {
  // A camera with zero zoom draws nothing at all, but it must not produce a
  // NaN position that survives into the next frame.
  const zoom = camera.zoom === 0 ? 1 : camera.zoom;
  const scale = 1 / zoom;
  return {
    scale,
    x: camera.centerX * (1 - scale),
    y: camera.centerY * (1 - scale),
  };
}

export class WeatherRenderer {
  private readonly ambient: Phaser.GameObjects.Rectangle;
  private readonly precipitation: Phaser.GameObjects.Graphics;
  private readonly particles: Particle[] = [];
  private season: Season | null = null;
  private width = 0;
  private height = 0;

  constructor(scene: Phaser.Scene) {
    const { width, height } = scene.scale;
    this.width = width;
    this.height = height;

    // Fixed to the camera: this is light on the lens, not paint on the world.
    this.ambient = scene.add
      .rectangle(0, 0, width, height, 0xffffff, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(WEATHER_DEPTH);

    this.precipitation = scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(WEATHER_DEPTH + 1);
  }

  /** Cancels the camera's zoom, so the overlay always covers exactly the screen. */
  public syncToCamera(camera: Phaser.Cameras.Scene2D.Camera): void {
    const { scale, x, y } = screenSpaceTransform(camera);
    this.ambient.setScale(scale).setPosition(x, y);
    this.precipitation.setScale(scale).setPosition(x, y);
  }

  /** Resizes the overlay to a new viewport. */
  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.ambient.setSize(width, height);
    // Particles outside the new viewport would never be seen again.
    for (const particle of this.particles) {
      particle.x = Math.min(particle.x, width);
      particle.y = Math.min(particle.y, height);
    }
  }

  /**
   * Advances the weather.
   *
   * @param season what the settlement is living through
   * @param deltaSeconds real elapsed time, so weather runs at wall-clock speed
   *   rather than simulation speed — rain does not fall four times faster
   *   because the player pressed 4x
   * @param random a value in `[0, 1)`; taken as an argument rather than called
   *   here so this stays free of `Math.random` like everything else
   */
  public update(season: Season, deltaSeconds: number, random: () => number): void {
    if (season !== this.season) {
      this.season = season;
      this.rebuild(season, random);
    }

    if (this.particles.length === 0) {
      return;
    }

    this.step(deltaSeconds, random);
    this.draw(season);
  }

  private rebuild(season: Season, random: () => number): void {
    const light = ambientLight(season);
    this.ambient.setFillStyle(light.colour, light.alpha);

    const wanted = PARTICLE_COUNT[season];
    this.particles.length = 0;
    this.precipitation.clear();

    for (let i = 0; i < wanted; i += 1) {
      this.particles.push(this.spawn(season, random, random() * this.height));
    }
  }

  private spawn(season: Season, random: () => number, y: number): Particle {
    const isSnow = season === 'winter';
    return {
      x: random() * this.width,
      y,
      // Snow drifts down; rain falls hard. The difference is most of what makes
      // one read as cold and the other as wet.
      speed: isSnow ? 22 + random() * 26 : 420 + random() * 260,
      drift: isSnow ? -14 + random() * 28 : -30 - random() * 20,
      size: isSnow ? 1.2 + random() * 1.8 : 1,
      alpha: isSnow ? 0.35 + random() * 0.45 : 0.18 + random() * 0.22,
    };
  }

  private step(deltaSeconds: number, random: () => number): void {
    // Clamped: after a stall, weather should resume rather than teleport a
    // screenful of snow past the player in a single frame.
    const delta = Math.min(deltaSeconds, 0.1);

    for (const particle of this.particles) {
      particle.y += particle.speed * delta;
      particle.x += particle.drift * delta;

      if (particle.y > this.height) {
        particle.y = -4;
        particle.x = random() * this.width;
      }
      if (particle.x < -8) {
        particle.x = this.width + 4;
      } else if (particle.x > this.width + 8) {
        particle.x = -4;
      }
    }
  }

  private draw(season: Season): void {
    this.precipitation.clear();

    if (season === 'winter') {
      for (const particle of this.particles) {
        this.precipitation.fillStyle(0xe8eef2, particle.alpha);
        this.precipitation.fillCircle(particle.x, particle.y, particle.size);
      }
      return;
    }

    // Rain is drawn as a streak along its own direction of travel, which is
    // what makes it read as falling rather than as a field of dots.
    for (const particle of this.particles) {
      this.precipitation.lineStyle(1, 0xb9cbd6, particle.alpha);
      this.precipitation.lineBetween(
        particle.x,
        particle.y,
        particle.x - particle.drift * 0.03,
        particle.y - particle.speed * 0.03,
      );
    }
  }

  public destroy(): void {
    this.ambient.destroy();
    this.precipitation.destroy();
    this.particles.length = 0;
  }
}
