
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

/**
 * One state field of a whole lattice, as a single value: `alive.neighborSum()` is the number of live
 * neighbors of every cell at once. Fields are immutable; every operation makes a new one. This is the
 * fast way to write a lattice rule: no loop over cells in the script, and no object per cell.
 */
export class Field {
  constructor(readonly data: Data, private table: NeighborTable) {}

  get length(): number {
    return this.data.length
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

  /** A new field with `fn(value, index)` applied to every cell. */
  map(fn: (v: number, i: number) => number): Field {
    const d = this.data
    const out = new Float32Array(d.length)
    for (let i = 0; i < out.length; i++) out[i] = fn(d[i], i)
    return new Field(out, this.table)
  }

  /** Combine two fields cell by cell: `alive.zip(crowd, (a, n) => ...)`. */
  zip(other: Field, fn: (a: number, b: number, i: number) => number): Field {
    const a = this.data, b = other.data
    const out = new Float32Array(a.length)
    for (let i = 0; i < out.length; i++) out[i] = fn(a[i], b[i], i)
    return new Field(out, this.table)
  }

  /**
   * Arithmetic on whole fields, with no function call per cell (much faster than `map` and `zip` on a big grid). Each takes a
   * number or another field of the same size and makes a new field: `crowd.eq(3)`, `alive.mul(2).add(crowd)`.
   * Comparisons give 1 where true and 0 where not, so they combine with `and`, `or`, `not` and `where`.
   */
  add(o: number | Field): Field { return this.op(o, 0) }
  sub(o: number | Field): Field { return this.op(o, 1) }
  mul(o: number | Field): Field { return this.op(o, 2) }
  div(o: number | Field): Field { return this.op(o, 3) }
  min(o: number | Field): Field { return this.op(o, 4) }
  max(o: number | Field): Field { return this.op(o, 5) }
  /** 1 where this equals `o`, else 0. */
  eq(o: number | Field): Field { return this.op(o, 6) }
  ne(o: number | Field): Field { return this.op(o, 7) }
  lt(o: number | Field): Field { return this.op(o, 8) }
  le(o: number | Field): Field { return this.op(o, 9) }
  gt(o: number | Field): Field { return this.op(o, 10) }
  ge(o: number | Field): Field { return this.op(o, 11) }
  /** 1 where both are non-zero. */
  and(o: number | Field): Field { return this.op(o, 12) }
  /** 1 where either is non-zero. */
  or(o: number | Field): Field { return this.op(o, 13) }
  /** 1 where this is 0, else 0. */
  not(): Field { return this.op(0, 6) }
  /** `a` where this field is non-zero, `b` where it is zero: `crowd.eq(3).where(1, 0)`, `alive.where(age.add(1), 0)`. */
  where(a: number | Field, b: number | Field): Field {
    const c = this.data, n = c.length
    const [x, mx] = this.operand(a), [y, my] = this.operand(b)
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = c[i] !== 0 ? x[i & mx] : y[i & my]
    return new Field(out, this.table)
  }
  /** Every value held between `lo` and `hi`. */
  clamp(lo: number, hi: number): Field {
    const d = this.data, n = d.length
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) { const v = d[i]; out[i] = v < lo ? lo : v > hi ? hi : v }
    return new Field(out, this.table)
  }

  /** The other operand as an array and an index mask: a number is a one-element array read at index 0 (mask 0), a field is read in step (mask -1). */
  private operand(o: number | Field): [ArrayLike<number>, number] {
    if (typeof o === 'number') return [[o], 0]
    if (o.data.length !== this.data.length) throw new Error(`fields must be the same size (${this.data.length} and ${o.data.length} cells)`)
    return [o.data, -1]
  }

  private op(o: number | Field, code: number): Field {
    const a = this.data, n = a.length
    const [b, m] = this.operand(o)
    const out = new Float32Array(n)
    switch (code) {
      case 0: for (let i = 0; i < n; i++) out[i] = a[i] + b[i & m]; break
      case 1: for (let i = 0; i < n; i++) out[i] = a[i] - b[i & m]; break
      case 2: for (let i = 0; i < n; i++) out[i] = a[i] * b[i & m]; break
      case 3: for (let i = 0; i < n; i++) out[i] = a[i] / b[i & m]; break
      case 4: for (let i = 0; i < n; i++) out[i] = a[i] < b[i & m] ? a[i] : b[i & m]; break
      case 5: for (let i = 0; i < n; i++) out[i] = a[i] > b[i & m] ? a[i] : b[i & m]; break
      case 6: for (let i = 0; i < n; i++) out[i] = a[i] === b[i & m] ? 1 : 0; break
      case 7: for (let i = 0; i < n; i++) out[i] = a[i] !== b[i & m] ? 1 : 0; break
      case 8: for (let i = 0; i < n; i++) out[i] = a[i] < b[i & m] ? 1 : 0; break
      case 9: for (let i = 0; i < n; i++) out[i] = a[i] <= b[i & m] ? 1 : 0; break
      case 10: for (let i = 0; i < n; i++) out[i] = a[i] > b[i & m] ? 1 : 0; break
      case 11: for (let i = 0; i < n; i++) out[i] = a[i] >= b[i & m] ? 1 : 0; break
      case 12: for (let i = 0; i < n; i++) out[i] = a[i] !== 0 && b[i & m] !== 0 ? 1 : 0; break
      default: for (let i = 0; i < n; i++) out[i] = a[i] !== 0 || b[i & m] !== 0 ? 1 : 0
    }
    return new Field(out, this.table)
  }

  sum(): number {
    let s = 0
    for (let i = 0; i < this.data.length; i++) s += this.data[i]
    return s
  }

  average(): number {
    return this.data.length ? this.sum() / this.data.length : 0
  }
}

function n_or(m: number): number {
  return Number.isFinite(m) ? m : 0
}
