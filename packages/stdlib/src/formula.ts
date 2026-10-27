/**
 * Formulas: a whole-set rule written once, as an expression.
 *
 * A formula is a function that runs ONCE. The fields it is given are not numbers but places in an expression, so what it
 * returns is a program (a small graph of operations) that can be run for every cell, on the CPU or compiled for the GPU:
 *
 *   alive => { const crowd = alive.neighborSum(); return { alive: crowd.eq(3).or(alive.and(crowd.eq(2))) } }
 *
 * `trace` runs the function and records the graph. `interpret` runs a graph on the CPU, cell by cell and node by node: it is the
 * reference every faster backend is checked against, so it favors being obviously right over being fast.
 *
 * The graph is plain JSON (`Program`), with each node using only earlier nodes. Values are 32-bit floats, as in `Field`.
 */

export type BinOp = 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max' | 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'and' | 'or'
export type NeighborOp = 'sum' | 'count' | 'avg' | 'max'

export const BIN_OPS: readonly BinOp[] = ['add', 'sub', 'mul', 'div', 'min', 'max', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'and', 'or']
export const NEIGHBOR_OPS: readonly NeighborOp[] = ['sum', 'count', 'avg', 'max']

/** One step of a program. Operands are indexes of earlier nodes. */
export type Node =
  | { k: 'num'; v: number }
  | { k: 'field'; name: string }
  | { k: 'param'; name: string }
  | { k: 'coord'; axis: 0 | 1 | 2 } // which column, row or layer a cell is in
  | { k: 'index' } // the cell's number, in storage order
  | { k: 'tick' }
  | { k: 'bin'; op: BinOp; a: number; b: number }
  | { k: 'where'; c: number; a: number; b: number }
  | { k: 'clamp'; a: number; lo: number; hi: number }
  | { k: 'nbr'; op: NeighborOp; a: number }
  | { k: 'hash'; salt: number }

/** A total over every cell, for metrics: `alive.sum()`. */
export type ReduceOp = 'sum' | 'average'
export const REDUCE_OPS: readonly ReduceOp[] = ['sum', 'average']

export interface Program {
  nodes: Node[]
  /** Which node holds each result field. */
  out: Record<string, number>
  /** Single numbers worked out from a node over every cell (metrics only): `{ population: { op: 'sum', node: 3 } }`. */
  reduce?: Record<string, { op: ReduceOp; node: number }>
  /** The state fields the program reads and the parameters it was given a name for. */
  fields: string[]
  params: string[]
}

/** The shape of the grid a program runs on. The same program runs on any grid. */
export interface Grid {
  size: [number, number, number]
  wrap: boolean
  neighborhood?: 'moore' | 'von-neumann'
}

// ---------------------------------------------------------------------------------------------------------
// Random numbers that are a function of where and when, not of how many were drawn before

const FNV_OFFSET = 0x811c9dc5

