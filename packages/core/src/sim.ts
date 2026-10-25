import { Mlp } from './nn'
import { Rng } from './rng'
import { Vec3 } from './vec'
import { AgentWorld } from './agent-world'
import { LatticeWorld } from './lattice-world'
import { RigidWorld } from './rigid-world'
import type { PhysicsEngine } from './physics/types'
import { paramValues, type Params, type Scene } from './scene'
import type { Ctx, FrameData, Host, Message, ScriptModule, World } from './world'

export interface SimSnapshot { tick: number; rng: number; world: unknown; waiting: Message[]; outbox: Message[] }

export type { Ctx, Controller, FrameData, Message, MetricInput, ScriptModule } from './world'

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

  constructor(scene: Scene, script?: ScriptModule, opts: { physics?: PhysicsEngine; from?: Sim } = {}) {
    this.scene = scene
    this.params = paramValues(scene)
    this.rng = new Rng(scene.seed)
    if (script) this.script = script
    if (scene.entities[0].body && !opts.physics) throw new Error('this scene has a physics body: build it with `await Sim.create(scene, script)`')
    this.world = scene.entities[0].lattice ? new LatticeWorld(this, opts.from?.world instanceof LatticeWorld && sameGrid(opts.from.scene, scene) ? opts.from.world : undefined)
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
    this.inbox = this.waiting
    this.waiting = []
    this.world.step()
    this.tick++
  }

  /** Messages for the script during the current tick, and the ones waiting for the next. */
  private inbox: Message[] = []
  private waiting: Message[] = []
  /** What the script has sent to the parent since the parent last looked. */
  outbox: Message[] = []

  /** Parent side: queue a message to arrive at the start of the next tick. */
  deliver(topic: string, data?: unknown): void {
    this.waiting.push({ topic, data: data === undefined ? undefined : structuredClone(data), tick: this.tick })
  }

  /** Parent side: take everything the script has sent. */
  takeOutbox(): Message[] {
    const out = this.outbox
    this.outbox = []
    return out
  }

  private nets = new Map<string, Mlp>()
  private mlp(sizes: number[]): Mlp {
    const key = sizes.join()
    let net = this.nets.get(key)
    if (!net) this.nets.set(key, (net = new Mlp(sizes)))
    return net
  }

  ctx(): Ctx {
    return { tick: this.tick, dt: DT, random: () => this.rng.next(), vec: (x, y, z) => new Vec3(x, y, z), mlp: (sizes) => this.mlp(sizes), inbox: this.inbox, send: (topic, data) => this.outbox.push({ topic, data: data === undefined ? undefined : structuredClone(data), tick: this.tick }) }
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

  /**
   * A copy of everything that affects the future: the columns, the RNG and the clock. Cheap enough to take
   * every few ticks. Not available yet for physics scenes, whose engine state lives in wasm.
   */
  snapshot(): SimSnapshot {
    if (!this.world.snapshot) throw new Error('this kind of world cannot be snapshotted yet (physics scenes keep their state inside the engine)')
    return { tick: this.tick, rng: this.rng.getState(), world: this.world.snapshot(), waiting: structuredClone(this.waiting), outbox: structuredClone(this.outbox) }
  }

  /** Go back to a snapshot taken from this sim, or from any sim built from the same scene. */
  restore(s: SimSnapshot): void {
    if (!this.world.restore) throw new Error('this kind of world cannot be restored yet')
    this.tick = s.tick
    this.rng.setState(s.rng)
    this.world.restore(s.world)
    this.waiting = structuredClone(s.waiting)
    this.outbox = structuredClone(s.outbox)
    this.inbox = []
  }

  /**
   * An independent copy that carries on from this exact moment. Pass an edited scene to ask "what if" from here,
   * for example the same flock with one param changed. The scene must have the same shape (entities, lattice size).
   */
  fork(scene: Scene = this.scene): Sim {
    const copy = new Sim(structuredClone(scene), this.script ?? undefined, { from: this })
    copy.restore(this.snapshot())
    return copy
  }

  /** Fingerprint of all state that affects the future: columns plus RNG. */
  hash(): string {
    return `${this.world.hash?.() ?? this.table.hash()}:${this.rng.getState().toString(16)}:${this.tick}`
  }
}

/** Forks can share the neighbor tables when the grid is the same shape. */
function sameGrid(a: Scene, b: Scene): boolean {
  const x = a.entities[0].lattice, y = b.entities[0].lattice
  return !!x && !!y && x.size.join() === y.size.join() && x.edges === y.edges && x.neighborhood === y.neighborhood
}
