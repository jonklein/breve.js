import { type VecLike, toVec } from './vec'

/** What `Fluid.forces` needs to know about a part: the fields of an entry of a creature's `self.parts`. */
export interface FluidPart {
  /** `box`, `sphere`, `capsule` or `cylinder`. */
  shape: string
  /** The shape's own measurements: box `[w, h, d]`, sphere `[r]`, capsule and cylinder `[length, r]`. */
  size: number[]
  /** Kilograms. Used only to keep drag from over-correcting in one step. */
  mass: number
  position: { x: number; y: number; z: number }
  /** How the shape is turned in the world. */
  rotation: { x: number; y: number; z: number; w: number }
  /** Linear velocity of the part's center, and its angular velocity, in the world frame. */
  velocity: { x: number; y: number; z: number }
  angularVelocity: { x: number; y: number; z: number }
}

/** The water and the air around a creature. Every field is optional. */
export interface FluidMedium {
  /** Height of the water surface (world y). Default 0. Use `-Infinity` for no water, `Infinity` for everything under it. */
  level?: number
  /** Kilograms per cubic meter of water. Default 1000. */
  density?: number
  /** Kilograms per cubic meter of the air above the surface. Default 1.2. */
  airDensity?: number
  /** Meters per second squared, the pull that buoyancy answers. Default 9.81, the engine's own. */
  gravity?: number
  /** How strongly a shape resists moving through the fluid, as a multiplier on the default coefficient of 1. 0 turns drag off. Default 1. */
  drag?: number
  /** The same for spinning. Default 1. */
  angularDrag?: number
  /** How much of the usual drag a part keeps when it moves along its own length (a box's x, a capsule's or cylinder's y): 1 (the default) treats every direction alike, 0.2 is a streamlined body that slips through the water head first but still pushes against it sideways. */
  lengthwise?: number
  /** The velocity of the water itself (a current), as a vector or a function of position. Default still water. Air is taken to be still. */
  current?: VecLike | ((p: { x: number; y: number; z: number }) => VecLike)
  /** Meters above a part's center, along the part's own up (local y), where its lift acts. A positive number makes a creature right itself like a boat with its weight low; 0 (the default) lifts at the center, so it never rights itself. */
  buoyancyHeight?: number
  /** Seconds per tick; drag is capped so a step can slow a part to rest but never reverse it. Default 1/60. */
  dt?: number
}

/** The force and torque on one part, in the world frame, ready to return from `act` as `{ forces }`. */
export interface FluidPush { force: [number, number, number]; torque: [number, number, number] }

type V = [number, number, number]

// the world-frame direction of a part's local x, y and z axes: the columns of its rotation matrix
function axes(q: { x: number; y: number; z: number; w: number }): [V, V, V] {
  const { x, y, z, w } = q
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  ]
}

const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Half the shape's size along its own x, y and z; its volume; and the area it shows when seen along each of those axes. */
function measure(shape: string, s: number[]): { half: V; volume: number; area: V } {
  switch (shape) {
    case 'sphere': { const r = s[0]; return { half: [r, r, r], volume: (4 / 3) * Math.PI * r ** 3, area: [Math.PI * r * r, Math.PI * r * r, Math.PI * r * r] } }
    case 'capsule': case 'cylinder': {
      const L = s[0], r = s[1], cap = shape === 'capsule' ? r : 0
      return {
        half: [r, L / 2 + cap, r],
        volume: Math.PI * r * r * L + (shape === 'capsule' ? (4 / 3) * Math.PI * r ** 3 : 0),
        area: [2 * r * (L + 2 * cap), Math.PI * r * r, 2 * r * (L + 2 * cap)],
      }
    }
    default: { const [w, h, d] = s; return { half: [w / 2, h / 2, d / 2], volume: w * h * d, area: [h * d, w * d, w * h] } }
  }
}

