/**
 * Desktop input: mouse drag to pan, wheel to zoom, click to select.
 *
 * Deliberately limited to `pointerType === 'mouse'`. Touch is handled by
 * {@link TouchController}, so the two never process the same gesture twice.
 *
 * Per the design constraints, nothing here is required to play: no hover
 * behaviour, no right click, no keyboard.
 */

import {
  TAP_MAX_DURATION_MS,
  TAP_MOVE_TOLERANCE_PX,
  type InputController,
  type InputIntentSink,
} from './types';

/** Wheel delta that produces one full zoom step. */
const WHEEL_STEP = 240;
/** How much a full wheel step multiplies the zoom by. */
const WHEEL_ZOOM_FACTOR = 1.35;

export class PointerController implements InputController {
  private readonly element: HTMLElement;
  private readonly sink: InputIntentSink;

  private dragging = false;
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  /** Smoothed pointer velocity in px/s, for the inertia handoff. */
  private velocityX = 0;
  private velocityY = 0;
  private lastMoveTime = 0;
  private moved = false;

  constructor(element: HTMLElement, sink: InputIntentSink) {
    this.element = element;
    this.sink = sink;
  }

  public attach(): void {
    this.element.addEventListener('pointerdown', this.handlePointerDown);
    this.element.addEventListener('pointermove', this.handlePointerMove);
    this.element.addEventListener('pointerup', this.handlePointerUp);
    this.element.addEventListener('pointercancel', this.handlePointerCancel);
    this.element.addEventListener('wheel', this.handleWheel, { passive: false });
    this.element.addEventListener('contextmenu', this.handleContextMenu);
  }

  public detach(): void {
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointercancel', this.handlePointerCancel);
    this.element.removeEventListener('wheel', this.handleWheel);
    this.element.removeEventListener('contextmenu', this.handleContextMenu);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || event.button !== 0) {
      return;
    }

    this.dragging = true;
    this.moved = false;
    this.pointerId = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startTime = event.timeStamp;
    this.lastMoveTime = event.timeStamp;
    this.velocityX = 0;
    this.velocityY = 0;

    this.element.setPointerCapture(event.pointerId);
    this.sink.onGestureStart();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.pointerId) {
      return;
    }

    const deltaX = event.clientX - this.lastX;
    const deltaY = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;

    if (
      Math.hypot(event.clientX - this.startX, event.clientY - this.startY) > TAP_MOVE_TOLERANCE_PX
    ) {
      this.moved = true;
    }

    const elapsed = event.timeStamp - this.lastMoveTime;
    if (elapsed > 0) {
      // Exponential smoothing: a single jittery sample should not dominate the
      // flick velocity handed to the camera.
      const instantX = (deltaX / elapsed) * 1000;
      const instantY = (deltaY / elapsed) * 1000;
      this.velocityX = this.velocityX * 0.6 + instantX * 0.4;
      this.velocityY = this.velocityY * 0.6 + instantY * 0.4;
      this.lastMoveTime = event.timeStamp;
    }

    this.sink.onPan(deltaX, deltaY);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.dragging || event.pointerId !== this.pointerId) {
      return;
    }
    this.releasePointer(event);

    const duration = event.timeStamp - this.startTime;
    if (!this.moved && duration <= TAP_MAX_DURATION_MS) {
      this.sink.onSelect(this.toLocalPoint(event.clientX, event.clientY));
      return;
    }

    // A drag that ended while stationary should not drift.
    const stale = event.timeStamp - this.lastMoveTime > 120;
    this.sink.onPanEnd(stale ? 0 : this.velocityX, stale ? 0 : this.velocityY);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) {
      return;
    }
    this.releasePointer(event);
    this.sink.onPanEnd(0, 0);
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    // Stop the page from scrolling behind the canvas.
    event.preventDefault();

    // deltaMode 1 is lines, 2 is pages; normalise both to pixels.
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    const steps = (-event.deltaY * scale) / WHEEL_STEP;
    const factor = Math.pow(WHEEL_ZOOM_FACTOR, steps);

    this.sink.onZoom(factor, this.toLocalPoint(event.clientX, event.clientY));
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    // The game never needs the browser menu over the world.
    event.preventDefault();
  };

  private releasePointer(event: PointerEvent): void {
    this.dragging = false;
    this.pointerId = null;
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
  }

  private toLocalPoint(clientX: number, clientY: number) {
    const rect = this.element.getBoundingClientRect();
    return { sx: clientX - rect.left, sy: clientY - rect.top };
  }
}
