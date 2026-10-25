// @ts-expect-error d3-force-3d ships no type declarations
import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force-3d'
import type { Rng } from './rng'
import type { Edges } from './graph'

/**
 * Where to draw each node of a network (display only: nothing in the simulation reads these). `force` spreads
 * linked nodes toward each other and unlinked ones apart (the d3-force-3d library, run to rest once);
 * `circle` and `sphere` are plain arrangements. Positions fill a ball of the given radius, three numbers per node.
 */
export function layoutNodes(n: number, edges: Edges, kind: 'force' | 'circle' | 'sphere', radius: number, rng: Rng): Float32Array {
  const out = new Float32Array(n * 3)
  if (n === 0) return out
  if (kind === 'circle') {
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out[i * 3] = Math.cos(a) * radius; out[i * 3 + 2] = Math.sin(a) * radius }
    return out
  }
  if (kind === 'sphere') {
    // a spiral over the sphere keeps points evenly spread
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5))
      out[i * 3] = Math.cos(a) * r * radius; out[i * 3 + 1] = y * radius; out[i * 3 + 2] = Math.sin(a) * r * radius
    }
    return out
  }
  const nodes: { index: number; x?: number; y?: number; z?: number }[] = Array.from({ length: n }, (_, i) => ({ index: i }))
  const links = edges.map(([source, target]) => ({ source, target }))
  const sim = forceSimulation(nodes, 3)
    .randomSource(() => rng.next())
    .force('link', forceLink(links).distance(radius / 8).strength(0.7))
    .force('charge', forceManyBody().strength(-Math.max(2, radius / 6)))
    .force('center', forceCenter())
    .stop()
  const ticks = Math.min(300, 60 + Math.ceil(2000 / Math.max(1, Math.sqrt(n))))
  for (let t = 0; t < ticks; t++) sim.tick()
  let big = 0
  for (const d of nodes) big = Math.max(big, Math.hypot(d.x ?? 0, d.y ?? 0, d.z ?? 0))
  const k = big > 0 ? radius / big : 1
  nodes.forEach((d, i) => { out[i * 3] = (d.x ?? 0) * k; out[i * 3 + 1] = (d.y ?? 0) * k; out[i * 3 + 2] = (d.z ?? 0) * k })
  return out
}
