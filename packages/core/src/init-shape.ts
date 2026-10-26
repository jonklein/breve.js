import type { StateDef } from './scene'

/** Keys of an `init` result that mean something other than state (free agents start with a place and a heading). */
const RESERVED = new Set(['position', 'velocity'])

/**
 * What an `init` returned, as state values by name. State is the plain keys (`return { alive: 1, age: 0 }`); the older form
 * `{ state: { ... } }` still works. `position` and `velocity` are left out: they are not state.
 */
export function initResult(out: unknown): Record<string, unknown> {
  if (!out || typeof out !== 'object') return {}
  const o = out as Record<string, unknown>
  if (o.state && typeof o.state === 'object' && !Array.isArray(o.state)) return o.state as Record<string, unknown>
  return Object.fromEntries(Object.entries(o).filter(([k]) => !RESERVED.has(k)))
}

/** The state field a value implies: what kind it is, and its length when it is an array. It starts at zero (or false, or empty). */
export function stateDefOf(v: unknown): StateDef | null {
  if (typeof v === 'number') return 0
  if (typeof v === 'boolean') return false
  if (typeof v === 'string') return { init: '' }
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const n = (v as ArrayLike<unknown>).length
    return n > 0 && typeof (v as ArrayLike<unknown>)[0] === 'number' ? { length: n, init: 0 } : null
  }
  return null
}
