
/** For each cell, the rows of its neighbors: `stride` slots per cell, `count[row]` of them real. */
export interface NeighborTable {
  nbr: Int32Array
  count: Uint8Array
  stride: number
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
    const { nbr, count, stride } = this.table
    const d = this.data
    const out = new Float32Array(d.length)
    for (let r = 0; r < out.length; r++) {
      let s = 0
      const base = r * stride
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
    const { nbr, count, stride } = this.table
    const d = this.data
    const out = new Float32Array(d.length)
    for (let r = 0; r < out.length; r++) {
      let m = -Infinity
      const base = r * stride
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
