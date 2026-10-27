import { Colors, Field, type Rgb } from '@breve/stdlib'

/**
 * What `display` returns for one entity. `visible` says whether to draw it, `color` is `'#4f86f7'`, `[r, g, b]` between 0 and 1,
 * or `ctx.colors.gradient(...)`, `opacity` runs from 0 (see-through) to 1, and `scale` multiplies its drawn size (1 is normal).
 */
export interface Look {
  visible?: boolean | number
  color?: string | ArrayLike<number>
  opacity?: number
  scale?: number
}

/** What `displayAll` returns for the whole set, as fields: `color` from `ctx.colors.gradientField`, the rest one number per entity. */
export interface LookAll {
  visible?: Field | ArrayLike<number>
  color?: { r: Field | ArrayLike<number>; g: Field | ArrayLike<number>; b: Field | ArrayLike<number> }
  opacity?: Field | ArrayLike<number>
  scale?: Field | ArrayLike<number>
}

/** A set's look, ready to send to the renderer: one entry per entity, or null where the script said nothing. */
export interface Looks {
  /** Red, green, blue (0 to 255). */
  rgb: Uint8Array | null
  /** 1 to draw, 0 to hide. */
  visible: Uint8Array | null
  /** Opacity (0 to 255). */
  alpha: Uint8Array | null
  /** Size multiplier. */
  scale: Float32Array | null
}

const NONE: Looks = { rgb: null, visible: null, alpha: null, scale: null }
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

/** What a script handed over, in a few words, for an error message. */
const describe = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? `a list of ${v.length}` : typeof v === 'object' ? `an object (${Object.keys(v as object).slice(0, 4).join(', ') || 'no fields'})` : `${typeof v} ${String(v)}`)

/**
 * The look of `n` entities from a per-entity `display`. The first error stops the pass and is handed to `fail` once, rather than
 * once per entity.
 */
export function looksOf(n: number, look: (i: number) => Look | void, fail: (e: unknown) => void): Looks {
  const out: Looks = { ...NONE }
  try {
    for (let i = 0; i < n; i++) {
      const l = look(i)
      if (!l || typeof l !== 'object') continue
      if (l.color !== undefined) {
        const c = rgbOf(l.color)
        if (c) { out.rgb ??= new Uint8Array(n * 3).fill(255); out.rgb[i * 3] = byte(c[0]); out.rgb[i * 3 + 1] = byte(c[1]); out.rgb[i * 3 + 2] = byte(c[2]) }
      }
      if (l.visible !== undefined) { out.visible ??= new Uint8Array(n).fill(1); out.visible[i] = l.visible ? 1 : 0 }
      if (l.opacity !== undefined) { out.alpha ??= new Uint8Array(n).fill(255); out.alpha[i] = byte(l.opacity) }
      if (l.scale !== undefined) { out.scale ??= new Float32Array(n).fill(1); out.scale[i] = Math.max(0, Number(l.scale) || 0) }
    }
  } catch (e) {
    fail(e)
    return { ...NONE }
  }
  return out
}

/** The same from a whole-set `displayAll`, which must give one value per entity. */
export function looksOfAll(n: number, result: unknown, fail: (e: unknown) => void): Looks {
  const look = result as LookAll | undefined
  const out: Looks = { ...NONE }
  const column = (name: string, v: unknown): ArrayLike<number> => {
    if (typeof v === 'number') return new Float32Array(n).fill(v) // one number is the same value for everyone
    // a Field (even one from another copy of the library) keeps its values in `data`; a list or typed array is its own values
    const d = v instanceof Field ? v.data : v && typeof v === 'object' && 'data' in v && !('length' in v) ? (v as { data: ArrayLike<number> }).data : v
    const values = d && typeof d === 'object' && typeof (d as ArrayLike<number>).length === 'number' ? (d as ArrayLike<number>) : null
    if (!values || values.length !== n) throw new Error(`displayAll: "${name}" must have one value per entity (${n}), got ${values ? `${values.length} values` : describe(v)}. Give a Field or a list with one number per entity, or one number for all of them.`)
    return values
  }
  try {
    if (look?.visible !== undefined) {
      const v = column('visible', look.visible)
      out.visible = new Uint8Array(n)
      for (let i = 0; i < n; i++) out.visible[i] = v[i] !== 0 ? 1 : 0
    }
    if (look?.color !== undefined) {
      const c = look.color
      if (!c || c.r === undefined || c.g === undefined || c.b === undefined) throw new Error('displayAll: "color" must be a color per entity; make it with ctx.colors.gradientField(stops, field)')
      const r = column('color', c.r), g = column('color', c.g), b = column('color', c.b)
      out.rgb = new Uint8Array(n * 3)
      for (let i = 0; i < n; i++) { out.rgb[i * 3] = byte(r[i]); out.rgb[i * 3 + 1] = byte(g[i]); out.rgb[i * 3 + 2] = byte(b[i]) }
    }
    if (look?.opacity !== undefined) {
      const v = column('opacity', look.opacity)
      out.alpha = new Uint8Array(n)
      for (let i = 0; i < n; i++) out.alpha[i] = byte(v[i])
    }
    if (look?.scale !== undefined) {
      const v = column('scale', look.scale)
      out.scale = new Float32Array(n)
      for (let i = 0; i < n; i++) out.scale[i] = Math.max(0, v[i])
    }
  } catch (e) {
    fail(e)
    return { ...NONE }
  }
  return out
}
