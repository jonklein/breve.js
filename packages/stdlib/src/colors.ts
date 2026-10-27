import type { Field } from './field'

/** A color as red, green and blue between 0 and 1. */
export type Rgb = [number, number, number]

/** Colors for `display`: a number turned into a color, or a whole field of numbers into a color per cell. */
export class Colors {
  /** `'#4f86f7'` or `'#48f'` as red, green and blue between 0 and 1. Anything else is white. */
  static hex(c: string): Rgb {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
    if (!m) return [1, 1, 1]
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1]
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
  }

  /** Hue, saturation and lightness, each between 0 and 1 (hue goes around the color wheel). */
  static hsl(h: number, s: number, l: number): Rgb {
    const k = (n: number) => (n + (((h % 1) + 1) % 1) * 12) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return [f(0), f(8), f(4)]
  }

  /** Where `t` (0 to 1) falls along a list of colors, blending between neighbors: `Colors.gradient(['#4f86f7', '#7be495'], age / 20)`. */
  static gradient(stops: string[], t: number): Rgb {
    if (!stops.length) return [1, 1, 1]
    const rgb = stops.map(Colors.hex)
    const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (rgb.length - 1)
    const i = Math.min(rgb.length - 2, Math.floor(x))
    if (rgb.length === 1) return rgb[0]
    const k = x - i
    return [rgb[i][0] + (rgb[i + 1][0] - rgb[i][0]) * k, rgb[i][1] + (rgb[i + 1][1] - rgb[i][1]) * k, rgb[i][2] + (rgb[i + 1][2] - rgb[i][2]) * k]
  }

  /** `gradient` for a whole field at once: a color for every cell, for `displayAll`. */
  static gradientField(stops: string[], t: Field | ArrayLike<number>): { r: Float32Array; g: Float32Array; b: Float32Array } {
    const d = 'data' in t ? t.data : t
    const n = d.length
    const out = { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) }
    const rgb = stops.map(Colors.hex)
    if (!rgb.length) return out
    const top = rgb.length - 1
    for (let i = 0; i < n; i++) {
      const v = d[i]
      const x = Math.min(1, Math.max(0, v === v ? v : 0)) * top
      const j = Math.min(Math.max(0, top - 1), Math.floor(x))
      const a = rgb[j], b = rgb[Math.min(top, j + 1)], k = top ? x - j : 0
      out.r[i] = a[0] + (b[0] - a[0]) * k
      out.g[i] = a[1] + (b[1] - a[1]) * k
      out.b[i] = a[2] + (b[2] - a[2]) * k
    }
    return out
  }
}