/** A number for a name, so `k.hash('birth')` and `k.hash('death')` give different streams. */
export function saltOf(name: string): number {
  let h = FNV_OFFSET
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** A 32-bit mixer (the "lowbias32" finalizer). Plain unsigned integer operations, so every backend can reproduce it bit for bit. */
function mix(h: number): number {
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return h >>> 0
}

/** A number in [0, 1) for this cell, tick, scene seed and salt. The same on every machine, in any evaluation order. */
export function hash01(index: number, tick: number, seed: number, salt: number): number {
  let h = mix((seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0)
  h = mix((h + Math.imul(tick >>> 0, 0x85ebca6b)) >>> 0)
  h = mix((h + Math.imul(index >>> 0, 0xc2b2ae35)) >>> 0)
  return (h >>> 8) / 16777216 // 24 bits, so it is exact as a 32-bit float
}

// ---------------------------------------------------------------------------------------------------------
// Tracing

const TRACE_HINT = 'A formula runs once and its fields are expressions, not numbers, so use their methods (`a.add(b)`, `a.gt(3)`, `c.where(x, y)`) instead of operators, `if` or loops.'

class Builder {
  nodes: Node[] = []
  /** Metrics may total over cells (`alive.sum()`); a rule may not. */
  constructor(readonly metrics = false) {}
  private seen = new Map<string, number>()

  /** The index of this node, reusing an identical one made earlier (so a value used twice is worked out once). */
  add(node: Node): number {
    const key = JSON.stringify(node)
    let i = this.seen.get(key)
    if (i === undefined) {
      i = this.nodes.length
      this.nodes.push(node)
      this.seen.set(key, i)
    }
    return i
  }
}

/**
 * A field inside a formula: the value of every cell, as an expression. It has the operations of `Field` that can be compiled
 * (arithmetic, comparisons, `where`, `clamp`, the neighbor operations); the ones that take a JavaScript function cannot be.
 */
export class Expr {
  /** @internal */
  constructor(readonly b: Builder, readonly id: number) {}

  private operand(o: number | Expr): number {
    if (typeof o === 'number') {
      if (!Number.isFinite(o)) throw new Error(`a formula cannot use ${o} (numbers must be finite)`)
      return this.b.add({ k: 'num', v: Math.fround(o) })
    }
    if (!(o instanceof Expr) || o.b !== this.b) throw new Error(`a formula can only combine its own fields, parameters and numbers. ${TRACE_HINT}`)
    return o.id
  }

  private bin(op: BinOp, o: number | Expr): Expr { return new Expr(this.b, this.b.add({ k: 'bin', op, a: this.id, b: this.operand(o) })) }
  private nbr(op: NeighborOp): Expr { return new Expr(this.b, this.b.add({ k: 'nbr', op, a: this.id })) }

  add(o: number | Expr): Expr { return this.bin('add', o) }
  sub(o: number | Expr): Expr { return this.bin('sub', o) }
  mul(o: number | Expr): Expr { return this.bin('mul', o) }
  div(o: number | Expr): Expr { return this.bin('div', o) }
  min(o: number | Expr): Expr { return this.bin('min', o) }
  max(o: number | Expr): Expr { return this.bin('max', o) }
  eq(o: number | Expr): Expr { return this.bin('eq', o) }
  ne(o: number | Expr): Expr { return this.bin('ne', o) }
  lt(o: number | Expr): Expr { return this.bin('lt', o) }
  le(o: number | Expr): Expr { return this.bin('le', o) }
  gt(o: number | Expr): Expr { return this.bin('gt', o) }
  ge(o: number | Expr): Expr { return this.bin('ge', o) }
  and(o: number | Expr): Expr { return this.bin('and', o) }
  or(o: number | Expr): Expr { return this.bin('or', o) }
  not(): Expr { return this.bin('eq', 0) }
  where(a: number | Expr, b: number | Expr): Expr { return new Expr(this.b, this.b.add({ k: 'where', c: this.id, a: this.operand(a), b: this.operand(b) })) }
  clamp(lo: number, hi: number): Expr {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error('clamp needs two finite numbers')
    return new Expr(this.b, this.b.add({ k: 'clamp', a: this.id, lo: Math.fround(lo), hi: Math.fround(hi) }))
  }

  neighborSum(): Expr { return this.nbr('sum') }
  /** How many neighbors each cell has (the same for every cell on a grid that wraps; fewer at the edge of one that does not). */
  neighborCount(): Expr { return this.nbr('count') }
  neighborAverage(): Expr { return this.nbr('avg') }
  neighborMax(): Expr { return this.nbr('max') }

  map(): never { throw new Error(`map takes a JavaScript function, which cannot be compiled. ${TRACE_HINT}`) }
  zip(): never { throw new Error(`zip takes a JavaScript function, which cannot be compiled. ${TRACE_HINT}`) }
  /** A total over every cell. Only a metric may ask for one (a rule describes each cell, not all of them). */
  sum(): Total { return this.total('sum') }
  average(): Total { return this.total('average') }
  private total(op: ReduceOp): Total {
    if (!this.b.metrics) throw new Error('a formula describes every cell; a total over all cells is a metric, not a part of the rule')
    return new Total(op, this.id)
  }
  get data(): never { throw new Error(`a formula's fields have no values while it is being written. ${TRACE_HINT}`) }

  // `a + b`, `a > 3` and `if (a)` on an expression land here
  valueOf(): never { throw new Error(`an expression has no number to use yet. ${TRACE_HINT}`) }
  toString(): string { throw new Error(`an expression has no text to show yet. ${TRACE_HINT}`) }
}

/** What a formula can ask for besides its fields and parameters. */
export interface FormulaContext {
  /** A number in [0, 1) that is different for every cell and tick, and the same on every run and machine. `name` makes separate streams. */
  hash(name?: string): Expr
  /** Which column, row and layer the cell is in. */
  x: Expr
  y: Expr
  z: Expr
  /** The cell's number, in storage order. */
  index: Expr
  tick: Expr
}

export type Formula = (fields: Record<string, Expr>, params: Record<string, Expr>, k: FormulaContext) => Record<string, Expr | number> | undefined

/**
 * Run a formula once and record what it computes. `fields` names the state fields it can read, `params` the parameters
 * (these become values the program is given each tick, so a slider moves without anything being compiled again).
 */
export function trace(formula: Formula, fields: string[], params: string[]): Program {
  const b = new Builder()
  const read = (names: string[], k: 'field' | 'param', what: string) =>
    new Proxy(Object.fromEntries(names.map((name) => [name, new Expr(b, b.add({ k, name } as Node))])), {
      get(target, key) {
        if (typeof key === 'symbol' || key in target) return Reflect.get(target, key)
        throw new Error(`there is no ${what} named "${key}" (there is: ${names.join(', ') || 'nothing'})`)
      },
    }) as Record<string, Expr>
  const k: FormulaContext = {
    hash: (name) => new Expr(b, b.add({ k: 'hash', salt: name === undefined ? 0 : saltOf(name) })),
    x: new Expr(b, b.add({ k: 'coord', axis: 0 })),
    y: new Expr(b, b.add({ k: 'coord', axis: 1 })),
    z: new Expr(b, b.add({ k: 'coord', axis: 2 })),
    index: new Expr(b, b.add({ k: 'index' })),
    tick: new Expr(b, b.add({ k: 'tick' })),
  }
  const result = formula(read(fields, 'field', 'field'), read(params, 'param', 'parameter'), k)
  if (!result || typeof result !== 'object') throw new Error('a formula must return an object of fields: { alive: ... }')
  const out: Record<string, number> = {}
  for (const [name, v] of Object.entries(result)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[name] = b.add({ k: 'num', v: Math.fround(v) })
    else if (v instanceof Expr && v.b === b) out[name] = v.id
    else throw new Error(`"${name}" must be an expression made from the formula's fields, or a number`)
  }
  return { nodes: b.nodes, out, fields: [...fields], params: [...params] }
}

/** A single number worked out over every cell: what a metric returns when it is written with field methods. */
export class Total {
  constructor(readonly op: ReduceOp, readonly node: number) {}
}

/**
 * Metrics for a set whose state lives on a graphics card: the function is run once with expressions for the fields (`cells.alive`),
 * and each total it returns (`cells.alive.sum()`, `.average()`) becomes a reduction the card works out. `metrics` maps a name to its
 * function, as in a script's `export const metrics`; a metric that returns anything but a total is left out and named in `skipped`.
 */
export function traceMetrics(metrics: Record<string, (input: any) => unknown>, fields: string[]): { program: Program; skipped: string[] } {
  const b = new Builder(true)
  const exprs = Object.fromEntries(fields.map((name) => [name, new Expr(b, b.add({ k: 'field', name }))]))
  const reduce: Record<string, { op: ReduceOp; node: number }> = {}
  const skipped: string[] = []
  for (const [name, fn] of Object.entries(metrics)) {
    try {
      const v = fn({ cells: exprs, sets: new Proxy({}, { get: () => exprs }) })
      if (v instanceof Total) reduce[name] = { op: v.op, node: v.node }
      else skipped.push(name)
    } catch {
      skipped.push(name)
    }
  }
  return { program: { nodes: b.nodes, out: {}, reduce, fields: [...fields], params: [] }, skipped }
}

// ---------------------------------------------------------------------------------------------------------
// The reference interpreter

/** The offsets of a cell's neighbors, in the order `LatticeWorld` visits them (sums of floats depend on the order). */
export function neighborOffsets(grid: Grid): [number, number, number][] {
  const [nx, ny, nz] = grid.size
  const out: [number, number, number][] = []
  for (let dk = -1; dk <= 1; dk++)
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj && !dk) continue
        if ((di && nx === 1) || (dj && ny === 1) || (dk && nz === 1)) continue // a flat grid has no neighbors "above"
        if (grid.neighborhood === 'von-neumann' && Math.abs(di) + Math.abs(dj) + Math.abs(dk) !== 1) continue
        out.push([di, dj, dk])
      }
  return out
}

