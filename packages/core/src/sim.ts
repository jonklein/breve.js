import { Rng } from './rng'
import { Vec3 } from './vec'
import { AgentWorld } from './agent-world'
import { LatticeWorld } from './lattice-world'
import { RigidWorld } from './rigid-world'
import type { PhysicsEngine } from './physics/types'
import { paramValues, type Params, type Scene } from './scene'
import type { Ctx, FrameData, Host, ScriptModule, World } from './world'

export type { Ctx, Controller, FrameData, MetricInput, ScriptModule } from './world'

const DT = 1 / 60

/**
 * A simulation: a scene, a script, a seeded RNG, and one world (free agents or a lattice).
 * It owns what every kind of world shares and delegates the stepping.
 */
export class Sim implements Host {
  readonly rng: Rng
  scene: Scene
  params: Params
  tick = 0
  script: ScriptModule | null = null
  private errors = new Map<string, number>()
  private world: World

  /**
   * Build a sim. Scenes with a physics `body` need the physics engine loaded first, which is async,
   * so use `await Sim.create(scene, script)` for any scene; `new Sim` still works for the rest.
   */
  static async create(scene: Scene, script?: ScriptModule): Promise<Sim> {
    const physics = scene.entities[0]?.body ? await (await import('./physics/rapier')).loadRapier() : undefined
    return new Sim(scene, script, { physics })
  }

  constructor(scene: Scene, script?: ScriptModule, opts: { physics?: PhysicsEngine } = {}) {
    this.scene = scene
    this.params = paramValues(scene)
    this.rng = new Rng(scene.seed)
    if (script) this.script = script
    if (scene.entities[0].body && !opts.physics) throw new Error('this scene has a physics body: build it with `await Sim.create(scene, script)`')
    this.world = scene.entities[0].lattice ? new LatticeWorld(this)
      : scene.entities[0].body ? new RigidWorld(this, opts.physics!)
      : new AgentWorld(this)
  }

  get table() {
    return this.world.table
  }

  /** Ticks per second the scene asks for. */
  get rate(): number {
    return this.scene.clock?.rate ?? 60
  }

  /** Apply an edited scene to a running sim. Seed, grid shape and fill only change on reset. */
  setScene(scene: Scene): void {
    this.scene = scene
    this.params = paramValues(scene)
    this.world.sceneChanged()
  }

  /** Free engine resources. Only physics scenes hold any. */
  dispose(): void {
    this.world.dispose?.()
  }

  setScript(script: ScriptModule): void {
    this.script = script
    this.errors.clear()
  }

  step(): void {
    this.world.step()
    this.tick++
  }

  ctx(): Ctx {
    return { tick: this.tick, dt: DT, random: () => this.rng.next(), vec: (x, y, z) => new Vec3(x, y, z) }
  }

  frame(): FrameData {
    return this.world.frame()
  }

  /** Evaluate the metrics the scene declares and the script provides. */
  metrics(): Record<string, number> {
    const out: Record<string, number> = {}
    const fns = this.script?.metrics
    if (!fns) return out
    for (const name of this.scene.metrics ?? []) {
      const fn = fns[name]
      if (!fn) continue
      try {
        const v = fn(this.world.metricInput())
        if (Number.isFinite(v)) out[name] = v
      } catch (e) {
        this.fail(`metric ${name}`, e)
      }
    }
    return out
  }

  /** Runtime errors thrown by the script since the last call, deduplicated. */
  takeErrors(): string[] {
    const out = [...this.errors].map(([m, n]) => (n > 1 ? `${m} (×${n})` : m))
    this.errors.clear()
    return out
  }

  fail(where: string, e: unknown): void {
    const m = `${where}: ${e instanceof Error ? e.message : String(e)}`
    this.errors.set(m, (this.errors.get(m) ?? 0) + 1)
  }

  /** Fingerprint of all state that affects the future: columns plus RNG. */
  hash(): string {
    return `${this.world.hash?.() ?? this.table.hash()}:${this.rng.getState().toString(16)}:${this.tick}`
  }
}
