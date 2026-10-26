import { registerPhysicsEngine } from '@breve/core'
import { loadMujoco } from './engine'

export { loadMujoco } from './engine'
export { buildMjcf, TUNING, type Mjcf, type MjcfOptions } from './mjcf'

/**
 * Make `"physics": { "engine": "mujoco" }` work in scenes. Call once at start-up, before building a sim. Nothing is loaded until a scene
 * actually asks for it (the 11 MB wasm compiles then).
 */
export function registerMujoco(): void {
  registerPhysicsEngine('mujoco', loadMujoco)
}
