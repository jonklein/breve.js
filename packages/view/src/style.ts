import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

export interface SetStyleInput {
  shape?: string
  trail?: number | { length?: number; strength?: number }
  material?: { roughness?: number; metalness?: number; glow?: number; opacity?: number }
}

/** What a set of things is drawn as when the scene does not say. */
export type Fallback = 'cone' | 'cube' | 'sphere'

/**
 * The shape for one entity set. Agents point along +z (the way they move), so elongated shapes are turned to lie along it.
 * Sizes are chosen so every shape has about the same visual weight as the default cone.
 */
export function shapeGeometry(shape: string | undefined, fallback: Fallback): THREE.BufferGeometry {
  const kind = shape ?? fallback
  switch (kind) {
    case 'sphere': return new THREE.SphereGeometry(0.45, 28, 18)
    case 'cube': return fallback === 'cube' ? new THREE.BoxGeometry(1, 1, 1) : new RoundedBoxGeometry(0.75, 0.75, 0.75, 4, 0.14)
    case 'rounded': return fallback === 'cube' ? new RoundedBoxGeometry(1, 1, 1, 4, 0.16) : new RoundedBoxGeometry(0.75, 0.75, 0.75, 4, 0.14)
    case 'capsule': { const g = new THREE.CapsuleGeometry(0.22, 0.75, 8, 18); g.rotateX(Math.PI / 2); return g }
    case 'octahedron': return new THREE.OctahedronGeometry(0.55)
    case 'tetrahedron': return new THREE.TetrahedronGeometry(0.6)
    case 'disc': { const g = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 36); g.rotateX(Math.PI / 2); return g }
    case 'cylinder': { const g = new THREE.CylinderGeometry(0.25, 0.25, 1, 24); g.rotateX(Math.PI / 2); return g }
    default: { const g = new THREE.ConeGeometry(0.32, 1.3, 24, 1); g.rotateX(Math.PI / 2); return g }
  }
}

/** Apply a set's `material` settings to its material. `glow` and `opacity` live in uniforms the alpha material reads. */
export function applyMaterial(mat: THREE.MeshStandardMaterial, style: SetStyleInput | undefined): void {
  const m = style?.material ?? {}
  mat.roughness = m.roughness ?? 0.7
  mat.metalness = m.metalness ?? 0
  const u = mat.userData as { glow?: { value: number }; baseAlpha?: { value: number } }
  if (u.glow) u.glow.value = m.glow ?? 0
  if (u.baseAlpha) u.baseAlpha.value = m.opacity ?? 1
  mat.needsUpdate = true
}