export interface RunInput {
  /** Every state field the program reads, one value per cell. */
  state: Record<string, ArrayLike<number>>
  params?: Record<string, number>
  tick?: number
  /** The scene's seed, for `hash`. */
  seed?: number
}

/** Run a program on the CPU for every cell and return its result fields. Each node is worked out over the whole grid before the next. */
export function interpret(program: Program, grid: Grid, input: RunInput): Record<string, Float32Array> {
  const vals = evaluate(program, grid, input)
  const result: Record<string, Float32Array> = {}
  for (const [name, id] of Object.entries(program.out)) result[name] = vals[id]
  return result
}

/** The program's totals (`program.reduce`), worked out on the CPU. Sums add in 64-bit, like `Field.sum`. */
export function interpretTotals(program: Program, grid: Grid, input: RunInput): Record<string, number> {
  const vals = evaluate(program, grid, input)
  const out: Record<string, number> = {}
  for (const [name, { op, node }] of Object.entries(program.reduce ?? {})) {
    const v = vals[node]
    let s = 0
    for (let i = 0; i < v.length; i++) s += v[i]
    out[name] = op === 'average' ? (v.length ? s / v.length : 0) : s
  }
  return out
}

function evaluate(program: Program, grid: Grid, input: RunInput): Float32Array[] {
  const [nx, ny, nz] = grid.size
  const n = nx * ny * nz
  const params = input.params ?? {}
  const tick = input.tick ?? 0
  const seed = (input.seed ?? 0) >>> 0
  const offsets = neighborOffsets(grid)
  const vals: Float32Array[] = []

  // each cell's neighbors, once
  let table: { nbr: Int32Array; count: Uint8Array } | null = null
  const neighbors = () => {
    if (table) return table
    const nbr = new Int32Array(n * offsets.length), count = new Uint8Array(n)
    for (let row = 0; row < n; row++) {
      const i = row % nx, j = Math.floor(row / nx) % ny, k = Math.floor(row / (nx * ny))
      let c = 0
      for (const [di, dj, dk] of offsets) {
        let a = i + di, b = j + dj, d = k + dk
        if (grid.wrap) { a = (a + nx) % nx; b = (b + ny) % ny; d = (d + nz) % nz }
        else if (a < 0 || b < 0 || d < 0 || a >= nx || b >= ny || d >= nz) continue
        nbr[row * offsets.length + c++] = a + nx * (b + ny * d)
      }
      count[row] = c
    }
    return (table = { nbr, count })
  }

  program.nodes.forEach((node, id) => {
    const out = new Float32Array(n)
    switch (node.k) {
      case 'num': out.fill(node.v); break
      case 'param': {
        const v = params[node.name]
        if (typeof v !== 'number') throw new Error(`the program needs a value for the parameter "${node.name}"`)
        out.fill(v)
        break
      }
      case 'field': {
        const v = input.state[node.name]
        if (!v || v.length !== n) throw new Error(`the program reads "${node.name}", which must have ${n} values (one per cell)`)
        for (let i = 0; i < n; i++) out[i] = v[i]
        break
      }
      case 'coord': for (let i = 0; i < n; i++) out[i] = node.axis === 0 ? i % nx : node.axis === 1 ? Math.floor(i / nx) % ny : Math.floor(i / (nx * ny)); break
      case 'index': for (let i = 0; i < n; i++) out[i] = i; break
      case 'tick': out.fill(tick); break
      case 'bin': binary(node.op, vals[node.a], vals[node.b], out); break
      case 'where': { const c = vals[node.c], a = vals[node.a], b = vals[node.b]; for (let i = 0; i < n; i++) out[i] = c[i] !== 0 ? a[i] : b[i]; break }
      case 'clamp': { const a = vals[node.a]; for (let i = 0; i < n; i++) { const v = a[i]; out[i] = v < node.lo ? node.lo : v > node.hi ? node.hi : v } break }
      case 'hash': for (let i = 0; i < n; i++) out[i] = hash01(i, tick, seed, node.salt); break
      case 'nbr': {
        const { nbr, count } = neighbors()
        const a = vals[node.a], stride = offsets.length
        for (let r = 0; r < n; r++) {
          const base = r * stride, c = count[r]
          if (node.op === 'count') { out[r] = c; continue }
          if (node.op === 'max') {
            let m = -Infinity
            for (let q = 0; q < c; q++) m = Math.max(m, a[nbr[base + q]])
            out[r] = Number.isFinite(m) ? m : 0
            continue
          }
          let s = 0
          for (let q = 0; q < c; q++) s += a[nbr[base + q]]
          out[r] = s
          if (node.op === 'avg' && c) out[r] = out[r] / c // the sum is rounded to a 32-bit float first, as `Field` does
        }
        break
      }
    }
    vals[id] = out
  })
  return vals
}

