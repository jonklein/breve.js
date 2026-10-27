/**
 * Generated textures: patterns made from a few numbers, the same every time and seamless when repeated.
 * Pure (no three.js, no canvas): it fills an RGBA byte array and a height map, so it runs anywhere and can be tested.
 */

export type TextureKind = 'noise' | 'fbm' | 'checker' | 'stripes' | 'grid' | 'dots' | 'bricks' | 'marble' | 'grass' | 'sand' | 'water' | 'url'

export interface TextureSpec {
  kind?: TextureKind
  url?: string
  colors?: string[]
  scale?: number
  seed?: number
  contrast?: number
  bump?: number
  tile?: number
}

export interface Generated {
  size: number
  /** size × size pixels, 4 bytes each (sRGB). */
  rgba: Uint8ClampedArray
  /** 0 to 1 per pixel, for bump and normal maps. */
  height: Float32Array
}

/** Colors and pattern size each kind starts with. */
export const KIND_DEFAULTS: Record<Exclude<TextureKind, 'url'>, { colors: string[]; scale: number; bump: number }> = {
  noise: { colors: ['#5c6470', '#a6afbc'], scale: 6, bump: 0.6 },
  fbm: { colors: ['#4a5560', '#b9c2cc'], scale: 4, bump: 1 },
  checker: { colors: ['#2b3340', '#8c97a8'], scale: 8, bump: 0 },
  stripes: { colors: ['#31404f', '#9fb0c4'], scale: 10, bump: 0.3 },
  grid: { colors: ['#9aa6b6', '#2d3644'], scale: 8, bump: 0.5 },
  dots: { colors: ['#2a3240', '#d8c9a8'], scale: 8, bump: 0.5 },
  bricks: { colors: ['#6b2f26', '#b4573f', '#cbb9a4'], scale: 6, bump: 1.2 },
  marble: { colors: ['#e8e4dc', '#9aa0aa', '#4b5260'], scale: 3, bump: 0.2 },
  grass: { colors: ['#22401a', '#3d6a28', '#7a9f45'], scale: 24, bump: 1 },
  sand: { colors: ['#b9965f', '#d9bd86', '#efdcb0'], scale: 10, bump: 1 },
  water: { colors: ['#0f3d63', '#2a7fb0', '#a8e0ff'], scale: 6, bump: 1.4 },
}

/** A hash of lattice coordinates into [0, 1). */
function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smooth = (t: number) => t * t * (3 - 2 * t)

/** Value noise over a lattice that wraps every `period` cells, so the pattern tiles. `x`, `y` are in lattice units. */
function pnoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = smooth(x - ix), fy = smooth(y - iy)
  const w = (i: number) => ((i % period) + period) % period
  const a = hash(w(ix), w(iy), seed), b = hash(w(ix + 1), w(iy), seed)
  const c = hash(w(ix), w(iy + 1), seed), d = hash(w(ix + 1), w(iy + 1), seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** Layers of noise, each twice as fine as the last (and wrapping at twice the period), summed to 0..1. */
function fbm(u: number, v: number, period: number, octaves: number, seed: number): number {
  let sum = 0, amp = 0.5, norm = 0, p = period
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise(u * p, v * p, p, seed + o * 31)
    norm += amp
    amp *= 0.5
    p *= 2
  }
  return sum / norm
}

function parseHex(c: string): [number, number, number] {
  const h = c.length === 4 ? [...c.slice(1)].map((x) => x + x).join('') : c.slice(1)
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0]
}

/** Where `t` (0..1) falls along a list of colors, blended between neighbors. */
function ramp(palette: [number, number, number][], t: number, out: number[]): void {
  const x = Math.min(1, Math.max(0, t)) * (palette.length - 1)
  const i = Math.min(palette.length - 2, Math.floor(x))
  const f = x - i
  const a = palette[i], b = palette[i + 1]
  out[0] = a[0] + (b[0] - a[0]) * f
  out[1] = a[1] + (b[1] - a[1]) * f
  out[2] = a[2] + (b[2] - a[2]) * f
}

