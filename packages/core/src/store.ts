export type ColumnType = 'f32' | 'f64' | 'i32' | 'u32' | 'u8' | 'str'

/** A column of strings. Not a typed array, so it is slower to copy and hash: the escape hatch for text. */
export class StrColumn extends Array<string> {
  static get [Symbol.species]() { return Array }
  constructor(n = 0) {
    super(n)
    this.fill('')
  }
  /** Copy `src` in from index 0, like a typed array's `set`. */
  set(src: ArrayLike<string>): void {
    for (let i = 0; i < src.length; i++) this[i] = src[i]
  }
}

export type Column = Float32Array | Float64Array | Int32Array | Uint32Array | Uint8Array
export type EntityId = number

const CTORS = {
  str: StrColumn,
  f32: Float32Array,
  f64: Float64Array,
  i32: Int32Array,
  u32: Uint32Array,
  u8: Uint8Array,
} as const

export interface TableSnapshot {
  size: number
  nextSlot: number
  freeSlots: number[]
  cols: Record<string, Column>
  rowToSlot: Uint32Array
  slotToRow: Int32Array
  slotGen: Uint32Array
}

export interface TableSnapshot {
  size: number
  nextSlot: number
  freeSlots: number[]
  cols: Record<string, Column>
  rowToSlot: Uint32Array
  slotToRow: Int32Array
  slotGen: Uint32Array
}

const SLOT_BITS = 20
const SLOT_MASK = (1 << SLOT_BITS) - 1

/**
 * One archetype table: typed-array columns indexed by row. An entity id is a
 * (generation, slot) pair, so a stale id can never address a recycled row.
 * Despawn is swap-remove, so rows stay dense.
 */
export class Table<K extends string = string> {
  readonly schema: Record<K, ColumnType>
  cols: Record<K, Column>
  size = 0
  private capacity: number
  private rowToSlot: Uint32Array
  private slotToRow: Int32Array
  private slotGen: Uint32Array
  private freeSlots: number[] = []
  private nextSlot = 0

  /** Numbers per row for each column: 1 unless a column holds a small array per entity (weights, a hidden state). */
  readonly strides: Record<K, number>

  constructor(schema: Record<K, ColumnType>, capacity = 64, strides: Partial<Record<K, number>> = {}) {
    this.schema = schema
    this.capacity = capacity
    this.cols = {} as Record<K, Column>
    this.strides = {} as Record<K, number>
    for (const k of Object.keys(schema) as K[]) {
      this.strides[k] = strides[k] ?? 1
      this.cols[k] = new CTORS[schema[k]](capacity * this.strides[k]) as unknown as Column
    }
    this.rowToSlot = new Uint32Array(capacity)
    this.slotToRow = new Int32Array(capacity).fill(-1)
    this.slotGen = new Uint32Array(capacity)
  }

  private grow(): void {
    const cap = this.capacity * 2
    for (const k of Object.keys(this.schema) as K[]) {
      const next = new CTORS[this.schema[k]](cap * this.strides[k]) as unknown as Column
      next.set(this.cols[k] as never)
      this.cols[k] = next
    }
    const r2s = new Uint32Array(cap)
    r2s.set(this.rowToSlot)
    this.rowToSlot = r2s
    const s2r = new Int32Array(cap).fill(-1)
    s2r.set(this.slotToRow)
    this.slotToRow = s2r
    const gen = new Uint32Array(cap)
    gen.set(this.slotGen)
    this.slotGen = gen
    this.capacity = cap
  }

  spawn(): EntityId {
    if (this.size === this.capacity) this.grow()
    const slot = this.freeSlots.pop() ?? this.nextSlot++
    const row = this.size++
    this.slotToRow[slot] = row
    this.rowToSlot[row] = slot
    for (const k of Object.keys(this.schema) as K[]) this.cols[k].fill(this.schema[k] === 'str' ? ('' as never) : (0 as never), row * this.strides[k], (row + 1) * this.strides[k])
    return this.slotGen[slot] * (SLOT_MASK + 1) + slot
  }

  /** Row for a live id, or -1 if the id is stale or unknown. */
  row(id: EntityId): number {
    const slot = id % (SLOT_MASK + 1)
    const gen = Math.floor(id / (SLOT_MASK + 1))
    if (slot >= this.capacity || this.slotGen[slot] !== gen) return -1
    return this.slotToRow[slot]
  }

  has(id: EntityId): boolean {
    return this.row(id) >= 0
  }

  idAt(row: number): EntityId {
    const slot = this.rowToSlot[row]
    return this.slotGen[slot] * (SLOT_MASK + 1) + slot
  }

  despawn(id: EntityId): boolean {
    const row = this.row(id)
    if (row < 0) return false
    const slot = this.rowToSlot[row]
    const last = this.size - 1
    if (row !== last) {
      for (const k of Object.keys(this.schema) as K[]) {
        const n = this.strides[k]
        this.cols[k].copyWithin(row * n, last * n, (last + 1) * n)
      }
      const movedSlot = this.rowToSlot[last]
      this.rowToSlot[row] = movedSlot
      this.slotToRow[movedSlot] = row
    }
    this.slotToRow[slot] = -1
    this.slotGen[slot]++
    this.freeSlots.push(slot)
    this.size--
    return true
  }

  /** A copy of everything the table holds, ids included, so a restored table hands out the same ids as the original would have. */
  snapshot(): TableSnapshot {
    const cols: Record<string, Column> = {}
    for (const k of Object.keys(this.schema)) cols[k] = (this.cols[k as K] as Float64Array).slice(0, this.size * this.strides[k as K]) as Column
    return {
      size: this.size,
      nextSlot: this.nextSlot,
      freeSlots: [...this.freeSlots],
      cols,
      rowToSlot: this.rowToSlot.slice(0, this.size),
      slotToRow: this.slotToRow.slice(0, this.nextSlot),
      slotGen: this.slotGen.slice(0, this.nextSlot),
    }
  }

  restore(s: TableSnapshot): void {
    while (this.capacity < Math.max(s.size, s.nextSlot)) this.grow()
    for (const k of Object.keys(this.schema) as K[]) {
      const col = this.cols[k] as Float64Array
      col.fill(this.schema[k] === 'str' ? ('' as never) : (0 as never))
      col.set(s.cols[k] as Float64Array)
    }
    this.rowToSlot.fill(0)
    this.rowToSlot.set(s.rowToSlot)
    this.slotToRow.fill(-1)
    this.slotToRow.set(s.slotToRow)
    this.slotGen.fill(0)
    this.slotGen.set(s.slotGen)
    this.size = s.size
    this.nextSlot = s.nextSlot
    this.freeSlots = [...s.freeSlots]
  }

  /** FNV-1a over the live part of every column, for determinism tests. */
  hash(): string {
    let h = 0x811c9dc5
    for (const k of Object.keys(this.schema).sort() as K[]) {
      const c = this.cols[k]
      if (this.schema[k] === 'str') {
        for (const text of (c as unknown as string[]).slice(0, this.size)) for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) }
        continue
      }
      const bytes = new Uint8Array(c.buffer, c.byteOffset, this.size * this.strides[k] * c.BYTES_PER_ELEMENT)
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i]
        h = Math.imul(h, 0x01000193)
      }
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }
}