function binary(op: BinOp, a: Float32Array, b: Float32Array, out: Float32Array): void {
  const n = out.length
  switch (op) {
    case 'add': for (let i = 0; i < n; i++) out[i] = a[i] + b[i]; break
    case 'sub': for (let i = 0; i < n; i++) out[i] = a[i] - b[i]; break
    case 'mul': for (let i = 0; i < n; i++) out[i] = a[i] * b[i]; break
    case 'div': for (let i = 0; i < n; i++) out[i] = a[i] / b[i]; break
    case 'min': for (let i = 0; i < n; i++) { const x = a[i], y = b[i]; out[i] = x < y ? x : y } break
    case 'max': for (let i = 0; i < n; i++) { const x = a[i], y = b[i]; out[i] = x > y ? x : y } break
    case 'eq': for (let i = 0; i < n; i++) out[i] = a[i] === b[i] ? 1 : 0; break
    case 'ne': for (let i = 0; i < n; i++) out[i] = a[i] !== b[i] ? 1 : 0; break
    case 'lt': for (let i = 0; i < n; i++) out[i] = a[i] < b[i] ? 1 : 0; break
    case 'le': for (let i = 0; i < n; i++) out[i] = a[i] <= b[i] ? 1 : 0; break
    case 'gt': for (let i = 0; i < n; i++) out[i] = a[i] > b[i] ? 1 : 0; break
    case 'ge': for (let i = 0; i < n; i++) out[i] = a[i] >= b[i] ? 1 : 0; break
    case 'and': for (let i = 0; i < n; i++) out[i] = a[i] !== 0 && b[i] !== 0 ? 1 : 0; break
    case 'or': for (let i = 0; i < n; i++) out[i] = a[i] !== 0 || b[i] !== 0 ? 1 : 0; break
  }
}