/** The pattern at (u, v) in [0, 1): returns [color position 0..1, height 0..1]. */
function pattern(kind: Exclude<TextureKind, 'url'>, u: number, v: number, n: number, seed: number): [number, number] {
  const cells = Math.max(1, Math.round(n))
  switch (kind) {
    case 'noise': { const t = fbm(u, v, cells, 1, seed); return [t, t] }
    case 'fbm': { const t = fbm(u, v, cells, 5, seed); return [t, t] }
    case 'checker': {
      const t = (Math.floor(u * cells) + Math.floor(v * cells)) & 1
      return [t, t * 0.08]
    }
    case 'stripes': {
      const t = smooth(Math.min(1, Math.max(0, 0.5 + 0.9 * Math.sin(u * cells * Math.PI * 2))))
      return [t, t]
    }
    case 'grid': {
      const fu = (u * cells) % 1, fv = (v * cells) % 1
      const line = 0.06
      const t = fu < line || fv < line ? 1 : 0 // the line sits on each cell's low edge, so it repeats seamlessly
      return [1 - t, 1 - t * 0.8]
    }
    case 'dots': {
      const fu = (u * cells) % 1 - 0.5, fv = (v * cells) % 1 - 0.5
      const d = Math.hypot(fu, fv)
      const t = 1 - smooth(Math.min(1, Math.max(0, (d - 0.28) / 0.08)))
      return [t, t]
    }
    case 'bricks': {
      const rows = cells, cols = Math.max(2, Math.round(cells * 0.6))
      const row = Math.floor(v * rows)
      const uu = u * cols + (row & 1) * 0.5
      const fu = uu % 1, fv = (v * rows) % 1
      const mortar = fu < 0.05 || fv < 0.08 ? 1 : 0
      const brick = hash(Math.floor(uu) % cols, row, seed)
      return mortar ? [1, 0] : [0.15 + brick * 0.5, 0.55 + brick * 0.15]
    }
    case 'marble': {
      const warp = fbm(u, v, Math.max(2, cells), 4, seed) * 6
      const s = 0.5 + 0.5 * Math.sin((u * cells * 2 + warp) * Math.PI)
      const t = Math.pow(s, 0.6)
      return [t, 0.5 + t * 0.05]
    }
    case 'grass': {
      const broad = fbm(u, v, 4, 3, seed)
      const blades = pnoise(u * cells * 2, v * cells * 2, cells * 2, seed + 7)
      const fine = pnoise(u * cells * 6, v * cells * 6, cells * 6, seed + 13)
      const t = 0.15 + broad * 0.45 + blades * 0.25 + fine * 0.15
      return [t, 0.4 + blades * 0.4 + fine * 0.2]
    }
    case 'sand': {
      const dunes = fbm(u, v, 3, 3, seed)
      const ripple = 0.5 + 0.5 * Math.sin((u * 5 + v * 2 + dunes * 2) * cells * Math.PI * 0.5)
      const grain = pnoise(u * 128, v * 128, 128, seed + 3)
      const t = 0.3 + dunes * 0.35 + ripple * 0.15 + grain * 0.2
      return [t, 0.5 + ripple * 0.3 + grain * 0.2]
    }
    case 'water': {
      const a = fbm(u, v, Math.max(2, cells), 4, seed)
      const b = fbm(v + 0.3, u + 0.7, Math.max(2, cells), 3, seed + 5)
      const ripples = 0.5 + 0.5 * Math.sin((a * 5 + b * 3) * Math.PI)
      return [0.25 + ripples * 0.6 + a * 0.15, ripples]
    }
  }
}

/** Make a texture. `size` is the width and height in pixels (a power of two, 64 to 2048). */
export function generateTexture(spec: TextureSpec, size = 512): Generated {
  const kind = (spec.kind && spec.kind !== 'url' ? spec.kind : 'noise') as Exclude<TextureKind, 'url'>
  const d = KIND_DEFAULTS[kind]
  const colors = spec.colors && spec.colors.length >= 2 ? spec.colors : d.colors
  const palette = colors.map(parseHex)
  const scale = spec.scale ?? d.scale
  const seed = spec.seed ?? 1
  const contrast = spec.contrast ?? 1
  const N = Math.max(8, Math.min(2048, Math.round(size)))
  const rgba = new Uint8ClampedArray(N * N * 4)
  const height = new Float32Array(N * N)
  const c = [0, 0, 0]
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let [t, h] = pattern(kind, x / N, y / N, scale, seed)
      // contrast pushes the color position away from the middle
      t = Math.min(1, Math.max(0, 0.5 + (t - 0.5) * contrast))
      ramp(palette, t, c)
      // a little fine grain keeps flat colors from looking like plastic
      const grain = 0.96 + 0.08 * hash(x, y, seed + 99)
      const i = y * N + x
      rgba[i * 4] = c[0] * grain
      rgba[i * 4 + 1] = c[1] * grain
      rgba[i * 4 + 2] = c[2] * grain
      rgba[i * 4 + 3] = 255
      height[i] = h
    }
  return { size: N, rgba, height }
}

/** Turn a height map into a tangent-space normal map (RGBA bytes). `strength` of 1 is a gentle relief. Wraps at the edges, so it tiles. */
export function normalMapFrom(height: Float32Array, size: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4)
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]
  const k = strength * 4
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * k
      const dy = (at(x, y + 1) - at(x, y - 1)) * k
      const len = Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      out[i] = (-dx / len * 0.5 + 0.5) * 255
      out[i + 1] = (dy / len * 0.5 + 0.5) * 255
      out[i + 2] = (1 / len * 0.5 + 0.5) * 255
      out[i + 3] = 255
    }
  return out
}

/** The spec for a texture given by name or as an object, with every field present. `null` for an image URL (loaded separately). */
export function normalizeTexture(def: unknown): (Required<Omit<TextureSpec, 'url' | 'kind' | 'colors'>> & { kind: TextureKind; colors: string[]; url: string }) | null {
  const spec: TextureSpec = typeof def === 'string' ? { kind: def as TextureKind } : def && typeof def === 'object' ? (def as TextureSpec) : {}
  const kind = (spec.kind ?? (spec.url ? 'url' : 'noise')) as TextureKind
  const base = kind === 'url' ? KIND_DEFAULTS.noise : KIND_DEFAULTS[kind] ?? KIND_DEFAULTS.noise
  return {
    kind: kind in KIND_DEFAULTS || kind === 'url' ? kind : 'noise',
    url: spec.url ?? '',
    colors: spec.colors && spec.colors.length >= 2 ? spec.colors : base.colors,
    scale: spec.scale ?? base.scale,
    seed: spec.seed ?? 1,
    contrast: spec.contrast ?? 1,
    bump: spec.bump ?? base.bump,
    tile: spec.tile ?? 10,
  }
}
