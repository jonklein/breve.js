import { Defaults } from '@breve/stdlib'

/** Every physics setting, filled in: what the scene says, else the stdlib's `Defaults.physics`. Engines get this, never bare `undefined`s. */
export interface PhysicsSettings {
  gravity: number
  substeps: number
  collide: boolean
  minGyration: number
  linearDamping: number
  angularDamping: number
  /** Friction of the ground. */
  friction: number
  restitution: number
  solverIterations: number
  sleep: boolean
}

export function resolvePhysics(p: Partial<PhysicsSettings> | undefined): PhysicsSettings {
  const d = Defaults.physics
  return {
    gravity: p?.gravity ?? d.gravity,
    substeps: Math.max(1, Math.round(p?.substeps ?? d.substeps)),
    collide: p?.collide ?? d.collide,
    minGyration: p?.minGyration ?? d.minGyration,
    linearDamping: p?.linearDamping ?? d.linearDamping,
    angularDamping: p?.angularDamping ?? d.angularDamping,
    friction: p?.friction ?? d.friction,
    restitution: p?.restitution ?? d.restitution,
    solverIterations: Math.max(1, Math.round(p?.solverIterations ?? d.solverIterations)),
    sleep: p?.sleep ?? d.sleep,
  }
}
