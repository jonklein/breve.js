import type { Picture } from './image'
import type { ModelHandle } from './inference'
import type { Relations } from './relations'
import type { Bounds, Colors, Gait, Mlp } from '@breve/stdlib'
import type { Look } from './display'
import type { Rng } from './rng'
import type { EntityDef, Params, Scene, StateField } from './scene'
import type { Table } from './store'
import type { Vec3 } from '@breve/stdlib'
import type { Agents } from '@breve/stdlib'
import type { RigidFrame } from './rigid-frame'

/** A message between a sim and its parent. */
export interface Message {
  topic: string
  data?: unknown
  /** The sim's tick when it was sent (or when the parent sent it). */
  tick: number
}

export interface Ctx {
  tick: number
  dt: number
  /** Seeded randomness. Scripts must use this, never Math.random. */
  random(): number
  /** A seeded draw from a normal distribution (mean 0, spread 1): `0.7 * ctx.normal()` for a spread of 0.7. */
  normal(): number
  /**
   * Merge what several behaviors returned into one result: steering adds up, `add` amounts add up, `state` and
   * `joints` are combined (later ones win on the same name). Write each behavior as a plain function, then
   * `return ctx.blend(graze(obs, p, ctx), flee(obs, p, ctx))`.
   */
  blend(...results: unknown[]): unknown
  /** The keys a person is holding: `ctx.input.pressed('w')`. For human-driven controllers; mark them `spec: { nondeterministic: true }`. */
  readonly input: { pressed(key: string): boolean; readonly keys: readonly string[] }
  /** Messages the parent sent to this sim since the last tick, oldest first. Read-only; the same list for every agent in a tick. */
  readonly inbox: readonly Message[]
  /** Tell the parent something. Sims never talk to each other: the parent decides what, if anything, to pass on. `data` must be plain JSON. */
  send(topic: string, data?: unknown): void
  /**
   * The sim's relations: named, directed, attributed edges between entity ids (`self.id`). A sensor with
   * `via: "follows"` hands a controller the agents it points at. Edits made while deciding are seen by agents
   * decided later in the same tick (in row order), so write to a relation from a rule or an `onStep`, not
   * from many agents at once, if that matters.
   */
  readonly relations: Relations
  /** Colors for `display`: `ctx.colors.gradient(['#4f86f7', '#7be495'], age / 20)`, `ctx.colors.hsl(h, s, l)`, `ctx.colors.hex('#48f')`, and `ctx.colors.gradientField(stops, field)` for `displayAll`. */
  readonly colors: typeof Colors
  /** Rhythmic joint targets for creatures: `ctx.gait.targets({ 'FL.hip': { amplitude: 0.7 } }, cycle)` and `ctx.gait.advance(cycle, frequency, ctx.dt)`. */
  readonly gait: typeof Gait
  /** Keeping entities inside the world, for scripts that want it: `ctx.bounds.soft(self.position, ctx.world.size)` and `ctx.bounds.bounce(...)`. */
  readonly bounds: typeof Bounds
  /** The world's size: `size` is the half-width of the box around the origin (the scene's `bounds.size`). */
  readonly world: { readonly size: number }
  /** The scene's `data`: structured, fixed input that is not a slider (a genome, a list of weights). Read-only. */
  readonly data: Readonly<Record<string, unknown>>
  /** A small neural network of the given layer sizes: `const brain = ctx.mlp([6, 5, 3])`, then `brain.run(self.weights, inputs)`. */
  mlp(sizes: number[]): Mlp
  /** Make a vector: `vec(1, 0, 0)`. */
  vec(x?: number, y?: number, z?: number): Vec3
}

/** What a model can be asked besides the question. */
export interface AskOptions {
  /** Ask for a JSON answer. */
  json?: boolean
  /** Pictures to show a vision model, such as an agent's camera sensor (`obs.view`). */
  images?: Picture[]
}

/** What reaches the model host: the same, with pictures as base64 PNG text. */
export interface ModelRequest {
  json?: boolean
  images?: string[]
}

/** What `think` gets: everything in `ctx`, plus a way to ask a model. */
export interface ThinkCtx extends Ctx {
  /** A trained model the scene declares under `models` (and the host loaded): `const out = await ctx.model('policy').run(obs)`. */
  model(name: string): ModelHandle
  /** Ask a language model. Resolves to its text reply; rejects when no model is connected. */
  ask(prompt: string, options?: AskOptions): Promise<string>
}

/** Names that make an exported object a controller. */
export const HOOKS = ['init', 'initAll', 'initFormula', 'act', 'actAll', 'actFormula', 'think', 'thinkAll', 'display', 'displayAll', 'displayFormula'] as const

