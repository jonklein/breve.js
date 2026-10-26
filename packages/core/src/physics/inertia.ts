import type { PartDef } from '../body'

/** Rotational inertia about each of a part's own axes for its mass, from its shape (a capsule is treated as a cylinder with its caps). Shared by every engine adapter. */
export function partInertia(p: PartDef): [number, number, number] {
  const m = p.mass, s = p.size
  switch (p.shape) {
    case 'box': return [m * (s[1] ** 2 + s[2] ** 2) / 12, m * (s[0] ** 2 + s[2] ** 2) / 12, m * (s[0] ** 2 + s[1] ** 2) / 12]
    case 'sphere': { const i = 0.4 * m * s[0] ** 2; return [i, i, i] }
    default: { // long axis is y; `size` is [straight length, radius]
      const h = p.shape === 'capsule' ? s[0] + 2 * s[1] : s[0], r = s[1]
      const side = m * (3 * r * r + h * h) / 12
      return [side, 0.5 * m * r * r, side]
    }
  }
}

/** `partInertia` with each component raised to at least mass times `minGyration` squared (see `physics.minGyration` in the scene). */
export function flooredInertia(p: PartDef, minGyration: number): [number, number, number] {
  const floor = p.mass * minGyration * minGyration
  return partInertia(p).map((v) => Math.max(v, floor)) as [number, number, number]
}
