import type { Rng } from './rng'
import type { NetworkDef } from './scene'

/** Undirected edges as [a, b] pairs with a < b, no repeats, no self-loops. */
export type Edges = [number, number][]

/** Edges stored for fast "who are my neighbors": `targets[offsets[i] .. offsets[i + 1])` are node i's neighbors. */
export interface Adjacency {
  offsets: Int32Array
  targets: Int32Array
}

class EdgeSet {
  private seen = new Set<number>()
  readonly list: Edges = []
  constructor(private n: number) {}
  has(a: number, b: number): boolean { return this.seen.has(a < b ? a * this.n + b : b * this.n + a) }
  add(a: number, b: number): boolean {
    if (a === b || this.has(a, b)) return false
    this.seen.add(a < b ? a * this.n + b : b * this.n + a)
    this.list.push(a < b ? [a, b] : [b, a])
    return true
  }
}

/** Make the edges of a network of `n` nodes the way the scene asks, drawing any randomness from the sim's generator. */
export function makeEdges(def: NetworkDef, n: number, rng: Rng): Edges {
  const k = Math.max(0, Math.round(def.degree ?? 4))
  const set = new EdgeSet(n)
  switch (def.topology ?? 'smallworld') {
    case 'edges':
      for (const [a, b] of def.edges ?? []) if (a >= 0 && b >= 0 && a < n && b < n) set.add(a, b)
      break
    case 'ring':
      for (let i = 0; i < n; i++) for (let j = 1; j <= Math.floor(k / 2); j++) set.add(i, (i + j) % n)
      break
    case 'complete':
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) set.add(i, j)
      break
    case 'random': {
      // Erdős–Rényi: every pair is linked with the probability that gives the wanted average degree
      const p = n > 1 ? Math.min(1, k / (n - 1)) : 0
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rng.next() < p) set.add(i, j)
      break
    }
    case 'smallworld': {
      // Watts–Strogatz: a ring, then each link is rewired to a random node with probability `rewire`
      const rewire = def.rewire ?? 0.1
      const ring: Edges = []
      for (let i = 0; i < n; i++) for (let j = 1; j <= Math.floor(k / 2); j++) ring.push([i, (i + j) % n])
      for (const [a, b] of ring) set.add(a, b)
      const out = new EdgeSet(n)
      for (const [a, b] of ring) {
        if (rng.next() < rewire) {
          for (let tries = 0; tries < 20; tries++) {
            const c = Math.floor(rng.next() * n)
            if (c !== a && !out.has(a, c) && !set.has(a, c)) { out.add(a, c); break }
            if (tries === 19) out.add(a, b)
          }
        } else out.add(a, b)
      }
      return out.list
    }
    case 'scalefree': {
      // Barabási–Albert: each new node links to `degree / 2` earlier nodes, favoring the well connected
      const m = Math.max(1, Math.floor(k / 2))
      const ends: number[] = [] // every edge end, so picking one is picking in proportion to degree
      const start = Math.min(n, m + 1)
      for (let i = 0; i < start; i++) for (let j = i + 1; j < start; j++) { set.add(i, j); ends.push(i, j) }
      for (let v = start; v < n; v++) {
        let added = 0
        for (let tries = 0; added < m && tries < 50 * m; tries++) {
          const u = ends[Math.floor(rng.next() * ends.length)] ?? Math.floor(rng.next() * v)
          if (set.add(v, u)) { ends.push(v, u); added++ }
        }
      }
      break
    }
  }
  return set.list
}

export function adjacency(n: number, edges: Edges): Adjacency {
  const deg = new Int32Array(n + 1)
  for (const [a, b] of edges) { deg[a + 1]++; deg[b + 1]++ }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i]
  const targets = new Int32Array(deg[n])
  const fill = deg.slice(0, n)
  for (const [a, b] of edges) { targets[fill[a]++] = b; targets[fill[b]++] = a }
  return { offsets: deg, targets }
}
