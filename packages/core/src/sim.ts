import { Mlp } from '@breve/stdlib'
import { Rng } from './rng'
import { Vec3 } from '@breve/stdlib'
import { AgentWorld } from './agent-world'
import { LatticeWorld } from './lattice-world'
import { RigidWorld } from './rigid-world'
import type { PhysicsEngine } from './physics/types'
import { paramValues, type EntityDef, type Params, type Scene } from './scene'
import { blend } from './blend'
import type { Controller, Ctx, FrameData, Host, MetricInput, Message, ScriptModule, World } from './world'

export interface SimSnapshot { tick: number; rng: number; worlds: unknown[]; waiting: Message[]; outbox: Message[]; keys: string[] }

export type { Ctx, Controller, FrameData, Message, MetricInput, ScriptModule } from './world'

const DT = 1 / 60

/** What one entity set sees of the sim: its own definition and controller, and everything shared. */
class SetHost implements Host {
  private warned = new Set<string>()
  constructor(private sim: Sim, readonly index: number) {}
  get scene() { return this.sim.scene }
  get params() { return this.sim.params }
  get rng() { return this.sim.rng }
  get tick() { return this.sim.tick }
  get script() { return this.sim.script }
  get def(): EntityDef { return this.sim.scene.entities[this.index] }
  fail(where: string, e: unknown) { this.sim.fail(where, e) }
  ctx() { return this.sim.ctx() }
  worlds(): readonly World[] { return this.sim.worlds }

  /** The controller this set is bound to: the script's `export default`, or the named export given by the set's `type`. */
  controller(): Controller | undefined {
    const script = this.sim.script as (ScriptModule & Record<string, unknown>) | null
    if (!script) return undefined
    const name = this.def.type ?? 'default'
    const c = script[name] as Controller | undefined
    if (c && typeof c === 'object') return c
    const msg = name === 'default'
      ? `the script has no "export default" for "${this.def.name}" (give the set a "type" to use a named export)`
      : `the script has no export named "${name}" (the "type" of "${this.def.name}")`
    if (!this.warned.has(msg)) { this.warned.add(msg); this.fail('controller', new Error(msg)) }
    return undefined
  }
}

/**
 * A simulation: a scene, a script, a seeded RNG, and one world per entity set (free agents, a lattice, creatures).
 * It owns what every world shares and delegates the stepping.
 */
export class Sim {
  readonly rng: Rng
  scene: Scene
  params: Params
  tick = 0
  script: ScriptModule | null = null
  private errors = new Map<string, number>()
  readonly worlds: World[] = []
  /** Keys held down right now, for human-driven controllers. Set with `setInput`. */
  private keys: string[] = []
  /** Every change to the input, so a run that a person drove can be replayed. */
  readonly inputLog: { tick: number; keys: string[] }[] = []

  /**
   * Build a sim. Scenes with a physics `body` need the physics engine loaded first, which is async,
   * so use `await Sim.create(scene, script)` for any scene; `new Sim` still works for the rest.
   */
  static async create(scene: Scene, script?: ScriptModule): Promise<Sim> {
    const physics = scene.entities.some((e) => e.body) ? await (await import('./physics/rapier')).loadRapier() : undefined
    return new Sim(scene, script, { physics })
  }

  constructor(scene: Scene, script?: ScriptModule, opts: { physics?: PhysicsEngine; from?: Sim } = {}) {
    this.scene = scene
    this.params = paramValues(scene)
    this.rng = new Rng(scene.seed)
    if (script) this.script = script
    if (scene.entities.some((e) => e.body) && !opts.physics) throw new Error('this scene has a physics body: build it with `await Sim.create(scene, script)`')
    scene.entities.forEach((e, i) => {
      const host = new SetHost(this, i)
      const old = opts.from?.worlds[i]
      this.worlds.push(
        e.lattice ? new LatticeWorld(host, old instanceof LatticeWorld && sameGrid(opts.from!.scene.entities[i], e) ? old : undefined)
          : e.body ? new RigidWorld(host, opts.physics!)
          : new AgentWorld(host),
      )
    })
  }

  /** The first entity set's table (the only one in most scenes). */
  get table() {
    return this.worlds[0].table
  }

  /** One entity set's table, by the name it has in the scene. */
  tableOf(name: string) {
    const i = this.scene.entities.findIndex((e) => e.name === name)
    if (i < 0) throw new Error(`no entity set called "${name}" (the scene has: ${this.scene.entities.map((e) => e.name).join(', ')})`)
    return this.worlds[i].table
  }

  /** Ticks per second the scene asks for. */
  get rate(): number {
    return this.scene.clock?.rate ?? 60
  }

