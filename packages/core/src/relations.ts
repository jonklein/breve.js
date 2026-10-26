import { Table, type Column, type ColumnType, type EntityId, type TableSnapshot } from './store'

export type EdgeId = number

/** The edges of one named relation: directed, optionally with attributes (weight, since, kind), stored as columns like any other table. */
export class Relation<A extends string = string> {
  readonly name: string
  readonly edges: Table<'src' | 'dst' | A>
  private out: CsrIndex | null = null
  private inn: CsrIndex | null = null

  constructor(name: string, attrs: Record<A, ColumnType> = {} as Record<A, ColumnType>) {
    this.name = name
    // entity ids carry a generation above 2^20, which a 32-bit column would clip
    this.edges = new Table({ src: 'f64', dst: 'f64', ...attrs } as Record<'src' | 'dst' | A, ColumnType>, 64)
  }

  get size(): number { return this.edges.size }

  /** Add an edge a -> b. Returns its id, which stays valid until the edge is removed. Use `symmetric` to add b -> a too. */
  add(a: EntityId, b: EntityId, attrs: Partial<Record<A, number | string | unknown>> = {}, symmetric = false): EdgeId {
    const e = this.addOne(a, b, attrs)
    if (symmetric && a !== b) this.addOne(b, a, attrs)
    return e
  }

  private addOne(a: EntityId, b: EntityId, attrs: Partial<Record<A, unknown>>): EdgeId {
    const id = this.edges.spawn()
    const row = this.edges.row(id)
    const cols = this.edges.cols as Record<string, Column>
    cols.src[row] = a
    cols.dst[row] = b
    for (const k of Object.keys(attrs)) if (k in cols) (cols[k] as unknown as unknown[])[row] = (attrs as Record<string, unknown>)[k]
    this.out = this.inn = null
    return id
  }

  remove(edge: EdgeId): boolean {
    const ok = this.edges.despawn(edge)
    if (ok) this.out = this.inn = null
    return ok
  }

  /** Remove every a -> b edge. Returns how many went. */
  removeBetween(a: EntityId, b: EntityId): number {
    let n = 0
    for (const e of this.outEdges(a)) if (this.dst(e) === b && this.remove(e)) n++
    return n
  }

  /** Drop every edge that touches an entity, for when it despawns. */
  removeEntity(id: EntityId): number {
    let n = 0
    for (const e of [...this.outEdges(id), ...this.inEdges(id)]) if (this.remove(e)) n++
    return n
  }

  has(a: EntityId, b: EntityId): boolean {
    for (const e of this.outEdges(a)) if (this.dst(e) === b) return true
    return false
  }

  src(edge: EdgeId): EntityId { return (this.edges.cols.src as Float64Array)[this.edges.row(edge)] }
  dst(edge: EdgeId): EntityId { return (this.edges.cols.dst as Float64Array)[this.edges.row(edge)] }

  /** An attribute of one edge, by name. For hot loops read `edges.cols[name]` directly. */
  attr<T = number>(edge: EdgeId, name: A): T { return (this.edges.cols[name] as unknown as T[])[this.edges.row(edge)] }

  /** Ids of the edges leaving `a`, in insertion order. */
  outEdges(a: EntityId): EdgeId[] { return this.index('out').lookup(a).map((r) => this.edges.idAt(r)) }
  inEdges(b: EntityId): EdgeId[] { return this.index('in').lookup(b).map((r) => this.edges.idAt(r)) }

  /** Entities `a` points at / that point at `b`. */
  targets(a: EntityId): EntityId[] { return this.index('out').lookup(a).map((r) => (this.edges.cols.dst as Float64Array)[r]) }
  sources(b: EntityId): EntityId[] { return this.index('in').lookup(b).map((r) => (this.edges.cols.src as Float64Array)[r]) }

  private index(dir: 'out' | 'in'): CsrIndex {
    if (dir === 'out') return (this.out ??= new CsrIndex(this.edges.cols.src as Float64Array, this.edges.size))
    return (this.inn ??= new CsrIndex(this.edges.cols.dst as Float64Array, this.edges.size))
  }

  snapshot(): TableSnapshot { return this.edges.snapshot() }
  restore(s: TableSnapshot): void {
    this.edges.restore(s)
    this.out = this.inn = null
  }
  hash(): string { return this.edges.hash() }
}

/** Edge rows grouped by key (CSR): `rows[start[k] .. end[k])` are the rows whose key is k, in row order. Rebuilt lazily after edits. */
class CsrIndex {
  private rows: Int32Array
  private span = new Map<number, [number, number]>()

  constructor(keys: Float64Array, n: number) {
    const order = Int32Array.from({ length: n }, (_, i) => i)
    // stable by row, so iteration order is a function of the table alone
    order.sort((x, y) => keys[x] - keys[y] || x - y)
    this.rows = order
    for (let i = 0; i < n; ) {
      let j = i
      while (j < n && keys[order[j]] === keys[order[i]]) j++
      this.span.set(keys[order[i]], [i, j])
      i = j
    }
  }

  lookup(key: number): number[] {
    const s = this.span.get(key)
    return s ? Array.from(this.rows.subarray(s[0], s[1])) : []
  }
}

export type RelationsSnapshot = Record<string, { attrs: Record<string, ColumnType>; table: TableSnapshot }>

/** The relations of one sim, by name. */
export class Relations {
  private byName = new Map<string, Relation>()

  /** The named relation, created on first use (so a script can say `relations.get('trades_with')` without setup). */
  get(name: string, attrs?: Record<string, ColumnType>): Relation {
    let r = this.byName.get(name)
    if (!r) this.byName.set(name, (r = new Relation(name, attrs)))
    return r
  }

  has(name: string): boolean { return this.byName.has(name) }
  names(): string[] { return [...this.byName.keys()].sort() }

  /** Includes each relation's attribute types, so a fork that never declared a relation can recreate it. */
  snapshot(): RelationsSnapshot {
    return Object.fromEntries([...this.byName].map(([k, r]) => {
      const { src: _s, dst: _d, ...attrs } = r.edges.schema as Record<string, ColumnType>
      return [k, { attrs, table: r.snapshot() }]
    }))
  }

  restore(s: RelationsSnapshot): void {
    for (const k of [...this.byName.keys()]) if (!(k in s)) this.byName.delete(k)
    for (const [k, { attrs, table }] of Object.entries(s)) this.get(k, attrs).restore(table)
  }

  hash(): string { return this.names().map((n) => `${n}:${this.byName.get(n)!.hash()}`).join('|') }
}
