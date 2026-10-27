import { registerFormulaBackend, registerPhysicsEngine } from '@breve/core'

// Physics engines other than the built-in Rapier, made available to scenes (`"physics": { "engine": "mujoco" }`). Each is loaded on
// demand: a scene that does not ask for MuJoCo never downloads its 11 MB of wasm.
registerPhysicsEngine('mujoco', () => import('@breve/physics-mujoco').then((m) => m.loadMujoco()))

// Lattices written as formulas keep their cells on the graphics card where WebGPU is available (it resolves to null where it is not, and
// the scene runs on the processor instead).
registerFormulaBackend(() => import('@breve/gpu').then((m) => m.loadWebGpu()))
