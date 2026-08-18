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
    initialCentre: { px: 500, py: 500 },
  });
}

describe('CameraController', () => {
  it('starts centred on the scene bounds when no centre is given', () => {
    const camera = new CameraController({ limits: LIMITS, viewport: VIEWPORT });

    expect(camera.view.centreX).toBe(500);
    expect(camera.view.centreY).toBe(500);
  });

  describe('panning', () => {
    it('moves the world with the gesture', () => {
      const camera = makeCamera();

      // Dragging right moves the camera left, so the scene follows the finger.
      camera.panByScreenDelta(50, 20);

      expect(camera.view.centreX).toBe(450);
      expect(camera.view.centreY).toBe(480);
    });

    it('pans further in scene units when zoomed out', () => {
      const camera = makeCamera(0.5);

      camera.panByScreenDelta(50, 0);

      // 50 screen px at 0.5 zoom is 100 scene units.
      expect(camera.view.centreX).toBe(400);
    });

    it('stops with the corner of the scene at the centre of the view', () => {
      // **The centre is what is clamped, not the visible rectangle.** Building
      // is done by moving the ghost, and the ghost sits at the centre of the
      // view — so the far corner of the map has to be a place the centre can
      // reach, or it is a corner the player can see and cannot use.
      const camera = makeCamera();

      camera.panByScreenDelta(10_000, 10_000);

      expect(camera.view.centreX).toBe(0);
      expect(camera.view.centreY).toBe(0);
    });

    it('lets a small world sit against the edge of the screen', () => {
      // No special case for a world smaller than the viewport: it clamps on the
      // same rule, and the rule already allows empty ground past the edge.
      const camera = new CameraController({
        limits: LIMITS,
        viewport: { width: 4000, height: 4000 },
      });

      camera.panByScreenDelta(-9999, -9999);

      expect(camera.view.centreX).toBe(1000);
      expect(camera.view.centreY).toBe(1000);
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

    it('keeps the anchored scene point under the cursor', () => {
      const camera = makeCamera();
      const anchor = { sx: 320, sy: 90 };
      const before = camera.viewportToScene(anchor);

      camera.zoomBy(2, anchor);

      const after = camera.viewportToScene(anchor);
      expect(after.px).toBeCloseTo(before.px, 4);
      expect(after.py).toBeCloseTo(before.py, 4);
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

    it('does not drift outside the scene bounds', () => {
      const camera = makeCamera();

      camera.flick(-100_000, -100_000);
      for (let i = 0; i < 240; i += 1) {
        camera.update(1 / 60);
      }

      expect(camera.view.centreX).toBeGreaterThanOrEqual(0);
      expect(camera.view.centreY).toBeGreaterThanOrEqual(0);
    });
  });

  describe('coordinate conversion', () => {
    it('maps the viewport centre to the camera centre', () => {
      const camera = makeCamera();

      const scene = camera.viewportToScene({ sx: 200, sy: 150 });

      expect(scene.px).toBe(500);
      expect(scene.py).toBe(500);
    });

    it('round-trips scene -> viewport -> scene', () => {
      const camera = makeCamera(1.75);
      const original = { px: 512.5, py: 437.25 };

      const roundTripped = camera.viewportToScene(camera.sceneToViewport(original));

      expect(roundTripped.px).toBeCloseTo(original.px, 6);
      expect(roundTripped.py).toBeCloseTo(original.py, 6);
    });

    it('accounts for zoom when converting', () => {
      const camera = makeCamera(2);

      const scene = camera.viewportToScene({ sx: 400, sy: 150 });

      // 200px right of centre at zoom 2 is 100 scene units.
      expect(scene.px).toBe(600);
    });
  });

  it('holds the camera over the scene across a viewport resize', () => {
    // A resize no longer moves the camera, because the clamp no longer depends
    // on how big the window is — only on where the scene is. Turning a tablet on
    // its side used to shove the view half a screen inland.
    const camera = makeCamera();
    camera.centreOn({ px: 950, py: 950 });

    camera.setViewportSize({ width: 1200, height: 900 });

    expect(camera.view.centreX).toBe(950);
    expect(camera.view.centreY).toBe(950);
  });
});