  /** Apply an edited scene to a running sim. Seed, grid shape and fill only change on reset. */
  setScene(scene: Scene): void {
    const old = this.scene.entities
    const same = old.length === scene.entities.length && old.every((e, i) => !!e.lattice === !!scene.entities[i].lattice && !!e.body === !!scene.entities[i].body)
    if (!same) throw new Error('adding, removing or changing the kind of an entity set needs a reset')
    this.scene = scene
    this.params = paramValues(scene)
    for (const w of this.worlds) w.sceneChanged()
  }

  /** Free engine resources. Only physics scenes hold any. */
  dispose(): void {
    for (const w of this.worlds) w.dispose?.()
  }

  setScript(script: ScriptModule): void {
    this.script = script
    this.errors.clear()
  }

  step(): void {
    this.inbox = this.waiting
    this.waiting = []
    this.worlds.forEach((w, i) => {
      // `every: n` runs a set on every n-th tick, so slow things (a pheromone layer) need not run at full rate
      if (this.tick % Math.max(1, this.scene.entities[i].every ?? 1) === 0) w.step()
    })
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
    return { tick: this.tick, dt: DT, random: () => this.rng.next(), vec: (x, y, z) => new Vec3(x, y, z), mlp: (sizes) => this.mlp(sizes), inbox: this.inbox, input: new Input(this.keys), blend, send: (topic, data) => this.outbox.push({ topic, data: data === undefined ? undefined : structuredClone(data), tick: this.tick }) }
  }

  /** What to draw for each entity set, in scene order. */
  frames(): FrameData[] {
    return this.worlds.map((w, i) => ({ ...w.frame(), name: this.scene.entities[i].name, color: this.scene.entities[i].color, scale: this.scene.entities[i].size }))
  }

  /** The first set's frame, for scenes that have only one. */
  frame(): FrameData {
    return this.frames()[0]
  }

  /** Set which keys are held down (people drive controllers through this). The change is logged for replay. */
  setInput(keys: string[]): void {
    const next = [...keys].sort()
    if (next.join() === this.keys.join()) return
    this.keys = next
    this.inputLog.push({ tick: this.tick, keys: next })
  }

  /** Names of the entity sets whose controller depends on something outside the sim (a person, a model), so forking or replay may not reproduce it. */
  nondeterministic(): string[] {
    const out: string[] = []
    this.scene.entities.forEach((e, i) => {
      const c = (this.script as Record<string, unknown> | null)?.[e.type ?? 'default'] as Controller | undefined
      if (c?.spec?.nondeterministic) out.push(e.name)
      void i
    })
    return out
  }

  private metricInput(): MetricInput {
    const parts = this.worlds.map((w) => w.metricInput())
    const merged: MetricInput = Object.assign({ count: 0, cols: {} }, ...parts)
    const sets: Record<string, unknown> = {}
    this.scene.entities.forEach((e, i) => { sets[e.name] = parts[i].agents ?? parts[i].cells ?? parts[i].creatures })
    merged.sets = sets
    return merged
  }

  /** Evaluate the metrics the scene declares and the script provides. */
  metrics(): Record<string, number> {
    const out: Record<string, number> = {}
    const fns = this.script?.metrics
    if (!fns) return out
    let input: MetricInput | undefined
    for (const name of this.scene.metrics ?? []) {
      const fn = fns[name]
      if (!fn) continue
      try {
        const v = fn(input ??= this.metricInput())
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
    if (this.worlds.some((w) => !w.snapshot)) throw new Error('this kind of world cannot be snapshotted yet (physics scenes keep their state inside the engine)')
    return { tick: this.tick, rng: this.rng.getState(), worlds: this.worlds.map((w) => w.snapshot!()), waiting: structuredClone(this.waiting), outbox: structuredClone(this.outbox), keys: [...this.keys] }
  }

  /** Go back to a snapshot taken from this sim, or from any sim built from the same scene. */
  restore(s: SimSnapshot): void {
    if (this.worlds.some((w) => !w.restore)) throw new Error('this kind of world cannot be restored yet')
    this.tick = s.tick
    this.rng.setState(s.rng)
    this.worlds.forEach((w, i) => w.restore!(s.worlds[i]))
    this.keys = [...s.keys]
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
    return `${this.worlds.map((w) => w.hash?.() ?? w.table.hash()).join('+')}:${this.rng.getState().toString(16)}:${this.tick}`
  }
}

/** Forks can share the neighbor tables when the grid is the same shape. */
function sameGrid(x: EntityDef, y: EntityDef): boolean {
  return !!x.lattice && !!y.lattice && x.lattice.size.join() === y.lattice.size.join() && x.lattice.edges === y.lattice.edges && x.lattice.neighborhood === y.lattice.neighborhood
}

/** What `ctx.input` is: the keys a person is holding, as a question you can ask. */
class Input {
  constructor(private held: readonly string[]) {}
  /** `ctx.input.pressed('w')` is true while W is held. Keys are lower-case names like 'w', 'arrowup', ' '. */
  pressed(key: string): boolean { return this.held.includes(key.toLowerCase()) }
  get keys(): readonly string[] { return this.held }
}
