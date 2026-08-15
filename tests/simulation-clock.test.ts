import { describe, expect, it, vi } from 'vitest';
import { SimulationClock } from '@/simulation/SimulationClock';

function makeClock(ticksPerSecond = 10, maxTicksPerAdvance = 20): SimulationClock {
  return new SimulationClock({ ticksPerSecond, maxTicksPerAdvance });
}

describe('SimulationClock', () => {
  it('runs one tick per tick-duration of real time', () => {
    const clock = makeClock(10);
    const onTick = vi.fn();

    // 0.1s per tick at 10 ticks/second.
    expect(clock.advance(0.1, onTick)).toBe(1);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(clock.tick).toBe(1);
  });

  it('accumulates partial time across frames instead of losing it', () => {
    const clock = makeClock(10);
    const onTick = vi.fn();

    // Four 60fps-ish frames add up to just over one tick.
    expect(clock.advance(0.03, onTick)).toBe(0);
    expect(clock.advance(0.03, onTick)).toBe(0);
    expect(clock.advance(0.03, onTick)).toBe(0);
    expect(clock.advance(0.03, onTick)).toBe(1);
    expect(clock.tick).toBe(1);
  });

  it('runs several ticks when a frame is long', () => {
    const clock = makeClock(10);
    const onTick = vi.fn();

    expect(clock.advance(0.55, onTick)).toBe(5);
    expect(clock.tick).toBe(5);
  });

  it('passes increasing tick numbers to the handler', () => {
    const clock = makeClock(10);
    const seen: number[] = [];

    clock.advance(0.35, (tick) => seen.push(tick));

    expect(seen).toEqual([1, 2, 3]);
  });

  it('scales tick count by the speed multiplier', () => {
    const clock = makeClock(10);
    clock.setSpeed(4);

    expect(clock.advance(0.1, vi.fn())).toBe(4);
  });

  it('runs no ticks while paused', () => {
    const clock = makeClock(10);
    const onTick = vi.fn();

    clock.pause();

    expect(clock.advance(1, onTick)).toBe(0);
    expect(onTick).not.toHaveBeenCalled();
    expect(clock.tick).toBe(0);
    expect(clock.isPaused).toBe(true);
  });

  it('does not fast-forward through time spent paused', () => {
    const clock = makeClock(10);

    clock.pause();
    clock.advance(10, vi.fn());
    clock.resume();

    // Resuming must not cash in the 10 seconds that elapsed while paused.
    expect(clock.advance(0.1, vi.fn())).toBe(1);
  });

  it('resumes at the speed used before pausing', () => {
    const clock = makeClock(10);

    clock.setSpeed(4);
    clock.pause();
    clock.resume();

    expect(clock.speed).toBe(4);
  });

  it('toggles between paused and running', () => {
    const clock = makeClock(10);

    clock.togglePause();
    expect(clock.isPaused).toBe(true);

    clock.togglePause();
    expect(clock.isPaused).toBe(false);
    expect(clock.speed).toBe(1);
  });

  it('caps the backlog after a long stall and reports the loss', () => {
    const clock = makeClock(10, 5);
    const onTick = vi.fn();

    // 30 seconds of stall would be 300 ticks; the guard must stop at 5.
    expect(clock.advance(30, onTick)).toBe(5);
    expect(onTick).toHaveBeenCalledTimes(5);
    expect(clock.droppedTickCount).toBeGreaterThan(0);
  });

  it('ignores non-positive frame times', () => {
    const clock = makeClock(10);
    const onTick = vi.fn();

    expect(clock.advance(0, onTick)).toBe(0);
    expect(clock.advance(-1, onTick)).toBe(0);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('reports elapsed simulated seconds independently of real time', () => {
    const clock = makeClock(10);
    clock.setSpeed(4);

    // Ten ordinary frames totalling one real second. Driving it as a single
    // 1s frame would instead trip the backlog guard, which is its own test.
    for (let i = 0; i < 10; i += 1) {
      clock.advance(0.1, vi.fn());
    }

    // One real second at 4x is four simulated seconds.
    expect(clock.tick).toBe(40);
    expect(clock.elapsedSeconds).toBeCloseTo(4, 5);
    expect(clock.droppedTickCount).toBe(0);
  });

  it('exposes interpolation alpha between ticks', () => {
    const clock = makeClock(10);

    clock.advance(0.05, vi.fn());

    expect(clock.tickAlpha).toBeCloseTo(0.5, 5);
  });

  it('restores tick and speed from a save', () => {
    const clock = makeClock(10);

    clock.restore(4321, 2);

    expect(clock.tick).toBe(4321);
    expect(clock.speed).toBe(2);
    expect(clock.droppedTickCount).toBe(0);
  });
});
