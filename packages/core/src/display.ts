import { Colors, Field, type Rgb } from '@breve/stdlib'

/** What `display` returns for one entity: whether to draw it, and its color (`'#4f86f7'`, `[r, g, b]` between 0 and 1, or `ctx.colors.ramp(...)`). */
export interface Look {
  visible?: boolean | number
  color?: string | ArrayLike<number>
}

/** What `displayAll` returns for the whole set: a field of 0 and 1 (or any numbers; non-zero is drawn) and a color per cell from `ctx.colors.rampField`. */
export interface LookAll {
  visible?: Field | ArrayLike<number>
  color?: { r: Field | ArrayLike<number>; g: Field | ArrayLike<number>; b: Field | ArrayLike<number> }
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))

function rgbOf(c: unknown): Rgb | null {
  if (typeof c === 'string') return Colors.hex(c)
  if (c && typeof c === 'object' && typeof (c as ArrayLike<number>).length === 'number' && (c as ArrayLike<number>).length >= 3) {
    const a = c as ArrayLike<number>
    return [a[0], a[1], a[2]]
  }
  return null
}

const dataOf = (v: Field | ArrayLike<number>): ArrayLike<number> => (v instanceof Field ? v.data : v)

/**
 * Colors and visibility for `n` entities from a per-entity `display`. Returns null colors when the script gives none.
 * The first error stops the pass and is handed to `fail` once, rather than once per entity.
 */
export function looksOf(n: number, look: (i: number) => Look | void, fail: (e: unknown) => void): { rgb: Uint8Array | null; visible: Uint8Array | null } {
  let rgb: Uint8Array | null = null
  let visible: Uint8Array | null = null
  try {
    for (let i = 0; i < n; i++) {
      const out = look(i)
      if (!out || typeof out !== 'object') continue
      if (out.color !== undefined) {
        const c = rgbOf(out.color)
        if (c) { rgb ??= new Uint8Array(n * 3).fill(255); rgb[i * 3] = byte(c[0]); rgb[i * 3 + 1] = byte(c[1]); rgb[i * 3 + 2] = byte(c[2]) }
      }
      if (out.visible !== undefined) { visible ??= new Uint8Array(n).fill(1); visible[i] = out.visible ? 1 : 0 }
    }
  } catch (e) {
    fail(e)
    return { rgb: null, visible: null }
  }
  return { rgb, visible }
}

/** The same from a whole-set `displayAll`, which must give one value per entity. */
export function looksOfAll(n: number, out: unknown, fail: (e: unknown) => void): { rgb: Uint8Array | null; visible: Uint8Array | null } {
  const look = out as LookAll | undefined
  let rgb: Uint8Array | null = null
  let visible: Uint8Array | null = null
  try {
    if (look?.visible !== undefined) {
      const v = dataOf(look.visible)
      if (v.length !== n) throw new Error(`displayAll: "visible" must have one value per entity (${n}), got ${v.length}`)
      visible = new Uint8Array(n)
      for (let i = 0; i < n; i++) visible[i] = v[i] !== 0 ? 1 : 0
    }
    if (look?.color !== undefined) {
      const r = dataOf(look.color.r), g = dataOf(look.color.g), b = dataOf(look.color.b)
      if (r.length !== n || g.length !== n || b.length !== n) throw new Error(`displayAll: "color" must have one color per entity (${n}); make it with ctx.colors.rampField(stops, field)`)
      rgb = new Uint8Array(n * 3)
      for (let i = 0; i < n; i++) { rgb[i * 3] = byte(r[i]); rgb[i * 3 + 1] = byte(g[i]); rgb[i * 3 + 2] = byte(b[i]) }
    }
  } catch (e) {
    fail(e)
    return { rgb: null, visible: null }
  }
  return { rgb, visible }
}
