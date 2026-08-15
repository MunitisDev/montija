/**
 * Camera state and behaviour, independent of any renderer.
 *
 * The controller owns *what* the camera is looking at (a world-space centre and
 * a zoom factor) plus the feel — inertia, smooth zoom, limits, world bounds.
 * A thin adapter copies that state onto the actual Phaser camera each frame, so
 * this logic can be unit tested with no engine and no canvas.
 *
 * The camera operates in *scene* space — isometric pixels, the space Phaser
 * positions objects in. It knows nothing about the projection that produced
 * those pixels; that lives in `shared/math/isometric.ts`. Keeping the two
 * apart is why `viewportToScene` is named that and not `viewportToWorld`:
 * "world" is a different space entirely, and conflating them is the bug this
 * separation exists to prevent.
 */

import { clamp, damp } from '@/shared/math/numbers';
import type { SceneBounds, ScenePoint, ScreenPoint, ViewportSize } from '@/shared/types/geometry';

export interface CameraLimits {
  readonly minZoom: number;
  readonly maxZoom: number;
  /** The rectangle of scene space the camera may look at. */
  readonly bounds: SceneBounds;
}

export interface CameraFeel {
  /** Fraction of pan velocity surviving one second of inertia. Lower = stiffer. */
  readonly inertiaDamping: number;
  /** Fraction of the remaining zoom distance left after one second. */
  readonly zoomSmoothing: number;
  /** Pan speed below which inertia stops entirely (world units / second). */
  readonly minimumFlickSpeed: number;
}

export const DEFAULT_CAMERA_FEEL: CameraFeel = {
  inertiaDamping: 0.002,
  zoomSmoothing: 0.0001,
  minimumFlickSpeed: 4,
};

export interface CameraControllerOptions {
  readonly limits: CameraLimits;
  readonly feel?: CameraFeel;
  readonly viewport?: ViewportSize;
  readonly initialCentre?: ScenePoint;
  readonly initialZoom?: number;
}

/** The state an adapter needs to drive a concrete renderer camera. */
export interface CameraView {
  /** Scene-space point at the centre of the viewport. */
  readonly centreX: number;
  readonly centreY: number;
  readonly zoom: number;
}

export class CameraController {
  private readonly limits: CameraLimits;
  private readonly feel: CameraFeel;

  private viewport: ViewportSize;
  private centreX: number;
  private centreY: number;
  private currentZoom: number;
  private targetZoom: number;

  /** Inertia velocity, world units per second. */
  private velocityX = 0;
  private velocityY = 0;

  constructor(options: CameraControllerOptions) {
    this.limits = options.limits;
    this.feel = options.feel ?? DEFAULT_CAMERA_FEEL;
    this.viewport = options.viewport ?? { width: 1, height: 1 };

    const bounds = this.limits.bounds;
    this.centreX = options.initialCentre?.px ?? (bounds.minX + bounds.maxX) / 2;
    this.centreY = options.initialCentre?.py ?? (bounds.minY + bounds.maxY) / 2;

    this.currentZoom = clamp(options.initialZoom ?? 1, this.limits.minZoom, this.limits.maxZoom);
    this.targetZoom = this.currentZoom;
    this.clampCentre();
  }

  public get view(): CameraView {
    return { centreX: this.centreX, centreY: this.centreY, zoom: this.currentZoom };
  }

  public get zoom(): number {
    return this.currentZoom;
  }

  public get viewportSize(): ViewportSize {
    return this.viewport;
  }

  /** `true` while inertia or smooth zoom is still settling. */
  public get isSettling(): boolean {
    return this.velocityX !== 0 || this.velocityY !== 0 || this.currentZoom !== this.targetZoom;
  }

  public setViewportSize(size: ViewportSize): void {
    this.viewport = size;
    this.clampCentre();
  }

  /** Jumps the camera to a scene position, cancelling any inertia. */
  public centreOn(point: ScenePoint): void {
    this.centreX = point.px;
    this.centreY = point.py;
    this.stopMotion();
    this.clampCentre();
  }

  /**
   * Pans by a drag measured in screen pixels.
   *
   * Dragging moves the world with the finger, so the camera travels in the
   * opposite direction to the gesture.
   */
  public panByScreenDelta(deltaScreenX: number, deltaScreenY: number): void {
    this.centreX -= deltaScreenX / this.currentZoom;
    this.centreY -= deltaScreenY / this.currentZoom;
    this.clampCentre();
  }

