import { looksOf, looksOfAll, type Looks } from './display'
import { initResult } from './init-shape'
import { StrColumn, Table, type Column, type ColumnType, type TableSnapshot } from './store'
import { resolve, type Params, type StateField, type StateType } from './scene'
import { Field, type NeighborTable } from '@breve/stdlib'
import { Nums, Vec3, Vecs } from '@breve/stdlib'
import { type Ctx, type FrameData, type Host, type MetricInput, type PatchLayer, type World } from './world'

const CTORS = { u8: Uint8Array, i32: Int32Array, f32: Float32Array, f64: Float64Array, str: StrColumn } as const

/** Turn whatever a rule returned into what the field stores (numbers keep their value; booleans become 0/1; text stays text). */
function coerce(f: StateField, v: unknown): number | string {
  if (f.kind === 'string') return String(v)
  if (f.kind === 'boolean') return v ? 1 : 0
  const x = Number(v)
  if (f.type === 'u8') return Math.max(0, Math.min(255, Math.round(x)))
  if (f.type === 'i32') return Math.round(x)
  return x
}

/**
 * Write a whole field into a column the way `coerce` would, cell by cell, but without a function call per cell
 * (a million-cell rule spends most of its time here otherwise).
 */
function store(dst: Column, f: StateField, data: ArrayLike<number>, n: number): void {
  if (f.kind === 'string') { for (let r = 0; r < n; r++) (dst as unknown as string[])[r] = String(data[r]); return }
  if (f.kind === 'boolean') { for (let r = 0; r < n; r++) dst[r] = data[r] ? 1 : 0; return }
  if (f.type === 'u8') { for (let r = 0; r < n; r++) { const x = Math.round(Number(data[r])); dst[r] = x < 0 ? 0 : x > 255 ? 255 : x } return }
  if (f.type === 'i32') { for (let r = 0; r < n; r++) dst[r] = Math.round(Number(data[r])); return }
  if (data.length === n && ArrayBuffer.isView(data)) { (dst as Float64Array).set(data as Float64Array); return } // f32 / f64: a plain copy
  for (let r = 0; r < n; r++) dst[r] = Number(data[r])
}

/**
 * A 3D grid of cells. Each cell is an entity; neighbors are implicit index arithmetic,
 * so a 100,000-cell grid needs no edge lists. Rules are synchronous: every cell reads
 * the old state, and the new state is written all at once at the end of the tick.
 */
export class LatticeWorld implements World, PatchLayer {
  readonly table: Table<string>
  readonly patches = this
  /** Amounts agents have queued to add to cells, applied at the start of this layer's next step. */
  private pending: Record<string, Float32Array> | null = null
  get name(): string { return this.host.def.name }
  private dims: [number, number, number]
  private n: number
  private fields: string[]
  private fieldOf: Record<string, StateField> = {}
  private types: Record<string, StateType> = {}
  private next: Record<string, Column> = {}
  private offsets: [number, number, number][] = []
  /** Neighbor rows for every cell, `stride` slots per cell, and how many of them are real. */
  private nbr = new Int32Array(0)
  private nbrCount = new Uint8Array(0)
  private stride = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private made: any[] | null = null
  private Cell!: new (row: number) => unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private Cells: new () => any[]

