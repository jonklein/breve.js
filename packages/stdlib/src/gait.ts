/** One joint's rhythm: its target angle swings around `offset` by `amplitude` radians, `phase` of a cycle ahead and `lag` of a cycle behind. */
export interface GaitJoint {
  /** Radians. How far the joint swings either side of `offset`. Default 0. */
  amplitude?: number
  /** Radians. The angle the joint swings around. Default 0. */
  offset?: number
  /** Fraction of a cycle (0.5 is half a cycle ahead or behind). Default 0. */
  phase?: number
  /** Cycles this joint trails behind, on top of `phase` (a knee that bends a quarter cycle after its hip). Default 0. */
  lag?: number
}

/**
 * Rhythmic joint targets, the way a walker's legs keep time: a sine for each joint, started at different points of one shared cycle.
 * A creature's script keeps the cycle position in its state, advances it each tick with `Gait.advance`, and returns
 * `{ joints: Gait.targets(legs, cycle) }`. Nothing here is built into the engine: a joint with no target from the script rests at 0.
 */
export class Gait {
  /** The target angle for one joint at `cycle` (0 to 1): `offset + amplitude * sin(2 pi (cycle + phase - lag))`. */
  static wave(cycle: number, joint: GaitJoint): number {
    return (joint.offset ?? 0) + (joint.amplitude ?? 0) * Math.sin(2 * Math.PI * (cycle + (joint.phase ?? 0) - (joint.lag ?? 0)))
  }

  /** Targets for many joints at once, by joint name: `Gait.targets({ 'FL.hip': { amplitude: 0.7 }, 'FR.hip': { amplitude: 0.7, phase: 0.5 } }, cycle)`. */
  static targets(joints: Record<string, GaitJoint>, cycle: number): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [name, joint] of Object.entries(joints)) out[name] = Gait.wave(cycle, joint)
    return out
  }

  /** The next cycle position after `dt` seconds at `frequency` cycles per second, wrapped to 0..1. Keeping the position (not the time) means changing the frequency never makes the legs jump. */
  static advance(cycle: number, frequency: number, dt: number): number {
    const next = (cycle + frequency * dt) % 1
    return next < 0 ? next + 1 : next
  }
}
