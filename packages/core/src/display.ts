import { Colors, Field, type Rgb } from '@breve/stdlib'

/**
 * What `display` returns for one entity. `visible` says whether to draw it, `color` is `'#4f86f7'`, `[r, g, b]` between 0 and 1,
 * or `ctx.colors.ramp(...)`, `opacity` runs from 0 (see-through) to 1, and `scale` multiplies its drawn size (1 is normal).
 */
export interface Look {
  visible?: boolean | number
  color?: string | ArrayLike<number>
  opacity?: number
  scale?: number
}

/** What `displayAll` returns for the whole set, as fields: `color` from `ctx.colors.rampField`, the rest one number per entity. */
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
  const column = (name: string, v: Field | ArrayLike<number>): ArrayLike<number> => {
    const d = dataOf(v)
    if (d.length !== n) throw new Error(`displayAll: "${name}" must have one value per entity (${n}), got ${d.length}`)
    return d
  }
  try {
    if (look?.visible !== undefined) {
      const v = column('visible', look.visible)
      out.visible = new Uint8Array(n)
      for (let i = 0; i < n; i++) out.visible[i] = v[i] !== 0 ? 1 : 0
    }
    if (look?.color !== undefined) {
      const c = look.color
      if (!c || c.r === undefined || c.g === undefined || c.b === undefined) throw new Error('displayAll: "color" must be a color per entity; make it with ctx.colors.rampField(stops, field)')
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