/**
 * Buoyancy and drag for creatures in water and air. The engine has no fluid; this works out the push a fluid would give each
 * part, and a script returns it from `act` as `forces` (the push lasts one tick, so ask again every tick):
 * `return { joints, forces: Fluid.forces(self.parts, { level: 0 }) }`.
 *
 * A part below `level` floats with a force of `density * gravity * volume`, scaled by how much of it is under (judged from its
 * height in the world, so a tilted box is handled); with a mass of `density * volume` it hangs in the water, lighter floats, denser sinks.
 * Moving through the fluid costs a force against the motion, quadratic in speed and different along each of the part's own axes
 * (a flat paddle pushed face-on resists far more than edge-on, which is what makes fins and tails swim). Fluid above the surface
 * is air with its own, thin, density. Simplified on purpose: no waves, no added mass, buoyancy acts at the center of the part.
 */
export class Fluid {
  /** The push on every part, by part name: `{ torso: { force, torque }, tail: { ... } }`. */
  static forces(parts: Record<string, FluidPart>, medium: FluidMedium = {}): Record<string, FluidPush> {
    const out: Record<string, FluidPush> = {}
    for (const [name, p] of Object.entries(parts)) out[name] = Fluid.push(p, medium)
    return out
  }

  /** The push on one part. */
  static push(p: FluidPart, medium: FluidMedium = {}): FluidPush {
    const level = medium.level ?? 0, rho = medium.density ?? 1000, rhoAir = medium.airDensity ?? 1.2
    const length = medium.lengthwise ?? 1, g = medium.gravity ?? 9.81, cd = 1 * (medium.drag ?? 1), cdAng = medium.angularDrag ?? 1, dt = medium.dt ?? 1 / 60
    const { half, volume, area } = measure(p.shape, p.size)
    const ax = axes(p.rotation)

    // how much of the part is under the surface: its height range in the world is its center plus or minus the shadow of its shape on up
    const reach = Math.abs(ax[0][1]) * half[0] + Math.abs(ax[1][1]) * half[1] + Math.abs(ax[2][1]) * half[2]
    const under = reach < 1e-9 ? (p.position.y < level ? 1 : 0) : Math.min(1, Math.max(0, (level - (p.position.y - reach)) / (2 * reach)))
    const medDensity = under * rho + (1 - under) * rhoAir

    const flow = typeof medium.current === 'function' ? toVec(medium.current(p.position)) : medium.current ? toVec(medium.current) : null
    const rel: V = [p.velocity.x - (flow ? flow.x * under : 0), p.velocity.y - (flow ? flow.y * under : 0), p.velocity.z - (flow ? flow.z * under : 0)]

    const force: V = [0, g * rho * volume * under, 0]
    // lift acting above the center turns a tilted part back upright: torque = arm x lift
    const torque: V = [0, 0, 0]
    const arm = medium.buoyancyHeight ?? 0
    if (arm !== 0) {
      const a = ax[1], lift = force[1]
      torque[0] += -arm * a[2] * lift
      torque[2] += arm * a[0] * lift
    }
    // drag along each of the part's own axes, then turned back to the world; capped at what stops the motion in one tick
    const longAxis = p.shape === 'capsule' || p.shape === 'cylinder' ? 1 : 0
    for (let i = 0; i < 3; i++) {
      const v = dot(rel, ax[i])
      if (v === 0) continue
      const push = -Math.sign(v) * Math.min(0.5 * medDensity * cd * (i === longAxis ? length : 1) * area[i] * v * v, (p.mass * Math.abs(v)) / dt / 1.5)
      for (let k = 0; k < 3; k++) force[k] += push * ax[i][k]
    }

    // spin is resisted by the same fluid, scaled by the part's size to the fifth power (a long thin part resists most about its ends)
    const reachMax = Math.max(half[0], half[1], half[2])
    const spin: V = [p.angularVelocity.x, p.angularVelocity.y, p.angularVelocity.z]
    const inertia = Math.max(1e-9, (p.mass * reachMax * reachMax) / 3)
    for (let i = 0; i < 3; i++) {
      const w = dot(spin, ax[i])
      if (w === 0) continue
      const other = half[(i + 1) % 3] * half[(i + 2) % 3] * (half[(i + 1) % 3] ** 2 + half[(i + 2) % 3] ** 2) // the extent it sweeps while turning about this axis
      const push = -Math.sign(w) * Math.min(0.5 * medDensity * cdAng * other * 2 * Math.abs(w) * Math.abs(w), (inertia * Math.abs(w)) / dt / 1.5)
      for (let k = 0; k < 3; k++) torque[k] += push * ax[i][k]
    }
    return { force, torque }
  }
}
