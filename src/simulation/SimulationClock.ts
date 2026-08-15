/**
 * Fixed-timestep simulation clock.
 *
 * Rendering frame rate and simulation rate are independent. The renderer calls
 * {@link SimulationClock.advance} once per frame with the real elapsed time;
 * the clock converts that into a whole number of fixed-length simulation ticks.
 *
 * Consequences that the rest of the codebase relies on:
 * - economy maths runs per tick, never per rendered frame;
 * - a save records `tick`, which fully identifies simulation time;
 * - a headless test can drive the simulation without any timing at all.
 */

/** Available simulation speeds. `0` is paused. */
export type SimulationSpeed = 0 | 1 | 2 | 4;

/** The ordered speeds offered by the HUD. */
export const SIMULATION_SPEEDS: readonly SimulationSpeed[] = [0, 1, 2, 4];

export interface SimulationClockOptions {
  /** Simulation ticks per real second at 1x speed. */
  readonly ticksPerSecond: number;
  /**
   * Upper bound on ticks executed in a single `advance` call.
   *
   * Guards against the "spiral of death": after a long stall (backgrounded tab,
   * a breakpoint) the accumulated time could otherwise request thousands of
   * ticks, each of which makes the next frame later still.
   */
  readonly maxTicksPerAdvance: number;
}

const DEFAULT_OPTIONS: SimulationClockOptions = {
  ticksPerSecond: 10,
  maxTicksPerAdvance: 20,
};

/** Called once per fixed simulation tick. */
export type TickHandler = (tick: number, tickDurationSeconds: number) => void;

export class SimulationClock {
  private readonly options: SimulationClockOptions;
  private readonly tickDurationSeconds: number;

  private accumulatorSeconds = 0;
  private currentTick = 0;
  private currentSpeed: SimulationSpeed = 1;
  /** Speed restored by `resume()` after a pause. */
  private lastRunningSpeed: Exclude<SimulationSpeed, 0> = 1;
  private droppedTicks = 0;

  constructor(options: Partial<SimulationClockOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.tickDurationSeconds = 1 / this.options.ticksPerSecond;
  }

  /** Total ticks simulated since the world began. */
  public get tick(): number {
    return this.currentTick;
  }

  /** Simulated in-world time, in seconds, at 1x. */
  public get elapsedSeconds(): number {
    return this.currentTick * this.tickDurationSeconds;
  }

  public get speed(): SimulationSpeed {
    return this.currentSpeed;
  }

  public get isPaused(): boolean {
    return this.currentSpeed === 0;
  }

  /** Length of a single tick in seconds — the simulation's `deltaTime`. */
  public get tickSeconds(): number {
    return this.tickDurationSeconds;
  }

  /**
   * Ticks discarded by the `maxTicksPerAdvance` guard.
   *
   * Non-zero means the simulation fell behind real time; surfaced in the debug
   * overlay rather than silently ignored.
   */
  public get droppedTickCount(): number {
    return this.droppedTicks;
  }

  public setSpeed(speed: SimulationSpeed): void {
    if (speed !== 0) {
      this.lastRunningSpeed = speed;
    }
    this.currentSpeed = speed;
    if (speed === 0) {
      // Drop the partial tick so unpausing does not immediately jump forward.
      this.accumulatorSeconds = 0;
    }
  }

  public pause(): void {
    this.setSpeed(0);
  }

  /** Resumes at the speed in use before the last pause. */
  public resume(): void {
    this.setSpeed(this.lastRunningSpeed);
  }

  public togglePause(): void {
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  /**
   * Feeds real elapsed time into the clock and runs the ticks it earns.
   *
   * @param deltaSeconds real time since the previous call
   * @param onTick invoked once per fixed tick, in order
   * @returns the number of ticks executed
   */
  public advance(deltaSeconds: number, onTick: TickHandler): number {
    if (this.currentSpeed === 0 || deltaSeconds <= 0) {
      return 0;
    }

    this.accumulatorSeconds += deltaSeconds * this.currentSpeed;

    let executed = 0;
    while (this.accumulatorSeconds >= this.tickDurationSeconds) {
      if (executed >= this.options.maxTicksPerAdvance) {
        // Give up on the backlog rather than stalling the frame further.
        const abandoned = Math.floor(this.accumulatorSeconds / this.tickDurationSeconds);
        this.droppedTicks += abandoned;
        this.accumulatorSeconds = 0;
        break;
      }

      this.accumulatorSeconds -= this.tickDurationSeconds;
      this.currentTick += 1;
      executed += 1;
      onTick(this.currentTick, this.tickDurationSeconds);
    }

    return executed;
  }

  /**
   * Fraction of the way through the next pending tick, in `[0, 1)`.
   *
   * The renderer can use this to interpolate positions so that movement looks
   * smooth even though the simulation steps discretely.
   */
  public get tickAlpha(): number {
    return this.accumulatorSeconds / this.tickDurationSeconds;
  }

  /** Restores a clock from a save. */
  public restore(tick: number, speed: SimulationSpeed): void {
    this.currentTick = tick;
    this.accumulatorSeconds = 0;
    this.droppedTicks = 0;
    this.setSpeed(speed);
  }
}
