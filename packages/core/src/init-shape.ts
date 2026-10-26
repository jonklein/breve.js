/** Keys of an `init` result that mean something other than state (free agents start with a place and a heading). */
const RESERVED = new Set(['position', 'velocity'])

/**
 * What an `init` returned, as state values by name. State is the plain keys (`return { alive: 1, age: 0 }`). `position` and `velocity` are left out: they are not state.
 */
export function initResult(out: unknown): Record<string, unknown> {
  if (!out || typeof out !== 'object') return {}
  const o = out as Record<string, unknown>
  return Object.fromEntries(Object.entries(o).filter(([k]) => !RESERVED.has(k)))
}