  constructor(private host: Host, from?: LatticeWorld) {
    const def = host.def
    const L = def.lattice!
    this.dims = L.size
    this.n = L.size[0] * L.size[1] * L.size[2]
    const sf = host.fields
    for (const f of sf) { this.fieldOf[f.name] = f; this.types[f.name] = f.type }
    this.fields = sf.map((f) => f.name)
    this.table = new Table<string>(this.types as Record<string, ColumnType>, this.n)
    for (let i = 0; i < this.n; i++) this.table.spawn()
    for (const f of sf) {
      this.next[f.name] = new CTORS[f.type](this.n) as unknown as Column
    }

    for (let dk = -1; dk <= 1; dk++)
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj && !dk) continue
          if ((di && this.dims[0] === 1) || (dj && this.dims[1] === 1) || (dk && this.dims[2] === 1)) continue // a flat grid has no neighbors "above"
          if (L.neighborhood === 'von-neumann' && Math.abs(di) + Math.abs(dj) + Math.abs(dk) !== 1) continue
          this.offsets.push([di, dj, dk])
        }

    if (from && from.nbr.length) { this.nbr = from.nbr; this.nbrCount = from.nbrCount; this.stride = from.stride } else this.buildNeighbors()
    const { Cell, Cells } = this.makeTypes()
    this.Cells = Cells
    this.Cell = Cell
    if (!this.fields.length) host.fail('init', new Error(`"${def.name}" has no state: a lattice needs an init that returns fields (return { alive: 0 })`))
    if (!from) this.applyInit() // a fork gets its cells from the snapshot
  }

  patchAt(x: number, y: number, z: number): unknown | null {
    const row = this.rowAt(x, y, z)
    return row < 0 ? null : new this.Cell(row)
  }

  addAt(x: number, y: number, z: number, delta: Record<string, number>): void {
    const row = this.rowAt(x, y, z)
    if (row < 0) return
    this.pending ??= {}
    for (const [f, v] of Object.entries(delta)) {
      if (!(f in this.types)) { this.host.fail('add', new Error(`"${f}" is not a state field of "${this.name}" (it has: ${this.fields.join(', ')})`)); continue }
      if (!Number.isFinite(v)) continue
      this.pending[f] ??= new Float32Array(this.n)
      this.pending[f][row] += v
    }
  }

  /** The row of the cell containing a world-space point, or -1 outside the grid. A flat grid (size 1 on an axis) covers every height. */
  private rowAt(x: number, y: number, z: number): number {
    const [nx, ny, nz] = this.dims
    const sp = this.host.def.lattice!.spacing ?? 1.2
    const i = Math.round(x / sp + (nx - 1) / 2)
    const j = Math.round(y / sp + (ny - 1) / 2)
    const k = Math.round(z / sp + (nz - 1) / 2)
    const jj = ny === 1 ? 0 : j, kk = nz === 1 ? 0 : k
    if (i < 0 || i >= nx || jj < 0 || jj >= ny || kk < 0 || kk >= nz) return -1
    return i + nx * (jj + ny * kk)
  }

  private applyPending(): void {
    if (!this.pending) return
    for (const f of Object.keys(this.pending)) {
      const col = this.table.cols[f], add = this.pending[f]
      for (let r = 0; r < this.n; r++) if (add[r] !== 0) col[r] = coerce(this.fieldOf[f], col[r] + add[r]) as number
    }
    this.pending = null
  }

  /** One readable handle per cell, made the first time a per-cell rule or metric needs them (whole-grid rules never do). */
  private get handles(): any[] {
    if (!this.made) {
      this.made = new Array(this.n)
      for (let r = 0; r < this.n; r++) this.made[r] = new this.Cell(r)
    }
    return this.made
  }

  private makeTypes() {
    const table = this.table
    const [nx, ny] = this.dims
    const sp = this.host.def.lattice!.spacing ?? 1.2
    const centre = this.dims.map((d) => (d - 1) / 2)
    const readOnly = () => { throw new Error('cells are read-only inside act(): return the new state instead, like `return { alive: 1 }`') }

    class Cell {
      constructor(readonly row: number) {}
      /** Grid coordinates. */
      get x() { return this.row % nx }
      get y() { return Math.floor(this.row / nx) % ny }
      get z() { return Math.floor(this.row / (nx * ny)) }
      get position() { return new Vec3((this.x - centre[0]) * sp, (this.y - centre[1]) * sp, (this.z - centre[2]) * sp) }
    }
    class Cells extends Array<Cell> {
      static get [Symbol.species]() { return Array }
      get position(): Vecs { return Vecs.from(this, (c) => c.position) as Vecs }
      isEmpty(): boolean { return this.length === 0 }
    }
    const isBool = Object.fromEntries(this.fields.map((f) => [f, this.fieldOf[f].kind === 'boolean']))
    for (const f of this.fields) {
      Object.defineProperty(Cell.prototype, f, { get(this: Cell) { const v = table.cols[f][this.row]; return isBool[f] ? v !== 0 : v }, set: readOnly, enumerable: true })
      Object.defineProperty(Cells.prototype, f, {
        get(this: Cells) { const out = new Nums(); for (const c of this) out.push((c as never)[f]); return out },
        enumerable: true,
      })
    }
    return { Cell, Cells: Cells as unknown as new () => unknown[] }
  }

  /** Run the script's `init` (a cell at a time) or `initAll` (every cell at once): they say what the cells start as. */
  private applyInit(): void {
    const ctrl = this.host.controller()
    if (!ctrl?.init && !ctrl?.initAll) return
    const ctx = this.host.ctx(), { params } = this.host
    const [nx, ny, nz] = this.dims
    const sp = this.host.def.lattice!.spacing ?? 1.2
    const cols = this.table.cols
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
          const data = v instanceof Field ? v.data : (v as ArrayLike<number>)
          if (!data || data.length !== this.n) { this.host.fail('init', new Error(`"${name}" must have one value per cell (${this.n}), got ${data?.length ?? 'none'}`)); continue }
          store(cols[name], f, data, this.n)
        }
        return
      }
      for (let r = 0; r < this.n; r++) {
        const x = r % nx, y = Math.floor(r / nx) % ny, z = Math.floor(r / (nx * ny))
        const at = new Vec3((x - (nx - 1) / 2) * sp, (y - (ny - 1) / 2) * sp, (z - (nz - 1) / 2) * sp)
        const out = ctrl.init!({ index: r, count: this.n, x, y, z, at }, params, ctx)
        for (const [name, v] of Object.entries(initResult(out))) {
          const f = field(name)
          if (f) cols[name][r] = coerce(f, v) as never
        }
      }
    } catch (e) {
      this.host.fail('init', e)
    }
  }


  sceneChanged(): void {
    /* rule params are read live; grid shape and fill only change on reset */
  }

  /** Work out every cell's neighbors once, so a tick only follows indexes. */
  private buildNeighbors(): void {
    const [nx, ny, nz] = this.dims
    const wrap = this.host.def.lattice!.edges === 'wrap'
    this.stride = this.offsets.length
    this.nbr = new Int32Array(this.n * this.stride)
    this.nbrCount = new Uint8Array(this.n)
    for (let row = 0; row < this.n; row++) {
      const i = row % nx, j = Math.floor(row / nx) % ny, k = Math.floor(row / (nx * ny))
      let count = 0
      for (const [di, dj, dk] of this.offsets) {
        let a = i + di, b = j + dj, c = k + dk
        if (wrap) { a = (a + nx) % nx; b = (b + ny) % ny; c = (c + nz) % nz }
        else if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue
        this.nbr[row * this.stride + count++] = a + nx * (b + ny * c)
      }
      this.nbrCount[row] = count
    }
  }

  private neighborsOf(row: number) {
    const out = new this.Cells()
    const base = row * this.stride
    for (let q = 0, n = this.nbrCount[row]; q < n; q++) out.push(this.handles[this.nbr[base + q]])
    return out
  }

  /**
   * The whole-lattice rule: `actAll(fields, params, ctx)` gets every state field as a `Field` and returns the
   * new fields (any it leaves out stay as they are). It is the fast path for big grids.
   */
  private stepFields(rule: (f: Record<string, Field>, p: Params, ctx: Ctx) => unknown): void {
    const table: NeighborTable = { nbr: this.nbr, count: this.nbrCount, stride: this.stride }
    const cols = this.table.cols
    const fields: Record<string, Field> = {}
    for (const f of this.fields) fields[f] = new Field(cols[f], table)
    let out: Record<string, unknown> | null = null
    try {
      const r = rule(fields, this.host.params, this.host.ctx())
      out = r && typeof r === 'object' ? (r as Record<string, unknown>) : null
    } catch (e) {
      this.host.fail('actAll', e)
    }
    if (!out) return
    for (const f of this.fields) {
      const v = out[f]
      if (v === undefined) continue
      const data = v instanceof Field ? v.data : (v as ArrayLike<number>)
      if (!data || data.length !== this.n) { this.host.fail('actAll', new Error(`"${f}" must be a field with ${this.n} cells`)); continue }
      store(cols[f], this.fieldOf[f], data, this.n)
    }
  }

  step(): void {
    this.applyPending()
    const ctrl = this.host.controller()
    const all = ctrl?.actAll
    if (all) return this.stepFields(all)
    const act = ctrl?.act
    const ctx = this.host.ctx()
    const { params } = this.host
    const cols = this.table.cols
    for (let row = 0; row < this.n; row++) {
      let out: unknown
      if (act) {
        try {
          out = act({ self: this.handles[row], neighbors: this.neighborsOf(row) }, params, ctx)
        } catch (e) {
          this.host.fail('act', e)
        }
      }
      const o = out && typeof out === 'object' ? (out as Record<string, unknown>) : null
      for (const f of this.fields) {
        let v = cols[f][row]
        if (o && f in o) {
          const x = o[f]
          if (this.fieldOf[f].kind !== 'number' || Number.isFinite(Number(x))) v = coerce(this.fieldOf[f], x) as number
        }
        this.next[f][row] = v
      }
    }
    for (const f of this.fields) (cols[f] as Float32Array).set(this.next[f] as Float32Array)
  }

  /** Cell colors and visibility from the script's `displayAll` (every cell at once) or `display` (one at a time). */
  private look(): Looks {
    const none: Looks = { rgb: null, visible: null, alpha: null, scale: null }
    const ctrl = this.host.controller()
    const fail = (e: unknown) => this.host.fail('display', e)
    if (ctrl?.displayAll) {
      const table: NeighborTable = { nbr: this.nbr, count: this.nbrCount, stride: this.stride }
      const fields: Record<string, Field> = {}
      for (const f of this.fields) if (this.fieldOf[f].kind !== 'string') fields[f] = new Field(this.table.cols[f], table)
      try { return looksOfAll(this.n, ctrl.displayAll(fields, this.host.params, this.host.ctx()), fail) } catch (e) { fail(e); return none }
    }
    const display = ctrl?.display
    return display ? looksOf(this.n, (i) => display({ self: this.handles[i] }, this.host.params, this.host.ctx()), fail) : none
  }

  frame(): FrameData {
    const L = this.host.def.lattice!
    const [nx, ny, nz] = this.dims
    const sp = L.spacing ?? 1.2
    const look = this.look()
    // with no `display` visibility, every cell is drawn
    const show = look.visible ?? new Uint8Array(this.n).fill(1)
    let live = 0
    for (let r = 0; r < this.n; r++) if (show[r] !== 0) live++
    return {
      kind: 'lattice',
      count: live,
      size: (Math.max(nx, ny, nz) * sp) / 2,
      unit: sp * 0.9,
      pos: new Float32Array(0),
      vel: null,
      lattice: { dims: [nx, ny, nz], spacing: sp, show, fade: L.fade ?? 0, thickness: L.thickness, ...(look.rgb ? { rgb: look.rgb } : {}), ...(look.alpha ? { alpha: look.alpha } : {}), ...(look.scale ? { sizes: look.scale } : {}) },
    }
  }

  snapshot(): unknown {
    return { table: this.table.snapshot(), pending: this.pending && Object.fromEntries(Object.entries(this.pending).map(([k, v]) => [k, v.slice()])) }
  }

  restore(s: unknown): void {
    const x = s as { table: TableSnapshot; pending: Record<string, Float32Array> | null }
    this.table.restore(x.table)
    this.pending = x.pending && Object.fromEntries(Object.entries(x.pending).map(([k, v]) => [k, v.slice()]))
  }

  metricInput(): MetricInput {
    const cells = new this.Cells()
    for (const h of this.handles) cells.push(h)
    return { cells, count: this.n, cols: this.table.cols }
  }
}
