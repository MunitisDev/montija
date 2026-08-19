/**
 * Every good the settlement can drop has its own heap, and it fits its sprite.
 *
 * **There used to be two heaps for nine goods**, and everything that was not
 * stone was drawn as timber. A player sent a screenshot of a stalled settlement
 * asking why there was so much material lying about; three hundred and sixty of
 * it was food and a hundred and thirty was firewood, and all of it looked like a
 * scatter of logs. The piles are the visible half of this game's core resource
 * rule — what is on the ground is genuinely there until somebody carries it away
 * — and a rule the player cannot read is not doing its job.
 *
 * This runs headless, with a `Graphics` that draws nothing and remembers where it
 * was asked to draw, so the claims are about geometry rather than about pixels.
 */

import { describe, expect, it } from 'vitest';

import { RESOURCE_IDS } from '@/data/resources';
import { PILE_HEIGHT } from '@/renderer/phaser/terrain/tileTextures';
import { drawPile } from '@/renderer/phaser/terrain/pileArt';
import { TILE_WIDTH } from '@/shared/math/isometric';

/** A `Graphics` that draws nothing and remembers everywhere it was asked to. */
class Recorder {
  public minX = Infinity;
  public maxX = -Infinity;
  public minY = Infinity;
  public maxY = -Infinity;
  public calls = 0;

  public fillStyle(): void {}
  public lineStyle(): void {}
  public beginPath(): void {}
  public closePath(): void {}
  public fillPath(): void {}
  public strokePath(): void {}

  public moveTo(x: number, y: number): void {
    this.see(x, y);
  }

  public lineTo(x: number, y: number): void {
    this.see(x, y);
  }

  public fillRect(x: number, y: number, width: number, height: number): void {
    this.see(x, y);
    this.see(x + width, y + height);
  }

  public fillCircle(x: number, y: number, radius: number): void {
    this.see(x - radius, y - radius);
    this.see(x + radius, y + radius);
  }

  public fillEllipse(x: number, y: number, width: number, height: number): void {
    this.see(x - width / 2, y - height / 2);
    this.see(x + width / 2, y + height / 2);
  }

  private see(x: number, y: number): void {
    this.calls += 1;
    this.minX = Math.min(this.minX, x);
    this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);
  }
}

const BOX = { width: TILE_WIDTH, height: PILE_HEIGHT };

function draw(resource: (typeof RESOURCE_IDS)[number]): Recorder {
  const recorder = new Recorder();
  drawPile(recorder as never, resource, BOX);
  return recorder;
}

describe('the heaps on the ground', () => {
  it('gives every good one of its own', () => {
    for (const resource of RESOURCE_IDS) {
      const bounds = draw(resource);
      expect(bounds.calls, `${resource} draws nothing`).toBeGreaterThan(0);
    }
  });

  it('draws inside the sprite it is given', () => {
    // A heap that overruns its texture is clipped, and a clipped heap reads as a
    // different shape at one zoom than another.
    for (const resource of RESOURCE_IDS) {
      const bounds = draw(resource);
      expect(bounds.minX, `${resource} runs off the left`).toBeGreaterThanOrEqual(0);
      expect(bounds.maxX, `${resource} runs off the right`).toBeLessThanOrEqual(BOX.width);
      expect(bounds.minY, `${resource} runs off the top`).toBeGreaterThanOrEqual(0);
      expect(bounds.maxY, `${resource} runs off the bottom`).toBeLessThanOrEqual(BOX.height);
    }
  });

  it('stands on the ground line rather than floating above it', () => {
    // Sprites are anchored at the base, so a heap that stops short of the bottom
    // of its box hovers over the tile.
    for (const resource of RESOURCE_IDS) {
      const bounds = draw(resource);
      expect(bounds.maxY, `${resource} floats`).toBeGreaterThan(BOX.height - 6);
    }
  });

  it('gives no two goods the same silhouette', () => {
    // The claim is weak on purpose — geometry cannot tell a basket from a
    // barrel — but two heaps with identical bounds *are* the same drawing, which
    // is exactly the bug this set of sprites was written to fix.
    const seen = new Map<string, string>();
    for (const resource of RESOURCE_IDS) {
      const bounds = draw(resource);
      const shape = [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, bounds.calls].join('/');
      expect(seen.has(shape), `${resource} is drawn like ${seen.get(shape)}`).toBe(false);
      seen.set(shape, resource);
    }
  });
});
