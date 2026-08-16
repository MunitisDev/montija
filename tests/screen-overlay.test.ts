/**
 * Screen-space overlays under a zooming camera.
 *
 * `setScrollFactor(0)` pins an object against the camera's *scroll*; the
 * camera's *zoom* still scales it. A viewport-sized rectangle therefore covered
 * the screen at 1x and shrank into a lit rectangle floating in the middle of
 * the map as the player zoomed out — which is what the weather wash did, on a
 * real phone, for as long as weather has existed.
 *
 * The fix is four lines of algebra, and algebra is exactly the kind of thing
 * that silently comes back wrong. This checks it by simulating the camera's own
 * transform and asserting the overlay lands on the viewport at every zoom.
 */

import { describe, expect, it } from 'vitest';
import { screenSpaceTransform } from '@/renderer/phaser/effects/WeatherRenderer';
import { ZOOM_LIMITS } from '@/app/config';

/** What Phaser does to an object with `scrollFactor` 0. */
function render(
  camera: { zoom: number; centerX: number; centerY: number },
  transform: { scale: number; x: number; y: number },
  local: { x: number; y: number },
): { x: number; y: number } {
  const worldX = transform.x + local.x * transform.scale;
  const worldY = transform.y + local.y * transform.scale;
  return {
    x: camera.centerX + (worldX - camera.centerX) * camera.zoom,
    y: camera.centerY + (worldY - camera.centerY) * camera.zoom,
  };
}

describe('screenSpaceTransform', () => {
  const width = 1280;
  const height = 720;
  const camera = (zoom: number) => ({ zoom, centerX: width / 2, centerY: height / 2 });

  it('covers exactly the viewport at every zoom the player can reach', () => {
    for (const zoom of [ZOOM_LIMITS.min, 0.5, 1, 1.7, ZOOM_LIMITS.max]) {
      const view = camera(zoom);
      const transform = screenSpaceTransform(view);

      const topLeft = render(view, transform, { x: 0, y: 0 });
      const bottomRight = render(view, transform, { x: width, y: height });

      expect(topLeft.x, `zoom ${zoom}`).toBeCloseTo(0, 6);
      expect(topLeft.y, `zoom ${zoom}`).toBeCloseTo(0, 6);
      expect(bottomRight.x, `zoom ${zoom}`).toBeCloseTo(width, 6);
      expect(bottomRight.y, `zoom ${zoom}`).toBeCloseTo(height, 6);
    }
  });

  it('is the identity at 1x, so nothing moved that did not need to', () => {
    const transform = screenSpaceTransform(camera(1));
    expect(transform).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('grows the overlay as the camera zooms out', () => {
    // The regression in one line: zoomed out, the overlay has to get *bigger*
    // in world units to keep covering the same screen.
    expect(screenSpaceTransform(camera(0.35)).scale).toBeGreaterThan(1);
    expect(screenSpaceTransform(camera(2.5)).scale).toBeLessThan(1);
  });

  it('never produces a NaN position', () => {
    const transform = screenSpaceTransform(camera(0));
    expect(Number.isFinite(transform.scale)).toBe(true);
    expect(Number.isFinite(transform.x)).toBe(true);
    expect(Number.isFinite(transform.y)).toBe(true);
  });
});
