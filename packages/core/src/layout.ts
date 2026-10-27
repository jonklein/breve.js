// @ts-expect-error d3-force-3d ships no type declarations
import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force-3d'
import type { Rng } from './rng'
import type { Edges } from './graph'

export type LayoutKind = 'force' | 'circle' | 'sphere' | 'grid' | 'random' | 'radial'

/**
 * Where to draw each node of a network (display only: nothing in the simulation reads these). `force` spreads
 * linked nodes toward each other and unlinked ones apart (the d3-force-3d library, run to rest once);
 * `circle`, `sphere`, `grid` (a cube lattice) and `random` are plain arrangements; `radial` puts the best-linked node
 * in the middle and each ring is one more link away from it. Positions fill a ball of the given radius, three numbers per node.
 */
export function layoutNodes(n: number, edges: Edges, kind: LayoutKind, radius: number, rng: Rng): Float32Array {
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
  if (kind === 'grid') {
    const side = Math.ceil(Math.cbrt(n)), step = side > 1 ? (2 * radius) / (side - 1) : 0
    for (let i = 0; i < n; i++) {
      out[i * 3] = ((i % side) - (side - 1) / 2) * step
      out[i * 3 + 1] = ((Math.floor(i / side) % side) - (side - 1) / 2) * step
      out[i * 3 + 2] = ((Math.floor(i / (side * side))) - (side - 1) / 2) * step
    }
    return out
  }
  if (kind === 'random') {
    // uniform in a ball: cube root of a uniform draw for the distance, a random direction for the angle
    for (let i = 0; i < n; i++) {
      const y = rng.next() * 2 - 1, r = Math.sqrt(1 - y * y), a = rng.next() * Math.PI * 2, d = Math.cbrt(rng.next()) * radius
      out[i * 3] = Math.cos(a) * r * d; out[i * 3 + 1] = y * d; out[i * 3 + 2] = Math.sin(a) * r * d
    }
    return out
  }
  if (kind === 'radial') {
    const adj: number[][] = Array.from({ length: n }, () => [])
    for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a) }
    let root = 0
    for (let i = 1; i < n; i++) if (adj[i].length > adj[root].length) root = i
    const depth = new Int32Array(n).fill(-1)
    const queue = [root]
    depth[root] = 0
    for (let q = 0; q < queue.length; q++) for (const m of adj[queue[q]]) if (depth[m] < 0) { depth[m] = depth[queue[q]] + 1; queue.push(m) }
    let deepest = 0
    for (let i = 0; i < n; i++) deepest = Math.max(deepest, depth[i])
    // nodes with no path to the root form one last ring
    for (let i = 0; i < n; i++) if (depth[i] < 0) depth[i] = deepest + 1
    const rings = deepest + (depth.some((d) => d === deepest + 1) ? 1 : 0)
    const seen = new Int32Array(rings + 2), size = new Int32Array(rings + 2)
    for (let i = 0; i < n; i++) size[depth[i]]++
    for (let i = 0; i < n; i++) {
      const d = depth[i], a = (seen[d]++ / size[d]) * Math.PI * 2 + d * 0.7
      const r = rings > 0 ? (d / rings) * radius : 0
      out[i * 3] = Math.cos(a) * r; out[i * 3 + 2] = Math.sin(a) * r
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