  /**
   * Starts inertial drift after a flick.
   *
   * @param velocityScreenX gesture velocity in pixels per second
   */
  public flick(velocityScreenX: number, velocityScreenY: number): void {
    this.velocityX = -velocityScreenX / this.currentZoom;
    this.velocityY = -velocityScreenY / this.currentZoom;
  }

  public stopMotion(): void {
    this.velocityX = 0;
    this.velocityY = 0;
  }

  /**
   * Zooms around a fixed screen anchor.
   *
   * The world point under the cursor (or under the pinch centre) stays put,
   * which is what makes wheel- and pinch-zoom feel correct.
   *
   * @param factor multiplier, `> 1` zooms in
   */
  public zoomBy(factor: number, anchor?: ScreenPoint): void {
    const requested = this.targetZoom * factor;
    const clamped = clamp(requested, this.limits.minZoom, this.limits.maxZoom);
    if (clamped === this.targetZoom) {
      return;
    }

    if (anchor) {
      // Keep the anchored world point stationary. Applied against the *current*
      // zoom so the anchor holds while the smoothing is still catching up.
      const before = this.viewportToScene(anchor);
      this.targetZoom = clamped;
      this.currentZoom = clamped;
      const after = this.viewportToScene(anchor);
      this.centreX += before.px - after.px;
      this.centreY += before.py - after.py;
      this.clampCentre();
    } else {
      this.targetZoom = clamped;
    }
  }

  /** Sets a zoom target that {@link update} eases towards. */
  public setZoom(zoom: number, immediate = false): void {
    this.targetZoom = clamp(zoom, this.limits.minZoom, this.limits.maxZoom);
    if (immediate) {
      this.currentZoom = this.targetZoom;
      this.clampCentre();
    }
  }

  /** Advances inertia and smooth zoom. Called once per rendered frame. */
  public update(deltaSeconds: number): void {
    if (deltaSeconds <= 0) {
      return;
    }

    if (this.currentZoom !== this.targetZoom) {
      this.currentZoom = damp(
        this.currentZoom,
        this.targetZoom,
        this.feel.zoomSmoothing,
        deltaSeconds,
      );
      if (Math.abs(this.currentZoom - this.targetZoom) < 0.0005) {
        this.currentZoom = this.targetZoom;
      }
    }

    if (this.velocityX !== 0 || this.velocityY !== 0) {
      this.centreX += this.velocityX * deltaSeconds;
      this.centreY += this.velocityY * deltaSeconds;

      const decay = Math.pow(this.feel.inertiaDamping, deltaSeconds);
      this.velocityX *= decay;
      this.velocityY *= decay;

      const speed = Math.hypot(this.velocityX, this.velocityY);
      if (speed < this.feel.minimumFlickSpeed) {
        this.stopMotion();
      }
      this.clampCentre();
    }
  }

  /** Converts a viewport pixel position into an isometric scene position. */
  public viewportToScene(point: ScreenPoint): ScenePoint {
    return {
      px: this.centreX + (point.sx - this.viewport.width / 2) / this.currentZoom,
      py: this.centreY + (point.sy - this.viewport.height / 2) / this.currentZoom,
    };
  }

  /** Converts an isometric scene position into a viewport pixel position. */
  public sceneToViewport(point: ScenePoint): ScreenPoint {
    return {
      sx: (point.px - this.centreX) * this.currentZoom + this.viewport.width / 2,
      sy: (point.py - this.centreY) * this.currentZoom + this.viewport.height / 2,
    };
  }

  /**
   * Keeps the visible rectangle inside the scene bounds.
   *
   * When the world is narrower than the viewport on an axis, the camera centres
   * on it instead of clamping, which would otherwise push it against one edge.
   */
  private clampCentre(): void {
    const halfWidth = this.viewport.width / 2 / this.currentZoom;
    const halfHeight = this.viewport.height / 2 / this.currentZoom;
    const { minX, minY, maxX, maxY } = this.limits.bounds;

    if (maxX - minX <= halfWidth * 2) {
      this.centreX = (minX + maxX) / 2;
    } else {
      this.centreX = clamp(this.centreX, minX + halfWidth, maxX - halfWidth);
    }

    if (maxY - minY <= halfHeight * 2) {
      this.centreY = (minY + maxY) / 2;
    } else {
      this.centreY = clamp(this.centreY, minY + halfHeight, maxY - halfHeight);
    }
  }
}
