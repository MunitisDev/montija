/**
 * Frame timing tests.
 *
 * These exist because of a real bug: Phaser's smoothed `delta` was driving the
 * simulation clock, so on a machine rendering at 9 FPS the settlement advanced
 * at a seventh of real time — seasons, hunger and winter all slowed with the
 * frame rate, making the survival balance a property of the player's hardware.
 * Nothing surfaced it, because the clock's dropped-tick counter stayed at zero.
 */

import { describe, expect, it } from 'vitest';

import { FrameTimer } from '@/renderer/FrameTimer';
import { SimulationClock } from '@/simulation/SimulationClock';

describe('FrameTimer', () => {
  it('falls back on the first frame, having nothing to measure against', () => {
    const timer = new FrameTimer();
    expect(timer.delta(1000, 16.7)).toBe(16.7);
  });

  it('reports the real gap between frames, not the smoothed one', () => {
    const timer = new FrameTimer();
    timer.delta(1000, 16.7);
    // The frame really took 217ms; Phaser would still have claimed 16.7.
    expect(timer.delta(1217, 16.7)).toBeCloseTo(217);
  });

  it('measures each frame against the previous one only', () => {
    const timer = new FrameTimer();
    timer.delta(0, 16.7);
    expect(timer.delta(100, 16.7)).toBeCloseTo(100);
    expect(timer.delta(150, 16.7)).toBeCloseTo(50);
    expect(timer.delta(1150, 16.7)).toBeCloseTo(1000);
  });

  it('falls back rather than returning zero or a negative gap', () => {
    const timer = new FrameTimer();
    timer.delta(500, 16.7);
    expect(timer.delta(500, 16.7)).toBe(16.7);
    expect(timer.delta(400, 16.7)).toBe(16.7);
  });

  it('falls back again after a reset', () => {
    const timer = new FrameTimer();
    timer.delta(0, 16.7);
    timer.delta(100, 16.7);
    timer.reset();
    expect(timer.delta(200, 16.7)).toBe(16.7);
  });
});

describe('simulation speed against a slow renderer', () => {
  /** Runs `seconds` of real time at `fps`, returning the ticks simulated. */
  function ticksIn(seconds: number, fps: number, useSmoothedDelta: boolean): number {
    const timer = new FrameTimer();
    const clock = new SimulationClock();
    const frameMs = 1000 / fps;
    const smoothed = 1000 / 60;

    let ticks = 0;
    for (let frame = 1; frame <= Math.round(seconds * fps); frame++) {
      const timestamp = frame * frameMs;
      const deltaMs = useSmoothedDelta ? smoothed : timer.delta(timestamp, smoothed);
      // Mirrors Game.advance, including its stall clamp.
      ticks += clock.advance(Math.min(deltaMs, 250) / 1000, () => {});
    }
    return ticks;
  }

  it('runs at the same rate whether the renderer is fast or slow', () => {
    // Ten ticks per second, for five seconds, at any frame rate worth playing.
    // Accumulating a float delta per frame can leave the run a fraction short
    // of the final tick boundary, so one tick of slack is the honest claim.
    for (const fps of [60, 30, 9]) {
      expect(ticksIn(5, fps, false), `${fps} FPS`).toBeGreaterThanOrEqual(49);
      expect(ticksIn(5, fps, false), `${fps} FPS`).toBeLessThanOrEqual(50);
    }
  });

  it('demonstrates the bug the smoothed delta caused', () => {
    // The regression this guards: at 9 FPS the settlement lived a seventh of
    // its life. Asserted so that reintroducing the smoothed delta fails here.
    expect(ticksIn(5, 60, true)).toBeGreaterThanOrEqual(49);
    expect(ticksIn(5, 9, true)).toBeLessThan(10);
  });
});
