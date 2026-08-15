/**
 * Input abstraction.
 *
 * Input devices do not talk to the camera or the simulation directly. They
 * translate raw events into *intents*, which something else decides how to
 * honour. That keeps mouse and touch on one code path and lets gestures be
 * rebound or replayed later.
 */

import type { ScreenPoint } from '@/shared/types/geometry';

/** Receives device-independent intents produced by the input controllers. */
export interface InputIntentSink {
  /** A drag, in viewport pixels since the previous sample. */
  onPan(deltaScreenX: number, deltaScreenY: number): void;
  /** A released drag, carrying gesture velocity in pixels per second. */
  onPanEnd(velocityScreenX: number, velocityScreenY: number): void;
  /** A zoom step. `factor > 1` zooms in; `anchor` stays put on screen. */
  onZoom(factor: number, anchor: ScreenPoint): void;
  /** A tap or click that did not turn into a drag. */
  onSelect(point: ScreenPoint): void;
  /** A gesture began; used to interrupt inertia. */
  onGestureStart(): void;
}

/** An input controller bound to a DOM element. */
export interface InputController {
  attach(): void;
  detach(): void;
}

/** Movement beyond this many pixels turns a tap into a drag. */
export const TAP_MOVE_TOLERANCE_PX = 12;

/** A press longer than this is no longer treated as a tap. */
export const TAP_MAX_DURATION_MS = 400;
