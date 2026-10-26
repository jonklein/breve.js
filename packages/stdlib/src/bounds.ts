import { toVec, Vec3, type VecLike } from './vec'

/**
 * Keeping entities inside a box, for scripts that want it. The engine does not: an entity with no edge handling flies on forever.
 * `ctx.world.size` is the scene's `bounds.size`, the half-width of the box around the origin.
 */
export class Bounds {
  /**
   * A gentle push back toward the middle, as an acceleration to add to the steering. It is zero inside the box except for the outer
   * `margin` (a share of the half-width, default 0.15) and grows with how far past that line an entity is, on each axis:
   * `steer: yourSteering.plus(ctx.bounds.soft(self.position, ctx.world.size))`. `strength` is per second (default 4); `flat` leaves
   * the vertical axis alone, for entities that live on the ground plane.
   */
  static soft(position: VecLike, size: number, options: { margin?: number; strength?: number; flat?: boolean } = {}): Vec3 {
    const p = toVec(position)
    const start = size * (1 - (options.margin ?? 0.15)), k = options.strength ?? 4
    const push = (v: number) => (Math.abs(v) > start ? -Math.sign(v) * (Math.abs(v) - start) * k : 0)
    return new Vec3(push(p.x), options.flat ? 0 : push(p.y), push(p.z))
  }

  /**
   * Where to put an entity that has gone past a wall, and the velocity it leaves with, bouncing off each wall it crossed; `null` while it
   * is inside. Hand the result to `self.place(...)`: `const hit = ctx.bounds.bounce(self.position, self.velocity, ctx.world.size); if (hit) self.place(hit)`.
   */
  static bounce(position: VecLike, velocity: VecLike, size: number): { position: Vec3; velocity: Vec3 } | null {
    const p = toVec(position), v = toVec(velocity)
    let hit = false
    const axis = (x: number, dx: number): [number, number] => {
      if (Math.abs(x) <= size) return [x, dx]
      hit = true
      return [Math.sign(x) * size, -dx]
    }
    const [px, vx] = axis(p.x, v.x), [py, vy] = axis(p.y, v.y), [pz, vz] = axis(p.z, v.z)
    return hit ? { position: new Vec3(px, py, pz), velocity: new Vec3(vx, vy, vz) } : null
  }
}
