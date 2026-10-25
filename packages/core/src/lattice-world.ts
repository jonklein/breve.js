import { StrColumn, Table, type Column, type ColumnType, type TableSnapshot } from './store'
import { fillList, resolve, stateFields, type Params, type StateField, type StateType } from './scene'
import { Field, type NeighborTable } from './field'
import { Nums, Vec3, Vecs } from './vec'
import type { Ctx, FrameData, Host, MetricInput, PatchLayer, World } from './world'

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
    const sf = stateFields(def.state)
    for (const f of sf) { this.fieldOf[f.name] = f; this.types[f.name] = f.type }
    this.fields = sf.map((f) => f.name)
    this.table = new Table<string>(this.types as Record<string, ColumnType>, this.n)
    for (let i = 0; i < this.n; i++) this.table.spawn()
    for (const f of sf) {
      this.next[f.name] = new CTORS[f.type](this.n) as unknown as Column
      // a field that says what it starts as starts that way in every cell
      if (f.init !== undefined && typeof f.init !== 'object') this.table.cols[f.name].fill((typeof f.init === 'boolean' ? (f.init ? 1 : 0) : f.init) as never)
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
    if (!from) this.fill() // a fork gets its cells from the snapshot
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
    const readOnly = () => { throw new Error('cells are read-only inside decide(): return the new state instead, like `return { alive: 1 }`') }

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

  /** Seed the starting state: each fill sets cells of one field, at random or inside a region. */
  private fill(): void {
    const [nx, ny, nz] = this.dims
    const sp = this.host.def.lattice!.spacing ?? 1.2
    for (const f of fillList(this.host.def.fill)) {
      const density = resolve(f.density, this.host.params, 1)
      const within = f.within ?? 1
      const value = f.value ?? 1
      const col = this.table.cols[f.field]
      const inside = (v: number, n: number) => Math.abs(v - (n - 1) / 2) <= (within * n) / 2
      for (let r = 0; r < this.n; r++) {
        const i = r % nx, j = Math.floor(r / nx) % ny, k = Math.floor(r / (nx * ny))
        if (!(inside(i, nx) && inside(j, ny) && inside(k, nz))) continue
        if (f.region) {
          const d = Math.hypot((i - (nx - 1) / 2) * sp - f.region.center[0], (j - (ny - 1) / 2) * sp - f.region.center[1], (k - (nz - 1) / 2) * sp - f.region.center[2])
          if (d > f.region.radius) continue
        }
        if (density >= 1 || this.host.rng.next() < density) col[r] = value
      }
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
   * The whole-lattice rule: `update(fields, params, ctx)` gets every state field as a `Field` and returns the
   * new fields (any it leaves out stay as they are). It is the fast path for big grids.
   */
  private stepFields(update: (f: Record<string, Field>, p: Params, ctx: Ctx) => unknown): void {
    const table: NeighborTable = { nbr: this.nbr, count: this.nbrCount, stride: this.stride }
    const cols = this.table.cols
    const fields: Record<string, Field> = {}
    for (const f of this.fields) fields[f] = new Field(cols[f], table)
    let out: Record<string, unknown> | null = null
    try {
      const r = update(fields, this.host.params, this.host.ctx())
      out = r && typeof r === 'object' ? (r as Record<string, unknown>) : null
    } catch (e) {
      this.host.fail('update', e)
    }
    if (!out) return
    for (const f of this.fields) {
      const v = out[f]
      if (v === undefined) continue
      const data = v instanceof Field ? v.data : (v as ArrayLike<number>)
      if (!data || data.length !== this.n) { this.host.fail('update', new Error(`"${f}" must be a field with ${this.n} cells`)); continue }
      const dst = cols[f]
      for (let r = 0; r < this.n; r++) dst[r] = coerce(this.fieldOf[f], data[r]) as number
    }
  }

  step(): void {
    this.applyPending()
    const ctrl = this.host.controller()
    if (ctrl?.update) return this.stepFields(ctrl.update)
    const ctx = this.host.ctx()
    const { params } = this.host
    const cols = this.table.cols
    for (let row = 0; row < this.n; row++) {
      let out: unknown
      if (ctrl?.decide) {
        try {
          out = ctrl.decide!({ self: this.handles[row], neighbors: this.neighborsOf(row) }, params, ctx)
        } catch (e) {
          this.host.fail('decide', e)
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

  frame(): FrameData {
    const L = this.host.def.lattice!
    const [nx, ny, nz] = this.dims
    const sp = L.spacing ?? 1.2
    const showCol = this.table.cols[L.show]
    const tintCol = L.color ? this.table.cols[L.color] : null
    const max = L.colorMax ?? 1
    const show = new Uint8Array(this.n)
    const attr = tintCol ? new Float32Array(this.n) : null
    let live = 0
    for (let r = 0; r < this.n; r++) {
      if (showCol[r] !== 0) { show[r] = 1; live++ }
      if (attr && tintCol) attr[r] = Math.min(1, tintCol[r] / max)
    }
    return {
      kind: 'lattice',
      count: live,
      size: (Math.max(nx, ny, nz) * sp) / 2,
      unit: sp * 0.9,
      pos: new Float32Array(0),
      vel: null,
      attr,
      lattice: { dims: [nx, ny, nz], spacing: sp, show, fade: L.fade ?? 0, palette: L.palette, thickness: L.thickness },
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
