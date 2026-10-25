import type { ShapeKind } from './body'

/** What the renderer needs to draw one part of a creature, the same for every creature. */
export interface PartShape {
  shape: ShapeKind
  size: number[]
  color?: string
}

export interface TerrainMesh {
  size: number
  n: number
  /** `heights[ix * (n + 1) + iz]`, see Terrain. */
  heights: Float32Array
  color?: string
  texture?: 'static' | 'grid' | 'none'
}

/**
 * Frame data for physics bodies. `poses` has 7 numbers per part per creature
 * (x, y, z, qx, qy, qz, qw), creature by creature. `model` is the unchanging part:
 * it is only present on the first frame after a world is built, so the renderer keeps the last one.
 */
export interface RigidFrame {
  partCount: number
  poses: Float32Array
  model?: { parts: PartShape[]; terrain: TerrainMesh | null }
}
