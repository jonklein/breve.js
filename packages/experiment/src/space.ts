import type { Scene } from '@breve/core'

/** One searched parameter: a range (maybe stepped) or a list of values. Strategies work in the unit cube; a Dim turns a point on [0, 1] into a real value. */
export interface Dim {
  name: string
  /** Number of distinct values, or Infinity for a continuous range. */
  count: number
  decode(u: number): number
  /** The values a grid visits when it takes `steps` samples of a continuous range (all of a list). */
  gridPoints(steps: number): number[]
}

export type SpaceSpec = string[] | Record<string, boolean | { min?: number; max?: number; step?: number; integer?: boolean } | number[]>

function round(v: number, step: number | undefined, integer: boolean | undefined, lo: number, hi: number): number {
  let x = v
  if (step && step > 0) x = lo + Math.round((x - lo) / step) * step
  if (integer) x = Math.round(x)
  return Math.min(hi, Math.max(lo, Number(x.toPrecision(10))))
}

/** Build the dimensions of the search. A name alone (or `true`, or `{}`) uses the range the scene gives that param. */
export function makeDims(space: SpaceSpec, scene: Scene): Dim[] {
  const entries: [string, boolean | { min?: number; max?: number; step?: number; integer?: boolean } | number[]][] = Array.isArray(space) ? space.map((n) => [n, true]) : Object.entries(space)
  if (!entries.length) throw new Error('"space" must name at least one param to vary')
  return entries.map(([name, spec]) => {
    const def = scene.params[name]
    if (def === undefined) throw new Error(`space: the scene has no param "${name}" (it has: ${Object.keys(scene.params).join(', ')})`)
    if (Array.isArray(spec)) {
      if (!spec.length) throw new Error(`space.${name}: the list of values is empty`)
      const values = [...spec]
      return { name, count: values.length, decode: (u) => values[Math.min(values.length - 1, Math.floor(u * values.length))], gridPoints: () => values }
    }
    const s = typeof spec === 'object' ? spec : {}
    const given: { min?: number; max?: number; step?: number } = typeof def === 'number' ? {} : def
    const lo = s.min ?? given.min
    const hi = s.max ?? given.max
    if (lo === undefined || hi === undefined) throw new Error(`space.${name}: needs "min" and "max" (the scene's param has no range to use)`)
    if (!(hi > lo)) throw new Error(`space.${name}: "max" must be greater than "min"`)
    const step = s.step ?? given.step
    const integer = s.integer
    const count = step && step > 0 ? Math.floor((hi - lo) / step + 1e-9) + 1 : integer ? Math.round(hi - lo) + 1 : Infinity
    return {
      name,
      count,
      decode: (u) => round(lo + Math.min(1, Math.max(0, u)) * (hi - lo), step, integer, lo, hi),
      gridPoints: (steps) => {
        const n = Math.min(steps, count)
        return Array.from({ length: n }, (_, i) => round(lo + ((hi - lo) * i) / Math.max(1, n - 1), step, integer, lo, hi))
      },
    }
  })
}
