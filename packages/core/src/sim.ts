import { handleFor, type Model, type ModelHandle } from './inference'
import { Relations, type RelationsSnapshot } from './relations'
import { Mlp } from '@breve/stdlib'
import { Rng } from './rng'
import { Vec3 } from '@breve/stdlib'
import { AgentWorld } from './agent-world'
import { LatticeWorld } from './lattice-world'
import { RigidWorld } from './rigid-world'
import { NetworkWorld } from './network-world'
import type { PhysicsEngine } from './physics/types'
import { paramValues, stateFields, type EntityDef, type Params, type Scene } from './scene'
import { blend } from './blend'
import type { AskOptions, ModelRequest, ThinkCtx, Controller, Ctx, FrameData, Host, MetricInput, Message, ScriptModule, World } from './world'

/** One entity as an inspector shows it. */
export interface Inspected {
  set: string
  index: number
  kind: 'agent' | 'cell' | 'creature' | 'node'
  row: number
  id: number
  controller: string
  fields: Record<string, number | boolean | string | number[]>
}

export interface SimSnapshot { tick: number; rng: number; worlds: unknown[]; waiting: Message[]; outbox: Message[]; keys: string[]; relations: RelationsSnapshot; /** How long the decision and input logs were, so restoring can cut them back. */ decisions?: number; inputs?: number }

export type { AskOptions, Ctx, Controller, FrameData, Message, MetricInput, ModelRequest, ScriptModule } from './world'

const DT = 1 / 60

