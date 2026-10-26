import { looksOfAll, looksOf } from './display'
import { initResult } from './init-shape'
import { Field, Nums, type NeighborTable } from '@breve/stdlib'
import { adjacency, makeEdges, type Adjacency, type Edges } from './graph'
import { layoutNodes } from './layout'
import { fillList, resolve, stateFields, type Params, type StateField } from './scene'
import { Table, type ColumnType, type TableSnapshot } from './store'
import { actAllOf, actOf, type Ctx, type FrameData, type Host, type MetricInput, type World } from './world'

const LAYOUT = { px: 'f32', py: 'f32', pz: 'f32' } as const
const RESERVED = new Set(['exchange', 'px', 'py', 'pz'])

/** One link in a trade: give some of your own fields to a linked node, take some of its fields. */
export interface Exchange {
  with: { row: number }
  give?: Record<string, number>
  get?: Record<string, number>
}

/**
 * Nodes joined by links. A node's script sees the nodes it is linked to as `neighbors`, exactly like a lattice cell
 * sees the cells around it, so one rule can run on a grid or on a graph. Like cells, nodes return their new state;
 * a node may also return `exchange: [{ with: neighbor, give: { goods: 1 }, get: { cash: 3 } }]`, a trade that
 * happens whole or not at all (neither side may go below zero), in an order shuffled from the sim's seed.
 */
export class NetworkWorld implements World {
  readonly table: Table<string>
  private fields: StateField[]
  private fieldOf: Record<string, StateField> = {}
  private n: number
  private edges: Edges
  private adj: Adjacency
  private layout: Float32Array
  /** Bumped when the links change, so a view knows to redraw them. */
  private version = 1
  /** Rejected trades since the last look: a trade that would overdraw either side is simply not made. */
  trades = { made: 0, refused: 0 }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private Node: new (row: number) => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private Nodes: new () => any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private made: any[] | null = null

  constructor(private host: Host, from?: NetworkWorld) {
    const def = host.def
    const net = def.network!
    this.n = Math.max(0, Math.min(100000, Math.round(resolve(def.count, host.params, 0))))
    this.fields = stateFields(def.state)
    for (const f of this.fields) {
      if (RESERVED.has(f.name)) throw new Error(`"${f.name}" cannot be a state field of a network (it is a reserved name)`)
      this.fieldOf[f.name] = f
    }
    const schema: Record<string, ColumnType> = { ...LAYOUT }
    const strides: Record<string, number> = {}
    for (const f of this.fields) { schema[f.name] = f.type as ColumnType; strides[f.name] = f.length }
    this.table = new Table(schema, Math.max(this.n, 1), strides)
    for (let i = 0; i < this.n; i++) this.table.spawn()

    // links and layout come from the seed alone, so a fork of the same scene reuses them
    if (from && from.n === this.n && JSON.stringify(from.host.def.network) === JSON.stringify(net)) {
      this.edges = from.edges; this.adj = from.adj; this.layout = from.layout; this.version = from.version
    } else {
      this.edges = makeEdges(net, this.n, host.rng)
      this.adj = adjacency(this.n, this.edges)
      this.layout = layoutNodes(this.n, this.edges, net.layout ?? 'force', net.radius ?? 20, host.rng)
    }
    const c = this.table.cols
    for (let i = 0; i < this.n; i++) { c.px[i] = this.layout[i * 3]; c.py[i] = this.layout[i * 3 + 1]; c.pz[i] = this.layout[i * 3 + 2] }
    const { Node, Nodes } = this.makeTypes()
    this.Node = Node
    this.Nodes = Nodes
    for (let r = 0; r < this.n; r++) this.initState(r)
    if (!from) { this.applyInit(); this.fill() }
  }