// ---------------------------------------------------------------------------------------------------------
// The program as data

/** Checks a program that came from somewhere else (a file, a worker). Returns readable problems, or none if it is well formed. */
export function validateProgram(p: unknown): string[] {
  const errors: string[] = []
  if (!p || typeof p !== 'object') return ['a program must be an object']
  const { nodes, out, fields, params } = p as Partial<Program>
  if (!Array.isArray(nodes)) return ['program.nodes must be a list']
  if (!Array.isArray(fields) || !Array.isArray(params)) errors.push('program.fields and program.params must be lists of names')
  const known = (i: unknown, at: number) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < at
  nodes.forEach((n, at) => {
    const where = `nodes.${at}`
    if (!n || typeof n !== 'object') return void errors.push(`${where}: must be an object`)
    const ref = (key: string) => { if (!known((n as Record<string, unknown>)[key], at)) errors.push(`${where}.${key}: must be the index of an earlier node`) }
    switch (n.k) {
      case 'num': if (typeof n.v !== 'number' || !Number.isFinite(n.v)) errors.push(`${where}.v: must be a finite number`); break
      case 'field': if (typeof n.name !== 'string' || (Array.isArray(fields) && !fields.includes(n.name))) errors.push(`${where}.name: must be one of program.fields`); break
      case 'param': if (typeof n.name !== 'string' || (Array.isArray(params) && !params.includes(n.name))) errors.push(`${where}.name: must be one of program.params`); break
      case 'coord': if (![0, 1, 2].includes(n.axis)) errors.push(`${where}.axis: must be 0, 1 or 2`); break
      case 'index': case 'tick': break
      case 'bin': if (!BIN_OPS.includes(n.op)) errors.push(`${where}.op: must be one of ${BIN_OPS.join(', ')}`); ref('a'); ref('b'); break
      case 'where': ref('c'); ref('a'); ref('b'); break
      case 'clamp': ref('a'); if (typeof n.lo !== 'number' || typeof n.hi !== 'number') errors.push(`${where}: lo and hi must be numbers`); break
      case 'nbr': if (!NEIGHBOR_OPS.includes(n.op)) errors.push(`${where}.op: must be one of ${NEIGHBOR_OPS.join(', ')}`); ref('a'); break
      case 'hash': if (!Number.isInteger(n.salt)) errors.push(`${where}.salt: must be an integer`); break
      default: errors.push(`${where}.k: unknown kind "${(n as { k?: unknown }).k}"`)
    }
  })
  if (!out || typeof out !== 'object') errors.push('program.out must map result field names to node indexes')
  else for (const [name, i] of Object.entries(out)) if (!known(i, nodes.length)) errors.push(`out.${name}: must be the index of a node`)
  const reduce = (p as Program).reduce
  if (reduce !== undefined) {
    if (!reduce || typeof reduce !== 'object') errors.push('program.reduce must map names to { op, node }')
    else for (const [name, r] of Object.entries(reduce)) {
      if (!r || !REDUCE_OPS.includes(r.op)) errors.push(`reduce.${name}.op: must be one of ${REDUCE_OPS.join(', ')}`)
      if (!r || !known(r.node, nodes.length)) errors.push(`reduce.${name}.node: must be the index of a node`)
    }
  }
  return errors
}
