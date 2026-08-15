import { describe, expect, it } from 'vitest';
import { CameraController, type CameraLimits } from '@/renderer/camera/CameraController';

const LIMITS: CameraLimits = {
  minZoom: 0.5,
  maxZoom: 4,
  bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
};

const VIEWPORT = { width: 400, height: 300 };

function makeCamera(zoom = 1): CameraController {
  return new CameraController({
    limits: LIMITS,
    viewport: VIEWPORT,
    initialZoom: zoom,
    initialCentre: { wx: 500, wy: 500 },
  });
}

describe('CameraController', () => {
  it('starts centred on the world when no centre is given', () => {
    const camera = new CameraController({ limits: LIMITS, viewport: VIEWPORT });

    expect(camera.view.centreX).toBe(500);
    expect(camera.view.centreY).toBe(500);
  });

  describe('panning', () => {
    it('moves the world with the gesture', () => {
      const camera = makeCamera();

      // Dragging right moves the camera left, so the world follows the finger.
      camera.panByScreenDelta(50, 20);

      expect(camera.view.centreX).toBe(450);
      expect(camera.view.centreY).toBe(480);
    });

    it('pans further in world units when zoomed out', () => {
      const camera = makeCamera(0.5);

      camera.panByScreenDelta(50, 0);

      // 50 screen px at 0.5 zoom is 100 world units.
      expect(camera.view.centreX).toBe(400);
    });

    it('keeps the view inside the world bounds', () => {
      const camera = makeCamera();

      camera.panByScreenDelta(10_000, 10_000);

      // Half a 400x300 viewport at zoom 1 is 200x150 of margin.
      expect(camera.view.centreX).toBe(200);
      expect(camera.view.centreY).toBe(150);
    });

    it('centres on the world when it is smaller than the viewport', () => {
      const camera = new CameraController({
        limits: LIMITS,
        viewport: { width: 4000, height: 4000 },
      });

      camera.panByScreenDelta(-9999, -9999);

      expect(camera.view.centreX).toBe(500);
      expect(camera.view.centreY).toBe(500);
    });
  });

  describe('zooming', () => {
    it('respects the zoom limits', () => {
      const camera = makeCamera();

      camera.zoomBy(100);
      camera.update(1);
      expect(camera.zoom).toBeLessThanOrEqual(LIMITS.maxZoom);

      camera.zoomBy(0.0001);
      camera.update(1);
      expect(camera.zoom).toBeGreaterThanOrEqual(LIMITS.minZoom);
    });

    it('keeps the anchored world point under the cursor', () => {
      const camera = makeCamera();
      const anchor = { sx: 320, sy: 90 };
      const before = camera.viewportToWorld(anchor);

      camera.zoomBy(2, anchor);

      const after = camera.viewportToWorld(anchor);
      expect(after.wx).toBeCloseTo(before.wx, 4);
      expect(after.wy).toBeCloseTo(before.wy, 4);
    });

    it('eases towards the target when no anchor is given', () => {
      const camera = makeCamera();

      camera.zoomBy(2);

      // Smooth zoom: the change is not applied instantly.
      expect(camera.zoom).toBe(1);

      camera.update(1);
      expect(camera.zoom).toBeGreaterThan(1);
      expect(camera.zoom).toBeLessThanOrEqual(2);
    });

    it('settles exactly on the target zoom', () => {
      const camera = makeCamera();

      camera.setZoom(2);
      for (let i = 0; i < 60; i += 1) {
        camera.update(1 / 60);
      }

      expect(camera.zoom).toBe(2);
      expect(camera.isSettling).toBe(false);
    });

    it('applies an immediate zoom when asked', () => {
      const camera = makeCamera();

      camera.setZoom(3, true);

      expect(camera.zoom).toBe(3);
    });
  });

  describe('inertia', () => {
    it('keeps drifting after a flick', () => {
      const camera = makeCamera();
      const startX = camera.view.centreX;

      camera.flick(-600, 0);
      camera.update(0.1);

      expect(camera.view.centreX).toBeGreaterThan(startX);
    });

    it('comes to a stop on its own', () => {
      const camera = makeCamera();

      camera.flick(-600, 300);
      for (let i = 0; i < 120; i += 1) {
        camera.update(1 / 60);
      }

      expect(camera.isSettling).toBe(false);
    });

    it('stops immediately when a new gesture starts', () => {
      const camera = makeCamera();

      camera.flick(-600, 0);
      camera.stopMotion();
      const restingX = camera.view.centreX;
      camera.update(0.5);

      expect(camera.view.centreX).toBe(restingX);
    });

    it('does not drift outside the world bounds', () => {
      const camera = makeCamera();

      camera.flick(-100_000, -100_000);
      for (let i = 0; i < 240; i += 1) {
        camera.update(1 / 60);
      }

      expect(camera.view.centreX).toBeLessThanOrEqual(1000 - VIEWPORT.width / 2);
      expect(camera.view.centreY).toBeLessThanOrEqual(1000 - VIEWPORT.height / 2);
    });
  });

  describe('coordinate conversion', () => {
    it('maps the viewport centre to the camera centre', () => {
      const camera = makeCamera();

      const world = camera.viewportToWorld({ sx: 200, sy: 150 });

      expect(world.wx).toBe(500);
      expect(world.wy).toBe(500);
    });

    it('round-trips world -> viewport -> world', () => {
      const camera = makeCamera(1.75);
      const original = { wx: 512.5, wy: 437.25 };

      const roundTripped = camera.viewportToWorld(camera.worldToViewport(original));

      expect(roundTripped.wx).toBeCloseTo(original.wx, 6);
      expect(roundTripped.wy).toBeCloseTo(original.wy, 6);
    });

    it('accounts for zoom when converting', () => {
      const camera = makeCamera(2);

      const world = camera.viewportToWorld({ sx: 400, sy: 150 });

      // 200px right of centre at zoom 2 is 100 world units.
      expect(world.wx).toBe(600);
    });
  });

  it('re-clamps the camera after a viewport resize', () => {
    const camera = makeCamera();
    camera.centreOn({ wx: 950, wy: 950 });

    camera.setViewportSize({ width: 1200, height: 900 });

    expect(camera.view.centreX).toBe(500);
    expect(camera.view.centreY).toBe(550);
  });
});
