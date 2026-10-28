import type { BodyDef } from '../body'

/**
 * The small surface the sim needs from a physics engine. It speaks in our own data (a JSON body,
 * a heightfield) so an engine can be swapped (Rapier today, MuJoCo WASM possibly later) without
 * touching worlds or scripts. Everything here is headless: no DOM, no renderer.
 */
import type { PhysicsSettings } from './settings'

export interface PhysicsEngine {
  readonly name: string
  /** What this engine cannot do, so a scene that asks for it can be told plainly. Anything not listed works. */
  readonly limits?: { /** Creatures never touch each other, whatever the scene's `collide` says. */ creatureCollisions?: false }
  /** Settings left out take the stdlib's `Defaults.physics` (see `resolvePhysics`). `collide`: creatures bump into each other (never into their own parts). */
  createWorld(opts: Partial<PhysicsSettings>): PhysicsWorld
}

/** A square heightfield centered on the origin: `heights[ix * (n + 1) + iz]`, `n` cells per side. */
export interface HeightfieldDef {
  size: number
  n: number
  heights: Float32Array
}

export interface PhysicsWorld {
  setTerrain(t: HeightfieldDef | null): void
  /** Build the body in its standing pose, then turn it by `yaw` radians about y and move it to (x, y, z). */
  addArticulation(body: BodyDef, at: { x: number; y: number; z: number; yaw: number }): Articulation
  removeArticulation(a: Articulation): void
  /** Advance by `dt` seconds. The caller picks the fixed step. */
  step(dt: number): void
  /** Copy the whole engine state. `arts` is the creatures in the order the caller will want them back. */
  snapshot(arts: Articulation[]): unknown
  /** Go back to a snapshot, re-pointing `arts` (the same number, in the same order) at the restored bodies. They may be fresh articulations from a new world. */
  restore(snapshot: unknown, arts: Articulation[]): void
  /** Fingerprint of every dynamic body's pose and velocity, for determinism tests. */
  hash(): string
  dispose(): void
}

export interface Articulation {
  readonly partCount: number
  readonly jointCount: number
  /** Write 7 numbers per part (x, y, z, qx, qy, qz, qw) starting at `offset`. Part 0 is the root. */
  readPoses(out: Float32Array, offset: number): void
  /** Linear velocity of the root part. */
  readRootVelocity(out: Float32Array | number[], offset: number): void
  /** Write 6 numbers per part starting at `offset`: the part's linear velocity (x, y, z), then its angular velocity (x, y, z), in the world frame, at its center of mass. */
  readVelocities(out: Float32Array | number[], offset: number): void
  /**
   * Push on every part for the next step: 6 numbers per part, a force (x, y, z, newtons) then a torque (x, y, z, newton-metres), in the world frame, acting at the
   * part's center of mass. It replaces whatever was set before and holds until the next call, so a caller that wants a force for one tick sets it every tick.
   */
  applyForces(forces: ArrayLike<number>): void
  /** Hinge angle of every joint in body order, radians (0 for non-hinge joints). */
  readAngles(out: Float32Array | number[], offset: number): void
  /** Point every motor at its target angle, never pushing harder than `maxTorque` (Infinity: no limit). Arrays have one entry per joint in body order; joints without a motor ignore them. */
  setMotors(targets: ArrayLike<number>, stiffness: ArrayLike<number>, damping: ArrayLike<number>, maxTorque?: ArrayLike<number>): void
}
