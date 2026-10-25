import type { Mlp } from './nn'
import type { Rng } from './rng'
import type { Params, Scene } from './scene'
import type { Table } from './store'
import type { Vec3 } from './vec'
import type { Agents } from './agents'
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
  spec?: { observe?: string[]; act?: string[] }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decide?(obs: { self: any; neighbors: any }, params: Params, ctx: Ctx): unknown
}

export interface MetricInput {
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
  default: Controller
  metrics?: Record<string, (input: MetricInput) => number>
}

/** What the sim shares with the kind of world it contains. */
export interface Host {
  scene: Scene
  params: Params
  rng: Rng
  tick: number
  script: ScriptModule | null
  fail(where: string, e: unknown): void
  ctx(): Ctx
}

/** Everything a renderer needs for one frame, as transferable buffers. */
export interface FrameData {
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
  lattice?: { dims: [number, number, number]; spacing: number; show: Uint8Array; fade: number }
  /** Physics bodies (`kind: 'bodies'`): one pose per part, plus the terrain on the first frame. */
  rigid?: RigidFrame
}

export interface World {
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
