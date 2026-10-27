import { Perlin2 } from './noise'

/** A gently bumpy landscape: Perlin-noise hills over a square, centered on the origin. */
export interface TerrainDef {
  /** Edge length of the square, in world units. */
  size?: number
  /** Cells per side. The height grid has resolution + 1 samples per side. */
  resolution?: number
  /** Height of the hills, in world units (peak to the middle, so the range is about +/- amplitude). */
  amplitude?: number
  /** Hills per world unit: 0.05 means one hill about every 20 units. */
  frequency?: number
  /** Layers of detail (1..6). */
  octaves?: number
  /** Surface color (visual only). */
  color?: string
  /** Ground texture (visual only): fine speckle (default), a one-meter grid for judging motion, or plain. */
  texture?: 'static' | 'grid' | 'none' | TerrainTexture
  /** Tints by height and slope, multiplied with the texture: `low` (valleys), `mid`, `high` (peaks) and `steep` (cliffs). Leave a color white to let the texture show. */
  palette?: { low?: string; mid?: string; high?: string; steep?: string }
  /** Surface shading (visual only): `smooth` (default) blends neighboring slopes; `flat` shows each facet. */
  shading?: 'smooth' | 'flat'
}

/** A generated or loaded texture by name or description (see TextureDef in the scene). */
export type TerrainTexture = string | { kind?: string; url?: string; colors?: string[]; scale?: number; seed?: number; contrast?: number; bump?: number; tile?: number }

export const TERRAIN_DEFAULTS = { size: 60, resolution: 48, amplitude: 1, frequency: 0.07, octaves: 3 }

/** A sampled terrain. `heights[ix * (n + 1) + iz]` is the height at x = -size/2 + ix * size/n, z likewise. */
export class Terrain {
  readonly size: number
  readonly n: number
  readonly heights: Float32Array
  readonly color: string | undefined
  readonly texture: 'static' | 'grid' | 'none' | TerrainTexture
  readonly palette: TerrainDef['palette']
  readonly shading: 'smooth' | 'flat'

  constructor(def: TerrainDef | undefined, seed: number) {
    const d = { ...TERRAIN_DEFAULTS, ...def }
    this.size = d.size
    this.n = Math.max(2, Math.min(256, Math.round(d.resolution)))
    this.color = def?.color
    this.texture = def?.texture ?? 'static'
    this.palette = def?.palette
    this.shading = def?.shading ?? 'smooth'
    const noise = new Perlin2(seed)
    const m = this.n + 1
    const step = this.size / this.n
    this.heights = new Float32Array(m * m)
    for (let ix = 0; ix < m; ix++)
      for (let iz = 0; iz < m; iz++) {
        const x = -this.size / 2 + ix * step, z = -this.size / 2 + iz * step
        this.heights[ix * m + iz] = d.amplitude * noise.fbm(x * d.frequency, z * d.frequency, Math.max(1, Math.min(6, Math.round(d.octaves))))
      }
  }

  /** Surface height at (x, z), interpolated across the same triangles-ish grid the collider uses. Outside the square it clamps to the edge. */
  heightAt(x: number, z: number): number {
    const m = this.n + 1
    const step = this.size / this.n
    const fx = Math.min(this.n - 1e-9, Math.max(0, (x + this.size / 2) / step))
    const fz = Math.min(this.n - 1e-9, Math.max(0, (z + this.size / 2) / step))
    const ix = Math.floor(fx), iz = Math.floor(fz)
    const tx = fx - ix, tz = fz - iz
    const h = this.heights
    const a = h[ix * m + iz], b = h[(ix + 1) * m + iz], c = h[ix * m + iz + 1], d = h[(ix + 1) * m + iz + 1]
    return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz
  }
}