  private initState(r: number): void {
    const rng = this.host.rng
    for (const f of this.fields) {
      const col = this.table.cols[f.name]
      const init = f.init
      if (init === undefined) continue
      for (let k = 0; k < f.length; k++) {
        const i = r * f.length + k
        if (typeof init === 'number') col[i] = init
        else if (typeof init === 'boolean') col[i] = init ? 1 : 0
        else if (typeof init === 'string') (col as unknown as string[])[i] = init
        else if ('normal' in init) col[i] = init.normal * Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next())
        else col[i] = rng.range(init.uniform[0], init.uniform[1])
      }
    }
  }

  /** Run the script's `init` (a node at a time) or `initAll` (every node at once): they say what the nodes start as. */
  private applyInit(): void {
    const ctrl = this.host.controller()
    if (!ctrl?.init && !ctrl?.initAll) return
    const ctx = this.host.ctx(), { params } = this.host
    const unknown = new Set<string>()
    const field = (name: string): StateField | undefined => {
      const f = this.fieldOf[name]
      if (!f && !unknown.has(name)) { unknown.add(name); this.host.fail('init', new Error(`state "${name}" does not exist: a set's state is what its init returns (or the scene's "state")`)) }
      return f
    }
    try {
      if (ctrl.initAll) {
        for (const [name, v] of Object.entries((ctrl.initAll({ count: this.n }, params, ctx) ?? {}) as Record<string, unknown>)) {
          const f = field(name)
          if (!f) continue
          const data = (v instanceof Field ? v.data : v) as ArrayLike<unknown>
          if (!data || data.length !== this.n) { this.host.fail('init', new Error(`"${name}" must have one value per node (${this.n}), got ${data?.length ?? 'none'}`)); continue }
          for (let r = 0; r < this.n; r++) this.write(f, r, data[r])
        }
        return
      }
      for (let r = 0; r < this.n; r++) {
        for (const [name, v] of Object.entries(initResult(ctrl.init!({ index: r, count: this.n }, params, ctx)))) {
          const f = field(name)
          if (f) this.write(f, r, v)
        }
      }
    } catch (e) {
      this.host.fail('init', e)
    }
  }

  /** Starting values: a share of the nodes (`density`) or an exact number of them (`count`). */
  private fill(): void {
    for (const f of fillList(this.host.def.fill)) {
      const col = this.table.cols[f.field]
      const value = f.value ?? 1
      if (f.count !== undefined) {
        // pick exactly `count` distinct nodes: a partial shuffle driven by the seed
        const order = Array.from({ length: this.n }, (_, i) => i)
        for (let i = 0; i < Math.min(f.count, this.n); i++) {
          const j = i + Math.floor(this.host.rng.next() * (this.n - i))
          ;[order[i], order[j]] = [order[j], order[i]]
          col[order[i]] = value
        }
      } else {
        const density = resolve(f.density, this.host.params, 1)
        for (let r = 0; r < this.n; r++) if (density >= 1 || this.host.rng.next() < density) col[r] = value
      }
    }
  }

  private makeTypes() {
    const table = this.table
    const world = this
    const boolean = Object.fromEntries(this.fields.map((f) => [f.name, f.kind === 'boolean']))
    const readOnly = () => { throw new Error('nodes are read-only inside act(): return the new state instead, like `return { status: 1 }`') }
    class Node {
      constructor(readonly row: number) {}
      /** How many links this node has. */
      get degree() { return world.adj.offsets[this.row + 1] - world.adj.offsets[this.row] }
      get x() { return table.cols.px[this.row] }
      get y() { return table.cols.py[this.row] }
      get z() { return table.cols.pz[this.row] }
    }
    class Nodes extends Array<Node> {
      static get [Symbol.species]() { return Array }
      isEmpty(): boolean { return this.length === 0 }
    }
    for (const f of this.fields) {
      const n = f.length
      Object.defineProperty(Node.prototype, f.name, {
        get(this: Node) {
          const col = table.cols[f.name]
          if (f.array) return col.subarray(this.row * n, (this.row + 1) * n)
          return boolean[f.name] ? col[this.row] !== 0 : col[this.row]
        },
        set: readOnly,
        enumerable: true,
      })
      Object.defineProperty(Nodes.prototype, f.name, {
        get(this: Nodes) { const out = new Nums(); for (const c of this) out.push((c as never)[f.name]); return out },
        enumerable: true,
      })
    }
    return { Node, Nodes: Nodes as unknown as new () => unknown[] }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get handles(): any[] {
    if (!this.made) { this.made = new Array(this.n); for (let r = 0; r < this.n; r++) this.made[r] = new this.Node(r) }
    return this.made
  }

  private neighborsOf(row: number) {
    const out = new this.Nodes()
    const { offsets, targets } = this.adj
    for (let k = offsets[row]; k < offsets[row + 1]; k++) out.push(this.handles[targets[k]])
    return out
  }

  sceneChanged(): void {
    /* the number of nodes and their links only change on reset; rule params are read live */
  }

  /** Linked nodes in the fixed-width table `Field` works on, built when the links change. */
  private neighborTable: NeighborTable | null = null
  private neighborTableFor: Adjacency | null = null

  private table_(): NeighborTable {
    if (this.neighborTable && this.neighborTableFor === this.adj) return this.neighborTable
    // the links are already stored back to back (CSR), which is exactly what a table with `start` offsets wants
    const { offsets, targets } = this.adj
    const count = new Int32Array(this.n)
    for (let r = 0; r < this.n; r++) count[r] = offsets[r + 1] - offsets[r]
    this.neighborTableFor = this.adj
    return (this.neighborTable = { nbr: targets, count, stride: 0, start: offsets })
  }

  /**
   * The whole-network rule, like a lattice's: `actAll(fields, params, ctx)` gets every single-number state field as a
   * `Field` whose neighbor operations follow the links, and returns the new fields (any it leaves out stay as they are).
   */
  private stepFields(rule: (f: Record<string, Field>, p: Params, ctx: Ctx) => unknown): void {
    const table = this.table_()
    const cols = this.table.cols
    const numeric = this.fields.filter((f) => f.kind !== 'string' && f.length === 1)
    const fields: Record<string, Field> = {}
    for (const f of numeric) fields[f.name] = new Field(cols[f.name], table)
    let out: Record<string, unknown> | null = null
    try {
      const r = rule(fields, this.host.params, this.host.ctx())
      out = r && typeof r === 'object' ? (r as Record<string, unknown>) : null
    } catch (e) {
      this.host.fail('actAll', e)
    }
    if (!out) return
    for (const f of numeric) {
      const v = out[f.name]
      if (v === undefined) continue
      const data = v instanceof Field ? v.data : (v as ArrayLike<number>)
      if (!data || data.length !== this.n) { this.host.fail('actAll', new Error(`"${f.name}" must be a field with ${this.n} nodes`)); continue }
      const dst = cols[f.name]
      for (let r = 0; r < this.n; r++) {
        const x = data[r]
        dst[r] = f.kind === 'boolean' ? (x ? 1 : 0) : f.type === 'i32' ? Math.round(x) : f.type === 'u8' ? Math.max(0, Math.min(255, Math.round(x))) : x
      }
    }
  }

  step(): void {
    const ctrl = this.host.controller()
    const all = actAllOf(ctrl)
    if (all) return this.stepFields(all)
    const act = actOf(ctrl)
    if (!act) return
    const ctx = this.host.ctx()
    const { params } = this.host
    const updates: { row: number; out: Record<string, unknown> }[] = []
    for (let row = 0; row < this.n; row++) {
      try {
        const out = act({ self: this.handles[row], neighbors: this.neighborsOf(row) }, params, ctx)
        if (out && typeof out === 'object') updates.push({ row, out: out as Record<string, unknown> })
      } catch (e) {
        this.host.fail('act', e)
      }
    }
    // every node decided from the old state; now the new state lands
    const trades: { row: number; ex: Exchange }[] = []
    for (const { row, out } of updates) {
      for (const f of this.fields) if (f.name in out) this.write(f, row, out[f.name])
      if (Array.isArray(out.exchange)) for (const ex of out.exchange as Exchange[]) trades.push({ row, ex })
    }
    this.settle(trades)
  }

  private write(f: StateField, row: number, v: unknown): void {
    const col = this.table.cols[f.name]
    if (f.kind === 'string') { (col as unknown as string[])[row] = String(v); return }
    if (f.kind === 'boolean') { col[row] = v ? 1 : 0; return }
    const vals = typeof v === 'number' ? [v] : Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v as ArrayLike<number>) : null
    if (!vals || vals.length !== f.length || vals.some((x) => !Number.isFinite(x))) { this.host.fail('act', new Error(`state "${f.name}" needs ${f.length} finite number${f.length === 1 ? '' : 's'}`)); return }
    for (let k = 0; k < f.length; k++) col[row * f.length + k] = f.type === 'i32' ? Math.round(vals[k]) : f.type === 'u8' ? Math.max(0, Math.min(255, Math.round(vals[k]))) : vals[k]
  }

  /** Make the trades nodes asked for: shuffled, each whole or not at all. */
  private settle(trades: { row: number; ex: Exchange }[]): void {
    for (let i = trades.length - 1; i > 0; i--) {
      const j = Math.floor(this.host.rng.next() * (i + 1))
      ;[trades[i], trades[j]] = [trades[j], trades[i]]
    }
    const cols = this.table.cols
    for (const { row, ex } of trades) {
      const other = ex.with?.row
      if (typeof other !== 'number' || !this.linked(row, other)) { this.host.fail('exchange', new Error('"with" must be one of the node\'s neighbors')); continue }
      const give = ex.give ?? {}, get = ex.get ?? {}
      const bad = [...Object.keys(give), ...Object.keys(get)].find((k) => !this.fieldOf[k] || this.fieldOf[k].kind !== 'number' || this.fieldOf[k].array)
      if (bad) { this.host.fail('exchange', new Error(`"${bad}" is not a number state field`)); continue }
      // both sides must be able to pay, and amounts must be sensible
      const ok = Object.entries(give).every(([k, v]) => Number.isFinite(v) && v >= 0 && cols[k][row] >= v)
        && Object.entries(get).every(([k, v]) => Number.isFinite(v) && v >= 0 && cols[k][other] >= v)
      if (!ok) { this.trades.refused++; continue }
      for (const [k, v] of Object.entries(give)) { cols[k][row] -= v; cols[k][other] += v }
      for (const [k, v] of Object.entries(get)) { cols[k][other] -= v; cols[k][row] += v }
      this.trades.made++
    }
  }

  private linked(a: number, b: number): boolean {
    const { offsets, targets } = this.adj
    for (let k = offsets[a]; k < offsets[a + 1]; k++) if (targets[k] === b) return true
    return false
  }

  /** Node colors from the script's `displayAll` (every node at once) or `display` (one at a time), or null. */
  private look(): Uint8Array | null {
    const ctrl = this.host.controller()
    const fail = (e: unknown) => this.host.fail('display', e)
    if (ctrl?.displayAll) {
      try { return looksOfAll(this.n, ctrl.displayAll(this.fieldsOf(), this.host.params, this.host.ctx()), fail).rgb } catch (e) { fail(e); return null }
    }
    const display = ctrl?.display
    return display ? looksOf(this.n, (i) => display({ self: this.handles[i] }, this.host.params, this.host.ctx()), fail).rgb : null
  }

  /** Every single-number state field as a `Field` that follows the links (what `actAll` and `displayAll` are given). */
  private fieldsOf(): Record<string, Field> {
    const table = this.table_()
    const out: Record<string, Field> = {}
    for (const f of this.fields) if (f.kind !== 'string' && f.length === 1) out[f.name] = new Field(this.table.cols[f.name], table)
    return out
  }

  frame(): FrameData {
    const net = this.host.def.network!
    const tint = net.color ? this.table.cols[net.color] : null
    const max = net.colorMax ?? 1
    const attr = tint ? new Float32Array(this.n) : null
    if (attr && tint) for (let r = 0; r < this.n; r++) attr[r] = Math.min(1, Math.max(0, tint[r] / max))
    const edges = new Uint32Array(this.edges.length * 2)
    this.edges.forEach(([a, b], i) => { edges[i * 2] = a; edges[i * 2 + 1] = b })
    const colors = this.look()
    return {
      kind: 'graph',
      count: this.n,
      size: (net.radius ?? 20) * 1.1,
      unit: 1,
      pos: this.layout.slice(),
      vel: null,
      attr,
      ...(colors ? { colors } : {}),
      graph: { edges, version: this.version, palette: net.palette, nodeSize: net.size ?? 1 },
    }
  }

  metricInput(): MetricInput {
    const nodes = new this.Nodes()
    for (const h of this.handles) nodes.push(h)
    return { nodes, count: this.n, cols: this.table.cols }
  }

  snapshot(): unknown {
    return this.table.snapshot()
  }

  restore(s: unknown): void {
    this.table.restore(s as TableSnapshot)
  }
}
