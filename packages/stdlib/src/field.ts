
/**
 * For each cell, the rows of its neighbors: `count[row]` of them, starting at `start[row]` in `nbr` (a network, where degrees
 * differ), or at `row * stride` when there is no `start` (a lattice, where every cell has room for the same number).
 */
export interface NeighborTable {
  nbr: Int32Array
  count: Uint8Array | Uint16Array | Int32Array
  stride: number
  start?: Int32Array
}

type Data = Float32Array | Float64Array | Int32Array | Uint32Array | Uint8Array

/** How many cells one pass handles at a time: small enough that the pieces of a long chain of operations stay in the processor's cache. */
const BLOCK = 2048

/** A pending computation: what a field holds until someone asks for its values. */
type Node =
  | { t: 'src'; a: Data }
  | { t: 'num'; v: number }
  | { t: 'fld'; f: Field } // another field: read from its values if they exist by then, else computed in place
  | { t: 'bin'; op: number; a: Node; b: Node }
  | { t: 'where'; c: Node; a: Node; b: Node }
  | { t: 'clamp'; a: Node; lo: number; hi: number }
  | { t: 'map'; a: Node; fn: (v: number, i: number) => number }
  | { t: 'zip'; a: Node; b: Node; fn: (a: number, b: number, i: number) => number }

/**
 * One state field of a whole lattice, as a single value: `alive.neighborSum()` is the number of live
 * neighbors of every cell at once. Fields are immutable; every operation makes a new one. This is the
 * fast way to write a lattice rule: no loop over cells in the script, and no object per cell.
 *
 * Arithmetic (`add`, `eq`, `and`, `where`, `map`, `zip`, ...) is lazy: it records what to compute, and the values are worked out
 * in one pass over small blocks the first time they are needed (by `data`, `sum`, a neighbor operation, or the engine storing
 * the result). A chain like `crowd.eq(3).or(alive.and(crowd.eq(2)))` therefore reads and writes memory once, not once per step.
 */
export class Field {
  /** @internal the computed values, once there are any */
  _values: Data | null
  /** @internal what to compute, until then */
  _expr: Node | null
  private uses = 0
  private table: NeighborTable
  readonly length: number

  constructor(data: Data, table: NeighborTable)
  constructor(data: null, table: NeighborTable, expr: Node, length: number)
  constructor(data: Data | null, table: NeighborTable, expr: Node | null = null, length = data?.length ?? 0) {
    this._values = data
    this._expr = expr
    this.table = table
    this.length = length
  }

  /** The values, one per cell. The first call on a pending field computes them (all at once, in blocks). */
  get data(): Data {
    if (!this._values) {
      const out = new Float32Array(this.length)
      const plan = compile(this._expr!)
      for (let s = 0; s < this.length; s += BLOCK) {
        const e = Math.min(this.length, s + BLOCK)
        out.set(plan.run(s, e).subarray(0, e - s), s)
      }
      this._values = out
      this._expr = null
    }
    return this._values
  }

  /** For each cell, the total of this field over its neighbors. */
  neighborSum(): Field {
    const { nbr, count, stride, start } = this.table
    const d = this.data
    const out = new Float32Array(d.length)
    for (let r = 0; r < out.length; r++) {
      let s = 0
      const base = start ? start[r] : r * stride
      for (let q = 0, n = count[r]; q < n; q++) s += d[nbr[base + q]]
      out[r] = s
    }
    return new Field(out, this.table)
  }

  /** For each cell, the average of its neighbors (0 for a cell with none). */
  neighborAverage(): Field {
    const { count } = this.table
    const sum = this.neighborSum().data as Float32Array
    for (let r = 0; r < sum.length; r++) if (count[r]) sum[r] /= count[r]
    return new Field(sum, this.table)
  }

  /** For each cell, the biggest value among its neighbors. */
  neighborMax(): Field {
    const { nbr, count, stride, start } = this.table
    const d = this.data
    const out = new Float32Array(d.length)
    for (let r = 0; r < out.length; r++) {
      let m = -Infinity
      const base = start ? start[r] : r * stride
      for (let q = 0, n = count[r]; q < n; q++) m = Math.max(m, d[nbr[base + q]])
      out[r] = n_or(m)
    }
    return new Field(out, this.table)
  }

