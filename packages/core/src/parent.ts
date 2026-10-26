import { SimGroup } from './group'
import { Rng } from './rng'
import { Sim } from './sim'
import { paramValues, type Params, type Scene } from './scene'
import type { ScriptModule } from './world'

/** What a parent program works with: its group of sub-sims, and the means to make more of them. */
export interface ParentHost {
  /** The sub-sims. A parent may read their metrics, send them messages and read what they sent up. */
  readonly group: SimGroup
  /** The project's scene: the template sub-sims are made from (copy it, change it, `add` it). */
  readonly scene: Scene
  /** Its params, as they are now (sliders change them live). */
  readonly params: Params
  /** Ticks the group has run so far. */
  readonly tick: number
  /** Seeded from the scene's seed, so a parent that searches is repeatable. */
  random(): number
  /** A seeded draw from a normal distribution (mean 0, spread 1). */
  normal(): number
  /** Start a sub-sim from a scene (usually a changed copy of `host.scene`). The scene's script is the project's script. */
  add(name: string, scene: Scene): Promise<Sim>
  /** Stop and discard a sub-sim. */
  remove(name: string): void
}

/**
 * A program that runs many sims and decides what to run next: a population that evolves, an island model, a hand-written search.
 * A project script exports one as `parent`. It never touches the sims' state; it makes them from scenes, reads their metrics and
 * messages, and makes new ones. Evolution is written here, in the example, not in the core.
 */
export interface Parent {
  /** Once, to add the first sub-sims. */
  init(host: ParentHost): void | Promise<void>
  /** After every tick of the group (so a generation can end, and the next begin). */
  step?(host: ParentHost): void | Promise<void>
  /** A line about progress, such as `generation 4 · best 12.3`, for the host to show. */
  status?(host: ParentHost): string
}

const SALT = 0x51ed270b

/** Runs a `Parent` over a group of sub-sims. The workbench and the headless runner both drive this. */
export class ParentRun implements ParentHost {
  readonly group = new SimGroup()
  params: Params
  tick = 0
  /** True while the parent is replacing sims (between `remove` and the end of its step), so a view should wait rather than draw half a generation. */
  mutating = false
  private rng: Rng

  constructor(readonly parent: Parent, public scene: Scene, private script?: ScriptModule) {
    this.params = paramValues(scene)
    this.rng = new Rng(scene.seed ^ SALT)
  }

  /** The project's scene was edited: later sub-sims use it, and the parent sees the new params at once. Running sub-sims keep their own scenes. */
  setScene(scene: Scene): void {
    this.scene = scene
    this.params = paramValues(scene)
  }

  random(): number { return this.rng.next() }

  normal(): number {
    const u = 1 - this.rng.next(), v = this.rng.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  async add(name: string, scene: Scene): Promise<Sim> {
    this.mutating = true
    return this.group.add(name, await Sim.create(scene, this.script))
  }

  remove(name: string): void {
    this.mutating = true
    this.group.remove(name)
  }

  async start(): Promise<void> {
    try { await this.parent.init(this) } finally { this.mutating = false }
  }

  /** One tick for every sub-sim, then the parent's turn. */
  async step(): Promise<void> {
    this.group.step()
    this.tick++
    try { await this.parent.step?.(this) } finally { this.mutating = false }
  }

  status(): string { return this.parent.status?.(this) ?? '' }

  dispose(): void { this.group.dispose() }
}

/** The `parent` a script module exports, if it has a usable one. */
export function parentOf(script: ScriptModule | undefined | null): Parent | null {
  const p = (script as { parent?: unknown } | undefined | null)?.parent as Parent | undefined
  return p && typeof p === 'object' && typeof p.init === 'function' ? p : null
}
