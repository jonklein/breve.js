import { registerPhysicsEngine } from '@breve/core'

// Physics engines other than the built-in Rapier, made available to scenes (`"physics": { "engine": "mujoco" }`). Each is loaded on
// demand: a scene that does not ask for MuJoCo never downloads its 11 MB of wasm.
registerPhysicsEngine('mujoco', () => import('@breve/physics-mujoco').then((m) => m.loadMujoco()))