  // ---- arithmetic: lazy, and the same for a number or another field ----
  private node(): Node { return this._values ? { t: 'src', a: this._values } : { t: 'fld', f: this } }

  private operand(o: number | Field): Node {
    if (typeof o === 'number') return { t: 'num', v: o }
    if (o.length !== this.length) throw new Error(`fields must be the same size (${this.length} and ${o.length} cells)`)
    return o.node()
  }

  /** A field used in more than one place is worked out once, rather than inside each of them. */
  private lazy(expr: Node, others: (number | Field)[] = []): Field {
    for (const f of [this as Field, ...others]) if (typeof f !== 'number' && ++f.uses > 1 && !f._values) void f.data
    return new Field(null, this.table, expr, this.length)
  }

  private bin(op: number, o: number | Field): Field { return this.lazy({ t: 'bin', op, a: this.node(), b: this.operand(o) }, [o]) }

  /**
   * Arithmetic on whole fields, with no function call per cell. Each takes a number or another field of the same size and
   * makes a new field: `crowd.eq(3)`, `alive.mul(2).add(crowd)`. Comparisons give 1 where true and 0 where not, so they
   * combine with `and`, `or`, `not` and `where`.
   */
  add(o: number | Field): Field { return this.bin(0, o) }
  sub(o: number | Field): Field { return this.bin(1, o) }
  mul(o: number | Field): Field { return this.bin(2, o) }
  div(o: number | Field): Field { return this.bin(3, o) }
  min(o: number | Field): Field { return this.bin(4, o) }
  max(o: number | Field): Field { return this.bin(5, o) }
  /** 1 where this equals `o`, else 0. */
  eq(o: number | Field): Field { return this.bin(6, o) }
  ne(o: number | Field): Field { return this.bin(7, o) }
  lt(o: number | Field): Field { return this.bin(8, o) }
  le(o: number | Field): Field { return this.bin(9, o) }
  gt(o: number | Field): Field { return this.bin(10, o) }
  ge(o: number | Field): Field { return this.bin(11, o) }
  /** 1 where both are non-zero. */
  and(o: number | Field): Field { return this.bin(12, o) }
  /** 1 where either is non-zero. */
  or(o: number | Field): Field { return this.bin(13, o) }
  /** 1 where this is 0, else 0. */
  not(): Field { return this.bin(6, 0) }
  /** `a` where this field is non-zero, `b` where it is zero: `crowd.eq(3).where(1, 0)`, `alive.where(age.add(1), 0)`. */
  where(a: number | Field, b: number | Field): Field { return this.lazy({ t: 'where', c: this.node(), a: this.operand(a), b: this.operand(b) }, [a, b]) }
  /** Every value held between `lo` and `hi`. */
  clamp(lo: number, hi: number): Field { return this.lazy({ t: 'clamp', a: this.node(), lo, hi }) }

  /** A new field with `fn(value, index)` applied to every cell. */
  map(fn: (v: number, i: number) => number): Field { return this.lazy({ t: 'map', a: this.node(), fn }) }

  /** Combine two fields cell by cell: `alive.zip(crowd, (a, n) => ...)`. */
  zip(other: Field, fn: (a: number, b: number, i: number) => number): Field {
    return this.lazy({ t: 'zip', a: this.node(), b: this.operand(other), fn }, [other])
  }

  sum(): number {
    const d = this.data
    let s = 0
    for (let i = 0; i < d.length; i++) s += d[i]
    return s
  }

  average(): number {
    return this.length ? this.sum() / this.length : 0
  }
}

function n_or(m: number): number {
  return Number.isFinite(m) ? m : 0
}

// ---- evaluation: a pending computation turned into a function over blocks ----
//
// Every block is a Float32Array and scalars are broadcast into a prefilled block, so each loop below sees one array type
// and no index arithmetic. (Loops over a mix of typed-array kinds, or with a mask on every access, run several times slower.)

