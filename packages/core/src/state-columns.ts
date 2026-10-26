import type { Table } from './store'
import type { StateField } from './scene'
import { Nums } from '@breve/stdlib'

/**
 * Script-declared state kept in a table's columns, shared by the worlds whose entities carry it (free agents, creatures): how a value a
 * script returned is stored, and the getters that read it back as `self.name`.
 */

/** Store the values a script returned (`state: { energy: 3 }`, an `init` result) into one row. Anything that is not a declared field is reported. */
export function writeState(
  table: Table<string>, fields: StateField[], row: number, state: Record<string, unknown>,
  where: string, fail: (where: string, e: Error) => void,
): void {
  for (const [name, v] of Object.entries(state)) {
    const f = fields.find((x) => x.name === name)
    if (!f) { fail(where, new Error(`state "${name}" does not exist: a set's state is what its init returns`)); continue }
    const col = table.cols[name]
    if (f.kind === 'string') { (col as unknown as string[])[row] = String(v); continue }
    if (f.kind === 'boolean') { col[row] = v ? 1 : 0; continue }
    const vals = typeof v === 'number' ? [v] : Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v as ArrayLike<number>) : null
    if (!vals || vals.length !== f.length || vals.some((x) => !Number.isFinite(x))) {
      fail(where, new Error(`state "${name}" needs ${f.length} finite number${f.length === 1 ? '' : 's'}`))
      continue
    }
    for (let k = 0; k < f.length; k++) col[row * f.length + k] = f.type === 'i32' ? Math.round(vals[k]) : vals[k]
  }
}

/** A getter on `proto` for each state field: the value for one row (a boolean as true/false, an array as a view of its numbers). */
export function defineStateGetters(proto: object, table: Table<string>, fields: StateField[]): void {
  for (const f of fields) {
    const n = f.length
    Object.defineProperty(proto, f.name, {
      get(this: { row: number }) {
        const col = table.cols[f.name]
        if (f.array) return col.subarray(this.row * n, (this.row + 1) * n)
        return f.kind === 'boolean' ? col[this.row] !== 0 : col[this.row]
      },
      enumerable: true,
    })
  }
}

/** A getter on a group class for each state field: that field of every member, as a list of numbers. */
export function defineGroupGetters(proto: object, fields: StateField[]): void {
  for (const f of fields) {
    Object.defineProperty(proto, f.name, {
      get(this: ArrayLike<unknown> & Iterable<unknown>) { const out = new Nums(); for (const m of this) out.push((m as never)[f.name]); return out },
      enumerable: true,
    })
  }
}
