import type { Host } from './world'

/** How many of a kind a set may make: the scene's `limits` first, else the stdlib's default. Asking for more is reported, then capped. */
export function capped(host: Host, kind: 'creatures' | 'agents' | 'nodes', wanted: number, fallback: number): number {
  const cap = host.scene.limits?.[kind] ?? fallback
  if (wanted <= cap) return wanted
  host.fail('count', new Error(`"${host.def.name}" asks for ${wanted.toLocaleString()} ${kind} and the limit is ${cap.toLocaleString()}; raise it with "limits": { "${kind}": ${wanted} } in the scene if the machine can take it`))
  return cap
}
