import { Table, type Column, type ColumnType } from './store'
import { resolve, type StateType } from './scene'
import { Nums, Vec3, Vecs } from './vec'
import type { FrameData, Host, MetricInput, World } from './world'

const CTORS = { u8: Uint8Array, i32: Int32Array, f32: Float32Array } as const

function coerce(type: StateType, v: number): number {
  if (type === 'u8') return Math.max(0, Math.min(255, Math.round(v)))
  if (type === 'i32') return Math.round(v)
  return v
}

/**
 * A 3D grid of cells. Each cell is an entity; neighbors are implicit index arithmetic,
 * so a 100,000-cell grid needs no edge lists. Rules are synchronous: every cell reads
 * the old state, and the new state is written all at once at the end of the tick.
 */
export class LatticeWorld implements World {
  readonly table: Table<string>
  private dims: [number, number, number]
  private n: number
  private fields: string[]
  private types: Record<string, StateType>
  private next: Record<string, Column> = {}
  private offsets: [number, number, number][] = []
  /** Neighbor rows for every cell, `stride` slots per cell, and how many of them are real. */
  private nbr = new Int32Array(0)
  private nbrCount = new Uint8Array(0)
  private stride = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handles: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private Cells: new () => any[]

  constructor(private host: Host) {
    const def = host.scene.entities[0]
    const L = def.lattice!
    this.dims = L.size
    this.n = L.size[0] * L.size[1] * L.size[2]
    this.types = def.state ?? {}
    this.fields = Object.keys(this.types)
    this.table = new Table<string>(this.types as Record<string, ColumnType>, this.n)
    for (let i = 0; i < this.n; i++) this.table.spawn()
    for (const f of this.fields) this.next[f] = new CTORS[this.types[f]](this.n)

    for (let dk = -1; dk <= 1; dk++)
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj && !dk) continue
          if (L.neighborhood === 'von-neumann' && Math.abs(di) + Math.abs(dj) + Math.abs(dk) !== 1) continue
          this.offsets.push([di, dj, dk])
        }

    this.buildNeighbors()
    const { Cell, Cells } = this.makeTypes()
    this.Cells = Cells
    for (let r = 0; r < this.n; r++) this.handles.push(new Cell(r))
    this.fill()
  }

  private makeTypes() {
    const table = this.table
    const [nx, ny] = this.dims
    const sp = this.host.scene.entities[0].lattice!.spacing ?? 1.2
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
    for (const f of this.fields) {
      Object.defineProperty(Cell.prototype, f, { get(this: Cell) { return table.cols[f][this.row] }, set: readOnly, enumerable: true })
      Object.defineProperty(Cells.prototype, f, {
        get(this: Cells) { const out = new Nums(); for (const c of this) out.push((c as never)[f]); return out },
        enumerable: true,
      })
    }
    return { Cell, Cells: Cells as unknown as new () => unknown[] }
  }

  /** Seed the starting state with a random blob in the middle of the grid. */
  private fill(): void {
    const def = this.host.scene.entities[0]
    if (!def.fill) return
    const density = resolve(def.fill.density, this.host.params, 0)
    const within = def.fill.within ?? 1
    const col = this.table.cols[def.fill.field]
    const [nx, ny, nz] = this.dims
    const inside = (v: number, n: number) => Math.abs(v - (n - 1) / 2) <= (within * n) / 2
    for (let r = 0; r < this.n; r++) {
      const i = r % nx, j = Math.floor(r / nx) % ny, k = Math.floor(r / (nx * ny))
      if (inside(i, nx) && inside(j, ny) && inside(k, nz) && this.host.rng.next() < density) col[r] = 1
    }
  }

  sceneChanged(): void {
    /* rule params are read live; grid shape and fill only change on reset */
  }

  /** Work out every cell's neighbors once, so a tick only follows indexes. */
  private buildNeighbors(): void {
    const [nx, ny, nz] = this.dims
    const wrap = this.host.scene.entities[0].lattice!.edges === 'wrap'
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

  step(): void {
    const ctrl = this.host.script?.default
    const ctx = this.host.ctx()
    const { params } = this.host
    const cols = this.table.cols
    for (let row = 0; row < this.n; row++) {
      let out: unknown
      if (ctrl) {
        try {
          out = ctrl.decide({ self: this.handles[row], neighbors: this.neighborsOf(row) }, params, ctx)
        } catch (e) {
          this.host.fail('decide', e)
        }
      }
      const o = out && typeof out === 'object' ? (out as Record<string, unknown>) : null
      for (const f of this.fields) {
        let v = cols[f][row]
        if (o && f in o) {
          const x = Number(o[f])
          if (Number.isFinite(x)) v = coerce(this.types[f], x)
        }
        this.next[f][row] = v
      }
    }
    for (const f of this.fields) (cols[f] as Float32Array).set(this.next[f] as Float32Array)
  }

  frame(): FrameData {
    const L = this.host.scene.entities[0].lattice!
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
      lattice: { dims: [nx, ny, nz], spacing: sp, show, fade: L.fade ?? 0 },
    }
  }

  metricInput(): MetricInput {
    const cells = new this.Cells()
    for (const h of this.handles) cells.push(h)
    return { cells, count: this.n, cols: this.table.cols }
  }
}