export interface Controller {
  spec?: {
    observe?: string[]
    act?: string[]
    /** The controller depends on something outside the sim (a person at the keyboard, a model): forks and replays may not reproduce it. */
    nondeterministic?: boolean
  }
  /**
   * Free agents get `{ self, neighbors }` and return `{ steer }`.
   * Lattice cells get `{ self, neighbors }` and return their new state, e.g. `{ alive: 1 }`.
   * Creatures (scenes with a `body`) get `{ self, neighbors }` and may return `{ joints: { 'FL.hip': 0.3 } }`: target angles by joint name.
   */
  /**
   * Lattices and networks, instead of `act`: get each state field as a whole (`{ alive }`) and return the new
   * fields, e.g. `{ alive: alive.zip(alive.neighborSum(), rule) }`. Runs once per tick, not once per cell,
   * so it handles a million cells.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actAll?(fields: any, params: Params, ctx: Ctx): unknown
  /**
   * Called once for each new entity as it is created: `init({ index, count }, params, ctx)` returns what it starts as. The plain
   * keys are its state (`return { alive: 1, age: 0 }`), and a field that `init` returns exists, with its kind and length taken
   * from the value, so the scene needs no `state` block. Free agents may also return `position` and `velocity`. Lattice cells
   * also get their grid position as `x`, `y`, `z` and their place in the world as `at` (a vector). The older `{ state: { ... } }` form still works.
   */
  init?(obs: { index: number; count: number; x?: number; y?: number; z?: number; at?: Vec3 }, params: Params, ctx: Ctx): unknown
  /**
   * The whole-set form of `init`, for big grids and networks: `initAll({ count }, params, ctx)` returns one array (or field)
   * per state field, `count` long, for every entity at once: `return { alive: Float32Array.from({ length: count }, () => ctx.random() < p.density ? 1 : 0) }`.
   * Single numbers (or booleans, or text) per entity only; it cannot place agents.
   */
  initAll?(obs: { count: number; probe?: boolean }, params: Params, ctx: Ctx): unknown
  /**
   * A slow, asynchronous step for each entity, every `think.every` ticks: look around, maybe ask a language model
   * (`await ctx.ask('...')`), and return what it decided as state: `return { goal: 'go east' }` writes the field `goal` (one that
   * `init` returns), and the fast `act` reads it as `self.goal`. A result that is not state (or names a field `init` does not return) is an error.
   * Every answer is logged with the tick it took effect, so a run can be replayed without asking again.
   */
  think?(obs: { self: any; neighbors: any }, params: Params, ctx: ThinkCtx): Promise<unknown>
  /**
   * Like `think`, but one call for every entity of the set that is due, so a model can run them as one batch
   * (`ctx.model('policy').runBatch(...)`). Return one decision per entity, in the same order. Each decision is logged and
   * written to state exactly like `think`'s, so replaying a log needs neither the model nor its runtime.
   */
  thinkAll?(obs: { self: any; neighbors: any }[], params: Params, ctx: ThinkCtx): Promise<unknown[]>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  act?(obs: { self: any; neighbors: any }, params: Params, ctx: Ctx): unknown
  /**
   * How one entity looks: `display({ self }, params, ctx)` returns `{ color, visible }`, for example
   * `{ visible: self.alive, color: ctx.colors.gradient(['#4f86f7', '#7be495'], self.age / 20) }`. It only reads state, never changes
   * anything, so it cannot affect the simulation, forks or replays; it runs when a frame is drawn, not every tick. Free agents and
   * network nodes use `color` (a `visible` of false is only honored on lattice cells). Where it returns nothing, the scene's own
   * look settings apply.
   */
  display?(obs: { self: any }, params: Params, ctx: Ctx): Look | void
  /**
   * The whole-set form of `display`, for big grids and networks: `displayAll(fields, params, ctx)` gets the state fields as `Field`s
   * (like `actAll`) and returns `{ visible, color }` made of fields, for example
   * `{ visible: alive, color: ctx.colors.gradientField(['#4f86f7', '#7be495'], age.div(20)) }`.
   */
  displayAll?(fields: any, params: Params, ctx: Ctx): unknown
  /**
   * Lattices: a rule written ONCE as an expression instead of run for every cell. `actFormula(fields, params, k)` is called a
   * single time; its fields are expressions (use `a.add(b)`, `a.eq(3)`, `c.where(x, y)`, `a.neighborSum()`, not operators), and what it returns
   * says how to compute the new state of every cell: `({ alive }) => { const n = alive.neighborSum(); return { alive: n.eq(3).or(alive.and(n.eq(2))) } }`.
   * `k.hash('name')` is a random number per cell and tick, `k.x`, `k.y`, `k.z`, `k.index` and `k.tick` say where and when. Because it
   * is a program and not a loop, it can run on a graphics card where there is one, and gives the same cells either way.
   * `initFormula(fields, params, k)` says what the cells start as (it gets no fields: `({}, p, k) => ({ alive: k.hash().lt(p.density) })`),
   * and `displayFormula` returns `{ visible, r, g, b }` (colors 0 to 1) the same way.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actFormula?: (fields: any, params: any, k: any) => unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initFormula?: (fields: any, params: any, k: any) => unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  displayFormula?: (fields: any, params: any, k: any) => unknown
}

export interface MetricInput {
  /** Every entity set as a group, by its name in the scene: `sets.Ants.position`, `sets.Patch.food.sum()`. */
  sets?: Record<string, unknown>
  /** Every free agent, as a group: `agents.velocity.average()`. */
  agents?: Agents
  /** Every lattice cell, as a group: `cells.alive.sum()`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cells?: any
  /** Every node of a network, as a group: `nodes.status.sum()`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes?: any
  /** Every creature in a physics scene, as a group: `creatures.speed.average()`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  creatures?: any
  count: number
  cols: Record<string, ArrayLike<number>>
}

export interface ScriptModule {
  /** The controller for any entity set whose `type` is not given. */
  default?: Controller
  metrics?: Record<string, (input: MetricInput) => number>
  /** Named controllers, picked by an entity set's `type`. */
  [kind: string]: unknown
}

