import * as THREE from 'three'

/**
 * A lit, physically based material whose instances can each have their own opacity (an `instanceAlpha` attribute, 0 to 1).
 * It only blends when `blend(true)` says some instance is see-through, so the common case keeps depth writes and sorting-free drawing.
 */
export function alphaMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 })
  const glow = { value: 0 }, baseAlpha = { value: 1 }
  m.userData.glow = glow
  m.userData.baseAlpha = baseAlpha
  m.onBeforeCompile = (shader) => {
    shader.uniforms.glow = glow
    shader.uniforms.baseAlpha = baseAlpha
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceAlpha = instanceAlpha;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vInstanceAlpha;\nuniform float glow;\nuniform float baseAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInstanceAlpha * baseAlpha;')
      // a glowing thing lights itself with its own color, so it stays bright in shadow and in the dark
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * glow;')
  }
  return m
}

/** Give an instanced mesh an opacity per instance (all 1 to start). */
export function withAlpha(mesh: THREE.InstancedMesh, capacity: number): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1)
  mesh.geometry.setAttribute('instanceAlpha', a)
  return a
}

/** Switch blending on only when something is see-through. */
export function blend(mat: THREE.Material, on: boolean): void {
  // a set that is see-through everywhere (`material.opacity` below 1) always blends
  const base = (mat.userData as { baseAlpha?: { value: number } }).baseAlpha?.value ?? 1
  on = on || base < 1
  if (mat.transparent === on) return
  mat.transparent = on
  mat.depthWrite = !on
  mat.needsUpdate = true
}
