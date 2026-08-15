/**
 * Real elapsed time between rendered frames.
 *
 * Phaser smooths the `delta` it passes to `Scene.update`, holding it near the
 * target frame time however long the frame actually took. That is reasonable
 * for animation, but it must never reach the simulation clock: feeding it in
 * makes the settlement advance in *frames* rather than in seconds, so a device
 * managing 9 FPS lives its year at a seventh of the intended rate and the whole
 * survival balance becomes a property of the hardware. Measured on a software
 * renderer at 9 FPS, Phaser reported 16.7ms while frames really took 217ms.
 *
 * The frame *timestamp* Phaser passes is unsmoothed, so the difference between
 * successive timestamps is the honest figure. This class is that subtraction,
 * kept free of Phaser so it can be tested without a browser.
 */
export class FrameTimer {
  private previousTimestamp: number | null = null;

  /**
   * Milliseconds since the previous frame.
   *
   * @param timestamp unsmoothed frame timestamp, in milliseconds
   * @param fallback value to use when no honest figure is available yet — the
   *   first frame, or a timestamp that failed to move forward
   */
  public delta(timestamp: number, fallback: number): number {
    const previous = this.previousTimestamp;
    this.previousTimestamp = timestamp;

    // A first frame has nothing to subtract from, and a clock that stood still
    // or went backwards is not evidence about how long the frame took.
    if (previous === null || !(timestamp > previous)) {
      return fallback;
    }
    return timestamp - previous;
  }

  /** Forgets the last frame, so the next one falls back instead of measuring. */
  public reset(): void {
    this.previousTimestamp = null;
  }
}