/** What one entity set sees of the sim: its own definition and controller, and everything shared. */
interface ThoughtJob {
  set: number
  rows: number[]
  run: () => Promise<{ ok: true; values: unknown[] } | { ok: false }>
}

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
  get relations() { return this.sim.relations }
  worlds(): readonly World[] { return this.sim.worlds }

  /** The controller this set is bound to: the script's `export default`, or the named export given by the set's `type`. */
  controller(): Controller | undefined {
    return this.controllerNamed(this.def.type ?? 'default')
  }

  /** The script export with this name, reported once if it is missing. Backs per-agent choice: a string state field called `controller`. */
  controllerNamed(name: string): Controller | undefined {
    const script = this.sim.script as (ScriptModule & Record<string, unknown>) | null
    if (!script) return undefined
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
  /** Named edge tables between entities (`sim.relations.get('trades_with').add(a, b)`). Part of snapshot, fork and hash. */
  readonly relations = new Relations()
  scene: Scene
  params: Params
  tick = 0
  script: ScriptModule | null = null
  private errors = new Map<string, number>()
  private engine?: PhysicsEngine
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
    this.engine = opts.physics
    if (scene.entities.some((e) => e.body) && !opts.physics) throw new Error('this scene has a physics body: build it with `await Sim.create(scene, script)`')
    scene.entities.forEach((e, i) => {
      const host = new SetHost(this, i)
      const old = opts.from?.worlds[i]
      this.worlds.push(
        e.network ? new NetworkWorld(host, old instanceof NetworkWorld ? old : undefined)
          : e.lattice ? new LatticeWorld(host, old instanceof LatticeWorld && sameGrid(opts.from!.scene.entities[i], e) ? old : undefined)
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
    const same = old.length === scene.entities.length && old.every((e, i) => !!e.lattice === !!scene.entities[i].lattice && !!e.network === !!scene.entities[i].network && !!e.body === !!scene.entities[i].body)
    if (!same) throw new Error('adding, removing or changing the kind of an entity set needs a reset')
    this.scene = scene
    this.params = paramValues(scene)
    for (const w of this.worlds) w.sceneChanged()
  }

  /** Free engine resources. Only physics scenes hold any. */
  dispose(): void {
    for (const w of this.worlds) w.dispose?.()
    for (const m of Object.values(this.models)) void Promise.resolve(m.dispose?.()).catch(() => undefined) // close sockets, free runtimes
  }

  setScript(script: ScriptModule): void {
    this.script = script
    this.errors.clear()
  }

  step(): void {
    if (this.replaying) {
      while (this.replaying.length && this.replaying[0].tick <= this.tick) {
        const d = this.replaying.shift()!
        this.worlds[d.set].setDecision?.(d.row, structuredClone(d.decision))
        this.decisionLog.push({ ...d, decision: structuredClone(d.decision) })
      }
    }
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
    return { tick: this.tick, dt: DT, random: () => this.rng.next(), vec: (x, y, z) => new Vec3(x, y, z), mlp: (sizes) => this.mlp(sizes), relations: this.relations, inbox: this.inbox, input: new Input(this.keys), blend, send: (topic, data) => this.outbox.push({ topic, data: data === undefined ? undefined : structuredClone(data), tick: this.tick }) }
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

  /** Everything one entity holds, for an inspector: its set, kind, controller, and every field by name. */
  inspect(set: number, row: number): Inspected | null {
    const def = this.scene.entities[set]
    const table = this.worlds[set]?.table
    if (!def || !table || row < 0 || row >= table.size) return null
    const kinds = Object.fromEntries(stateFields(def.state).map((f) => [f.name, f]))
    const fields: Inspected['fields'] = {}
    for (const k of Object.keys(table.schema)) {
      const stride = table.strides[k], col = table.cols[k] as unknown as ArrayLike<number | string>
      const f = kinds[k]
      const get = (i: number) => (f?.kind === 'boolean' ? col[i] !== 0 : col[i])
      fields[k] = stride === 1 ? (get(row) as number) : Array.from({ length: Math.min(stride, 64) }, (_, j) => Number(col[row * stride + j]))
    }
    return { set: def.name, index: set, kind: def.lattice ? 'cell' : def.network ? 'node' : def.body ? 'creature' : 'agent', row, id: table.idAt(row), controller: def.type ?? 'default', fields }
  }

  /** Change one value of one entity (an inspector edit). Creatures live in the physics engine, so they cannot be edited yet. */
  poke(set: number, row: number, field: string, value: number | boolean | string, index = 0): void {
    const def = this.scene.entities[set]
    const table = this.worlds[set]?.table
    if (!def || !table || row < 0 || row >= table.size) throw new Error('no such entity')
    if (def.body) throw new Error('creatures cannot be edited yet: their pose lives in the physics engine')
    if (!(field in table.schema)) throw new Error(`there is no field "${field}"`)
    const f = stateFields(def.state).find((x) => x.name === field)
    const col = table.cols[field] as unknown as (number | string)[]
    const at = row * table.strides[field] + index
    if (f?.kind === 'string') col[at] = String(value)
    else if (f?.kind === 'boolean') col[at] = value ? 1 : 0
    else {
      const x = Number(value)
      if (!Number.isFinite(x)) throw new Error(`"${field}" needs a number`)
      col[at] = f?.type === 'i32' ? Math.round(x) : x
    }
  }

  /** The names a set's `type` can take: every export of the script that is a controller. */
  controllerNames(): string[] {
    const isController = (v: unknown) => !!v && typeof v === 'object' && ['decide', 'decideAll', 'update', 'init'].some((k) => typeof (v as Record<string, unknown>)[k] === 'function')
    return Object.entries(this.script ?? {}).filter(([k, v]) => k !== 'metrics' && isController(v)).map(([k]) => k)
  }

  /** How `ctx.ask` reaches a language model. Set by whatever hosts the sim (the workbench's server connection, or a test double). */
  provider: ((prompt: string, options?: ModelRequest) => Promise<string>) | null = null
  /** Every decision a `think` produced, with the tick it took effect. Feed it back with `replay` to rerun without the model. */
  readonly decisionLog: { tick: number; set: number; row: number; decision: unknown }[] = []
  private replaying: { tick: number; set: number; row: number; decision: unknown }[] | null = null
  private thinking = false

  /**
   * The most decisions kept. A model deciding for hundreds of agents every tick would otherwise fill memory; past the limit the
   * oldest are dropped and `decisionLogComplete` turns false, because a log with its start missing cannot replay the run.
   */
  decisionLogLimit = 250_000
  decisionLogComplete = true

  private decide(set: number, row: number, decision: unknown): void {
    this.worlds[set].setDecision?.(row, decision)
    this.decisionLog.push({ tick: this.tick, set, row, decision: structuredClone(decision) })
    if (this.decisionLog.length > this.decisionLogLimit) {
      this.decisionLog.splice(0, this.decisionLog.length - Math.floor(this.decisionLogLimit * 0.9)) // drop a tenth at a time, not one by one
      this.decisionLogComplete = false
    }
  }

  /**
   * Lockstep: run every `think` that is due this tick, wait for all the answers, and apply them (in row order, so the
   * result does not depend on which answer came back first). Call it before `step()`; when nothing is due it returns at once.
   */
  async think(): Promise<void> {
    if (this.replaying) return
    const jobs = this.dueThoughts()
    const results = await Promise.all(jobs.map((j) => j.run()))
    jobs.forEach((j, i) => this.land(j, results[i]))
  }

  /**
   * Realtime: start the due thoughts but do not wait. Each answer is applied (and logged) at whatever tick the sim has reached
   * when it arrives. Thoughts still running are not started again.
   */
  thinkInBackground(): void {
    if (this.replaying || this.thinking) return
    const jobs = this.dueThoughts()
    if (!jobs.length) return
    this.thinking = true
    void Promise.all(jobs.map(async (j) => ({ j, r: await j.run() }))).then((all) => {
      for (const { j, r } of all) this.land(j, r)
    }).finally(() => { this.thinking = false })
  }

  private land(job: ThoughtJob, r: { ok: true; values: unknown[] } | { ok: false }): void {
    if (r.ok) job.rows.forEach((row, k) => this.decide(job.set, row, r.values[k]))
  }

  /** Names of the sets whose controllers have asked a language model: their runs cannot be repeated, only replayed from a log. */
  private asked = new Set<string>()

  /** Trained models by the names the scene gives them (`"models"`). The host loads them (see `@breve/inference`) and puts them here before the run. */
  readonly models: Record<string, Model> = {}

  private modelFor(name: string): ModelHandle {
    const m = this.models[name]
    if (!m) throw new Error(`no model called "${name}" is loaded (the scene declares: ${Object.keys(this.scene.models ?? {}).join(', ') || 'none'}; the host must load them into sim.models)`)
    return handleFor(name, m)
  }

  private dueThoughts(): ThoughtJob[] {
    const jobs: ThoughtJob[] = []
    this.worlds.forEach((w, set) => {
      const ctrl = new SetControllerLookup(this, set).get()
      const due = w.thinkers?.() ?? []
      if (!due.length) return
      const thinkCtx = (): ThinkCtx => {
        const ask = (prompt: string, options?: AskOptions) => (this.asked.add(this.scene.entities[set].name), this.provider ? this.provider(prompt, options && { ...options, images: options.images?.map((p) => p.toBase64()) }) : Promise.reject(new Error('no language model is connected: ctx.ask needs one')))
        return { ...this.ctx(), ask, model: (name: string) => this.modelFor(name) }
      }
      const guarded = (run: () => Promise<unknown[]>) => async () => {
        try {
          return { ok: true as const, values: await run() }
        } catch (e) {
          this.fail('think', e)
          return { ok: false as const }
        }
      }
      if (ctrl?.thinkAll) {
        // one call for the whole set, so a model can take every agent as a single batch
        jobs.push({
          set, rows: due.map((t) => t.row),
          run: guarded(async () => {
            const out = await ctrl.thinkAll!(due.map((t) => t.obs as never), this.params, thinkCtx())
            if (!Array.isArray(out) || out.length !== due.length) throw new Error(`thinkAll must return one decision per entity (${due.length}), got ${Array.isArray(out) ? out.length : typeof out}`)
            return out
          }),
        })
      } else if (ctrl?.think) {
        for (const t of due) jobs.push({ set, rows: [t.row], run: guarded(async () => [await ctrl.think!(t.obs as never, this.params, thinkCtx())]) })
      }
    })
    return jobs
  }

  /** True while a decision log is being replayed: the model is not asked. */
  get isReplaying(): boolean { return this.replaying !== null }

  /** True when some set of this sim has a controller that thinks. */
  get thinks(): boolean { return this.scene.entities.some((e) => e.think) }

  /** Run again from a decision log: the model is never asked, and each decision lands on the tick it did the first time. */
  replay(log: { tick: number; set: number; row: number; decision: unknown }[]): void {
    this.replaying = [...log].sort((a, b) => a.tick - b.tick)
  }

  /** Names of the entity sets whose controller depends on something outside the sim (a person, a model), so forking or replay may not reproduce it. */
  nondeterministic(): string[] {
    const out: string[] = this.replaying ? [] : [...this.asked]
    // a model whose math can differ between runs (a GPU) makes every set that thinks non-repeatable
    if (Object.values(this.models).some((m) => !m.deterministic)) for (const e of this.scene.entities) if (e.think && !out.includes(e.name)) out.push(e.name)
    this.scene.entities.forEach((e, i) => {
      const c = (this.script as Record<string, unknown> | null)?.[e.type ?? 'default'] as Controller | undefined
      if (c?.spec?.nondeterministic && !out.includes(e.name)) out.push(e.name)
      void i
    })
    return out
  }

  private metricInput(): MetricInput {
    const parts = this.worlds.map((w) => w.metricInput())
    const merged: MetricInput = Object.assign({ count: 0, cols: {} }, ...parts)
    const sets: Record<string, unknown> = {}
    this.scene.entities.forEach((e, i) => { sets[e.name] = parts[i].agents ?? parts[i].cells ?? parts[i].nodes ?? parts[i].creatures })
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
   * every few ticks. Physics scenes snapshot the engine's state too.
   */
  snapshot(): SimSnapshot {
    if (this.worlds.some((w) => !w.snapshot)) throw new Error('this kind of world cannot be snapshotted yet ')
    return { tick: this.tick, rng: this.rng.getState(), worlds: this.worlds.map((w) => w.snapshot!()), waiting: structuredClone(this.waiting), outbox: structuredClone(this.outbox), keys: [...this.keys], relations: this.relations.snapshot(), decisions: this.decisionLog.length, inputs: this.inputLog.length }
  }

  /** Go back to a snapshot taken from this sim, or from any sim built from the same scene. */
  restore(s: SimSnapshot): void {
    if (this.worlds.some((w) => !w.restore)) throw new Error('this kind of world cannot be restored yet')
    this.tick = s.tick
    // what was decided or pressed after this moment belongs to a future that no longer happens (the logs only grow, so a length says where to cut)
    if (s.decisions !== undefined) this.decisionLog.length = Math.min(this.decisionLog.length, s.decisions)
    if (s.inputs !== undefined) this.inputLog.length = Math.min(this.inputLog.length, s.inputs)
    this.rng.setState(s.rng)
    this.worlds.forEach((w, i) => w.restore!(s.worlds[i]))
    this.keys = [...s.keys]
    this.relations.restore(s.relations ?? {})
    this.waiting = structuredClone(s.waiting)
    this.outbox = structuredClone(s.outbox)
    this.inbox = []
  }

  /**
   * An independent copy that carries on from this exact moment. Pass an edited scene to ask "what if" from here,
   * for example the same flock with one param changed. The scene must have the same shape (entities, lattice size).
   */
  fork(scene: Scene = this.scene): Sim {
    const copy = new Sim(structuredClone(scene), this.script ?? undefined, { from: this, physics: this.engine })
    copy.restore(this.snapshot())
    return copy
  }

  /** Fingerprint of all state that affects the future: columns plus RNG. */
  hash(): string {
    return `${this.worlds.map((w) => w.hash?.() ?? w.table.hash()).join('+')}:${this.rng.getState().toString(16)}:${this.tick}${this.relations.names().length ? ':' + this.relations.hash() : ''}`
  }
}

/** Finds the controller object a set is bound to (the same rule `SetHost.controller` uses, without its error reporting). */
class SetControllerLookup {
  constructor(private sim: Sim, private set: number) {}
  get(): Controller | undefined {
    const script = this.sim.script as (ScriptModule & Record<string, unknown>) | null
    const c = script?.[this.sim.scene.entities[this.set].type ?? 'default'] as Controller | undefined
    return c && typeof c === 'object' ? c : undefined
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
