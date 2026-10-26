import type { PhysicsEngine } from './types'

/** How an engine is loaded. Async because engines compile wasm; called at most once per engine. */
export type EngineLoader = () => Promise<PhysicsEngine>

const loaders = new Map<string, EngineLoader>()
const loaded = new Map<string, Promise<PhysicsEngine>>()

/** The engine scenes get when they do not ask for one. */
export const DEFAULT_ENGINE = 'rapier'

/**
 * Make an engine available to scenes under a name: `"physics": { "engine": "mujoco" }`. The core ships only Rapier; any other engine lives
 * in its own package and is registered by the host (the workbench, a script, a test), so the core never imports it and a host that never
 * registers one never loads it.
 */
export function registerPhysicsEngine(name: string, loader: EngineLoader): void {
  loaders.set(name, loader)
  loaded.delete(name)
}

/** The names a scene may use for `physics.engine`. */
export function physicsEngineNames(): string[] {
  return [...loaders.keys()]
}

/** Load (once) the engine a scene asks for. */
export function loadPhysicsEngine(name: string = DEFAULT_ENGINE): Promise<PhysicsEngine> {
  const load = loaders.get(name)
  if (!load) throw new Error(`physics.engine: no engine called "${name}" is registered (available: ${physicsEngineNames().join(', ') || 'none'}). An engine other than rapier comes from its own package: register it with registerPhysicsEngine before building the sim.`)
  let p = loaded.get(name)
  if (!p) loaded.set(name, (p = load()))
  return p
}

registerPhysicsEngine(DEFAULT_ENGINE, async () => (await import('./rapier')).loadRapier())
