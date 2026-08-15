/**
 * Touch input: one-finger drag to pan, pinch to zoom, tap to select.
 *
 * This is the primary control scheme — tablet and phone landscape are the
 * target devices, so touch is not a fallback for the mouse path.
 *
 * Notes on the gesture model:
 * - a second finger converts an in-progress pan into a pinch without ending it;
 * - lifting one finger of a pinch resumes panning from the remaining finger
 *   rather than jumping the camera;
 * - taps require both a short press and little movement, so a slow drag never
 *   selects something by accident.
 */

import {
  TAP_MAX_DURATION_MS,
  TAP_MOVE_TOLERANCE_PX,
  type InputController,
  type InputIntentSink,
} from './types';

/** Pinch distances below this are too noisy to derive a zoom factor from. */
const MIN_PINCH_DISTANCE_PX = 24;

export class TouchController implements InputController {
  private readonly element: HTMLElement;
  private readonly sink: InputIntentSink;

  private panning = false;
  private pinching = false;
  private activeTouchId: number | null = null;

  private lastX = 0;
  private lastY = 0;
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private moved = false;

  private velocityX = 0;
  private velocityY = 0;
  private lastMoveTime = 0;

  private lastPinchDistance = 0;

  constructor(element: HTMLElement, sink: InputIntentSink) {
    this.element = element;
    this.sink = sink;
  }

  public attach(): void {
    // Non-passive: the browser must not scroll or pinch-zoom the page itself.
    this.element.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.element.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.element.addEventListener('touchend', this.handleTouchEnd, { passive: false });
    this.element.addEventListener('touchcancel', this.handleTouchCancel, { passive: false });
  }

  public detach(): void {
    this.element.removeEventListener('touchstart', this.handleTouchStart);
    this.element.removeEventListener('touchmove', this.handleTouchMove);
    this.element.removeEventListener('touchend', this.handleTouchEnd);
    this.element.removeEventListener('touchcancel', this.handleTouchCancel);
  }

  private readonly handleTouchStart = (event: TouchEvent): void => {
    event.preventDefault();

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      this.beginPan(touch, event.timeStamp);
      this.sink.onGestureStart();
      return;
    }

    if (event.touches.length >= 2) {
      this.beginPinch(event);
      this.sink.onGestureStart();
    }
  };

  private readonly handleTouchMove = (event: TouchEvent): void => {
    event.preventDefault();

    if (event.touches.length >= 2) {
      this.updatePinch(event);
      return;
    }

    if (!this.panning || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    if (!touch || touch.identifier !== this.activeTouchId) {
      return;
    }

    const deltaX = touch.clientX - this.lastX;
    const deltaY = touch.clientY - this.lastY;
    this.lastX = touch.clientX;
    this.lastY = touch.clientY;

    if (
      Math.hypot(touch.clientX - this.startX, touch.clientY - this.startY) > TAP_MOVE_TOLERANCE_PX
    ) {
      this.moved = true;
    }

    const elapsed = event.timeStamp - this.lastMoveTime;
    if (elapsed > 0) {
      const instantX = (deltaX / elapsed) * 1000;
      const instantY = (deltaY / elapsed) * 1000;
      this.velocityX = this.velocityX * 0.6 + instantX * 0.4;
      this.velocityY = this.velocityY * 0.6 + instantY * 0.4;
      this.lastMoveTime = event.timeStamp;
    }

    this.sink.onPan(deltaX, deltaY);
  };

  private readonly handleTouchEnd = (event: TouchEvent): void => {
    event.preventDefault();

    if (this.pinching) {
      if (event.touches.length >= 2) {
        // Still pinching with different fingers; re-baseline.
        this.beginPinch(event);
        return;
      }

      this.pinching = false;
      this.lastPinchDistance = 0;

      const remaining = event.touches[0];
      if (remaining) {
        // Hand the gesture back to panning without a positional jump.
        this.beginPan(remaining, event.timeStamp);
      } else {
        this.panning = false;
        this.activeTouchId = null;
        this.sink.onPanEnd(0, 0);
      }
      return;
    }

    if (!this.panning) {
      return;
    }

    if (event.touches.length > 0) {
      return;
    }

    this.panning = false;
    this.activeTouchId = null;

    const duration = event.timeStamp - this.startTime;
    if (!this.moved && duration <= TAP_MAX_DURATION_MS) {
      this.sink.onSelect(this.toLocalPoint(this.lastX, this.lastY));
      return;
    }

    const stale = event.timeStamp - this.lastMoveTime > 120;
    this.sink.onPanEnd(stale ? 0 : this.velocityX, stale ? 0 : this.velocityY);
  };

  private readonly handleTouchCancel = (event: TouchEvent): void => {
    event.preventDefault();
    this.panning = false;
    this.pinching = false;
    this.activeTouchId = null;
    this.lastPinchDistance = 0;
    this.sink.onPanEnd(0, 0);
  };

  private beginPan(touch: Touch, timeStamp: number): void {
    this.panning = true;
    this.pinching = false;
    this.moved = false;
    this.activeTouchId = touch.identifier;
    this.lastX = touch.clientX;
    this.lastY = touch.clientY;
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.startTime = timeStamp;
    this.lastMoveTime = timeStamp;
    this.velocityX = 0;
    this.velocityY = 0;
  }

  private beginPinch(event: TouchEvent): void {
    const first = event.touches[0];
    const second = event.touches[1];
    if (!first || !second) {
      return;
    }

    this.pinching = true;
    this.panning = false;
    this.activeTouchId = null;
    this.velocityX = 0;
    this.velocityY = 0;
    this.lastPinchDistance = distanceBetween(first, second);

    const centre = midpointOf(first, second);
    this.lastX = centre.x;
    this.lastY = centre.y;
  }

  private updatePinch(event: TouchEvent): void {
    const first = event.touches[0];
    const second = event.touches[1];
    if (!first || !second) {
      return;
    }

    const distance = distanceBetween(first, second);
    const centre = midpointOf(first, second);

    // Two fingers moving together still pans, which is what people expect.
    const deltaX = centre.x - this.lastX;
    const deltaY = centre.y - this.lastY;
    this.lastX = centre.x;
    this.lastY = centre.y;
    if (deltaX !== 0 || deltaY !== 0) {
      this.sink.onPan(deltaX, deltaY);
    }

    if (this.lastPinchDistance >= MIN_PINCH_DISTANCE_PX && distance >= MIN_PINCH_DISTANCE_PX) {
      const factor = distance / this.lastPinchDistance;
      this.sink.onZoom(factor, this.toLocalPoint(centre.x, centre.y));
    }
    this.lastPinchDistance = distance;
  }

  private toLocalPoint(clientX: number, clientY: number) {
    const rect = this.element.getBoundingClientRect();
    return { sx: clientX - rect.left, sy: clientY - rect.top };
  }
}

function distanceBetween(a: Touch, b: Touch): number {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function midpointOf(a: Touch, b: Touch): { x: number; y: number } {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}