interface Plan {
  /** The values for cells [s, e), in a Float32Array whose first e - s entries are valid. It is reused by the next call. */
  run(s: number, e: number): Float32Array
}

function compile(n: Node): Plan {
  switch (n.t) {
    case 'src': {
      const a = n.a
      if (a instanceof Float32Array) return { run: (s, e) => a.subarray(s, e) }
      const blk = new Float32Array(BLOCK) // other kinds of column are converted a block at a time, which the engine does natively
      return { run: (s, e) => { blk.set(a.subarray(s, e)); return blk } }
    }
    case 'num': { const blk = new Float32Array(BLOCK).fill(n.v); return { run: () => blk } }
    case 'fld': return n.f._values ? compile({ t: 'src', a: n.f._values }) : compile(n.f._expr!)
    case 'bin': {
      const a = compile(n.a), b = compile(n.b), out = new Float32Array(BLOCK), op = n.op
      return { run: (s, e) => { binary(op, a.run(s, e), b.run(s, e), out, e - s); return out } }
    }
    case 'where': {
      const c = compile(n.c), a = compile(n.a), b = compile(n.b), out = new Float32Array(BLOCK)
      return {
        run: (s, e) => {
          const cc = c.run(s, e), x = a.run(s, e), y = b.run(s, e)
          for (let i = 0, k = e - s; i < k; i++) out[i] = cc[i] !== 0 ? x[i] : y[i]
          return out
        },
      }
    }
    case 'clamp': {
      const a = compile(n.a), out = new Float32Array(BLOCK), { lo, hi } = n
      return { run: (s, e) => { const x = a.run(s, e); for (let i = 0, k = e - s; i < k; i++) { const v = x[i]; out[i] = v < lo ? lo : v > hi ? hi : v } return out } }
    }
    case 'map': {
      const a = compile(n.a), out = new Float32Array(BLOCK), fn = n.fn
      return { run: (s, e) => { const x = a.run(s, e); for (let i = 0, k = e - s; i < k; i++) out[i] = fn(x[i], s + i); return out } }
    }
    case 'zip': {
      const a = compile(n.a), b = compile(n.b), out = new Float32Array(BLOCK), fn = n.fn
      return { run: (s, e) => { const x = a.run(s, e), y = b.run(s, e); for (let i = 0, k = e - s; i < k; i++) out[i] = fn(x[i], y[i], s + i); return out } }
    }
  }
}

function binary(op: number, a: Float32Array, b: Float32Array, out: Float32Array, n: number): void {
  switch (op) {
    case 0: for (let i = 0; i < n; i++) out[i] = a[i] + b[i]; break
    case 1: for (let i = 0; i < n; i++) out[i] = a[i] - b[i]; break
    case 2: for (let i = 0; i < n; i++) out[i] = a[i] * b[i]; break
    case 3: for (let i = 0; i < n; i++) out[i] = a[i] / b[i]; break
    case 4: for (let i = 0; i < n; i++) { const x = a[i], y = b[i]; out[i] = x < y ? x : y } break
    case 5: for (let i = 0; i < n; i++) { const x = a[i], y = b[i]; out[i] = x > y ? x : y } break
    case 6: for (let i = 0; i < n; i++) out[i] = a[i] === b[i] ? 1 : 0; break
    case 7: for (let i = 0; i < n; i++) out[i] = a[i] !== b[i] ? 1 : 0; break
    case 8: for (let i = 0; i < n; i++) out[i] = a[i] < b[i] ? 1 : 0; break
    case 9: for (let i = 0; i < n; i++) out[i] = a[i] <= b[i] ? 1 : 0; break
    case 10: for (let i = 0; i < n; i++) out[i] = a[i] > b[i] ? 1 : 0; break
    case 11: for (let i = 0; i < n; i++) out[i] = a[i] >= b[i] ? 1 : 0; break
    case 12: for (let i = 0; i < n; i++) out[i] = a[i] !== 0 && b[i] !== 0 ? 1 : 0; break
    default: for (let i = 0; i < n; i++) out[i] = a[i] !== 0 || b[i] !== 0 ? 1 : 0
  }
}