/** What the sim shares with the kind of world it contains. */
export interface Host {
  /** The set's state fields: what its script's `init` returns. */
  fields: StateField[]
  scene: Scene
  params: Params
  rng: Rng
  tick: number
  script: ScriptModule | null
  /** The entity set this world draws its rules from. */
  def: EntityDef
  index: number
  /** The controller this set is bound to (its `type`, or the script's default), or undefined if there is none. */
  controller(): Controller | undefined
  /** A script export by name, for sets whose agents each pick their own (a string state field called `controller`). */
  controllerNamed(name: string): Controller | undefined
  /** Every world in the sim, in scene order. */
  worlds(): readonly World[]
  fail(where: string, e: unknown): void
  ctx(): Ctx
  /** The sim's named edge tables. */
  relations: Relations
}

/** Everything a renderer needs for one frame, as transferable buffers. */
export interface FrameData {
  /** The look of each agent or node, from the script's `display` (null entries mean the script said nothing). */
  look?: { rgb: Uint8Array | null; visible: Uint8Array | null; alpha: Uint8Array | null; scale: Float32Array | null }
  /** The entity set this frame draws, and its color override. */
  name?: string
  color?: string
  /** Drawing scale for agents. */
  scale?: number
  /** The set's `style` (shape and material). */
  style?: import('./scene').SetStyle
  kind: 'agents' | 'lattice' | 'bodies' | 'graph'
  /** Number of things to draw. */
  count: number
  /** Half the width of the world's bounding box. */
  size: number
  /** Edge length for a drawn cell. */
  unit: number
  /** xyz per thing. */
  pos: Float32Array
  /** xyz heading per thing (agents only). */
  vel: Float32Array | null
  /** Lattices send every cell (1 = drawn), so the renderer can animate cells coming and going. */
  lattice?: { dims: [number, number, number]; spacing: number; show: Uint8Array; fade: number; thickness?: number; /** from `display`: red, green, blue (0 to 255), opacity (0 to 255) and a size multiplier per cell */ rgb?: Uint8Array; alpha?: Uint8Array; sizes?: Float32Array }
  /** Networks (`kind: 'graph'`): the links as pairs of node numbers (redrawn when `version` changes), and how to color and size nodes. `pos` holds the layout. */
  graph?: { edges: Uint32Array; version: number; nodeSize: number }
  /** Physics bodies (`kind: 'bodies'`): one pose per part, plus the terrain on the first frame. */
  rigid?: RigidFrame
}

/** A layer of cells that agents can stand on: they read the cell under them and add to its fields. */
export interface PatchLayer {
  /** The cell at a point in world space, or null outside the grid. */
  patchAt(x: number, y: number, z: number): unknown | null
  /** Queue `delta` for each named field of the cell at that point; lands at the start of the layer's next step. */
  addAt(x: number, y: number, z: number, delta: Record<string, number>): void
  readonly name: string
}

export interface World {
  /** Set when this world is a lattice that agents can read and add to. */
  readonly patches?: PatchLayer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table: Table<any>
  step(): void
  sceneChanged(): void
  frame(): FrameData
  metricInput(): MetricInput
  /** A fingerprint of everything that affects the future, when the columns alone do not cover it (physics engines). */
  hash?(): string
  /** Copy all state that affects the future (worlds that cannot yet do this leave it out). */
  /** Entities due for a slow `think` this tick (agents only). */
  thinkers?(): { row: number; obs: { self: unknown; neighbors: unknown } }[]
  setDecision?(row: number, decision: unknown): void
  snapshot?(): unknown
  restore?(s: unknown): void
  /** Release engine resources (physics worlds live in wasm memory). */
  dispose?(): void
}
