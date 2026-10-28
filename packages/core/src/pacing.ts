/** What the viewer asked for on top of the scene's own `pace`: `null` keeps the scene's, `"max"` runs flat out, a number is a multiple of the scene's pace. */
export type ViewerSpeed = number | 'max' | null

/**
 * Steps to try per real second. The scene's `time.pace` is simulated time per real second (`"max"` means as fast as possible) and
 * `time.step` the time one step advances. A viewer's speed multiplies the pace; for a scene with no pace, a multiple is of one unit
 * of time per second (real time, for a scene measured in seconds). Infinity means as fast as the machine allows.
 */
export function stepsPerSecond(time: { step: number; pace: number | 'max' }, speed: ViewerSpeed = null): number {
  if (speed === 'max') return Infinity
  if (speed === null) return time.pace === 'max' ? Infinity : time.pace / time.step
  const base = time.pace === 'max' ? 1 : time.pace
  return (base * speed) / time.step
}

/**
 * Turns a steps-per-second target into whole steps for each frame, carrying the fraction forward (1.67 steps a frame runs 1, 2, 2, 1, 2, ...).
 * It never owes more than a couple of frames: a machine that cannot keep up advances less, it does not try to catch up later.
 */
export class Pacer {
  private owed = 0

  /** Whole steps to run for a frame that comes `seconds` of real time after the last one. */
  steps(perSecond: number, seconds: number): number {
    if (!Number.isFinite(perSecond)) { this.owed = 0; return Infinity }
    this.owed = Math.min(this.owed + perSecond * seconds, Math.max(2, perSecond * 0.04))
    const n = Math.floor(this.owed)
    this.owed -= n
    return n
  }
}
