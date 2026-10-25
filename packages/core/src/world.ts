import type { Mlp } from '@breve/stdlib'
import type { Rng } from './rng'
import type { EntityDef, Params, Scene } from './scene'
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
  /** A small neural network of the given layer sizes: `const brain = ctx.mlp([6, 5, 3])`, then `brain.run(self.weights, inputs)`. */
  mlp(sizes: number[]): Mlp
  /** Make a vector: `vec(1, 0, 0)`. */
  vec(x?: number, y?: number, z?: number): Vec3
}

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
   * Lattices only, instead of `decide`: get each state field as a whole (`{ alive }`) and return the new
   * fields, e.g. `{ alive: alive.zip(alive.neighborSum(), rule) }`. Runs once per tick, not once per cell,
   * so it handles a million cells.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update?(fields: any, params: Params, ctx: Ctx): unknown
  /**
   * Called once for each new entity as it is created: `init({ index, count }, params, ctx)` may return
   * `{ position, velocity, state }` to say where it starts and what it starts as.
   */
  init?(obs: { index: number; count: number }, params: Params, ctx: Ctx): unknown
  /**
   * Called once when an entity crosses the set's `fence`. Do something about it here, usually `self.reset()`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onLeave?(obs: { self: any }, params: Params, ctx: Ctx): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decide?(obs: { self: any; neighbors: any }, params: Params, ctx: Ctx): unknown
}

export interface MetricInput {
  /** Every entity set as a group, by its name in the scene: `sets.Ants.position`, `sets.Patch.food.sum()`. */
  sets?: Record<string, unknown>
  /** Every free agent, as a group: `agents.velocity.average()`. */
  agents?: Agents
  /** Every lattice cell, as a group: `cells.alive.sum()`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cells?: any
  /** Every creature in a physics scene, as a group: `creatures.travelled.average()`. */
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
  /** Every world in the sim, in scene order. */
  worlds(): readonly World[]
  fail(where: string, e: unknown): void
  ctx(): Ctx
}

/** Everything a renderer needs for one frame, as transferable buffers. */
export interface FrameData {
  /** The entity set this frame draws, and its color override. */
  name?: string
  color?: string
  /** Drawing scale for agents. */
  scale?: number
  kind: 'agents' | 'lattice' | 'bodies'
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
  /**
   * 0..1 tint per thing (lattices with a `color` field only). For lattices this holds one value per
   * cell, indexed like `lattice.show`, not one per drawn thing.
   */
  attr: Float32Array | null
  /** Lattices send every cell (1 = drawn), so the renderer can animate cells coming and going. */
  lattice?: { dims: [number, number, number]; spacing: number; show: Uint8Array; fade: number; palette?: string[]; thickness?: number }
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
  snapshot?(): unknown
  restore?(s: unknown): void
  /** Release engine resources (physics worlds live in wasm memory). */
  dispose?(): void
}
